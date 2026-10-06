import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sandbox, type Sandbox } from "./run.js";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

function init(): void {
  const r = sb.run(["init", "--yes"]);
  expect(r.code, r.stderr).toBe(0);
}

describe("init", () => {
  it("makes .tracker/ and config.json and adds the project to the global config", () => {
    const r = sb.run(["init", "--skill", "none", "--no-allow"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Initialized");
    expect(existsSync(join(sb.dir, ".tracker", "tasks"))).toBe(true);
    const config = JSON.parse(readFileSync(join(sb.dir, ".tracker", "config.json"), "utf8"));
    expect(config).toEqual({
      schema_version: 1,
      project_id: "my-project",
      project_name: "My Project",
      categories: ["backlog", "todo", "in_progress", "done"],
    });
    const global = JSON.parse(readFileSync(join(sb.home, ".tracker_config.json"), "utf8"));
    expect(global.projects).toEqual([sb.dir]);
  });

  it("uses --name and --id, and -C as the project folder", () => {
    const other = join(sb.dir, "sub");
    mkdirSync(other);
    const out = sb.json(["init", "-C", other, "--name", "Other", "--id", "other-id", "--yes"]);
    expect(out.project.config.project_name).toBe("Other");
    expect(out.project.config.project_id).toBe("other-id");
    expect(out.registered).toBe(true);
    expect(existsSync(join(other, ".tracker", "config.json"))).toBe(true);
    expect(existsSync(join(sb.dir, ".tracker"))).toBe(false);
  });

  it("with --skill none --no-allow: does not run git and does not make other files", () => {
    expect(sb.run(["init", "--skill", "none", "--no-allow"]).code).toBe(0);
    expect(existsSync(join(sb.dir, ".git"))).toBe(false);
    expect(existsSync(join(sb.dir, ".claude"))).toBe(false);
  });
});

describe("full flow", () => {
  it("init, add, list --json, move, set, note, show, delete", () => {
    init();

    // add
    const added = sb.run(["add", "Implement OAuth2", "--body", "## Description\nUse GitHub."]);
    expect(added.code, added.stderr).toBe(0);
    expect(added.stdout.trim()).toBe("task-0001  Implement OAuth2  (added to backlog)");
    const second = sb.json(["add", "Second task", "--category", "todo"]);
    expect(second).toMatchObject({ short: "task-0002", title: "Second task", category: "todo", assignee: null });
    expect(second.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(second.file).toContain(join(".tracker", "tasks", "task-0002-"));

    // list --json, global option before and after the command
    const listed = sb.json(["list"]);
    expect(listed.invalid).toEqual([]);
    expect(listed.tasks.map((t: { short: string }) => t.short)).toEqual(["task-0001", "task-0002"]);
    expect(listed.tasks[0].body).toBe("## Description\nUse GitHub.\n");
    const before = sb.run(["--json", "list", "--category", "todo"]);
    expect(before.code).toBe(0);
    expect(JSON.parse(before.stdout).tasks.map((t: { short: string }) => t.short)).toEqual(["task-0002"]);

    // move with --assignee: one write
    const moved = sb.run(["move", "1", "in_progress", "--assignee", "agent"]);
    expect(moved.code, moved.stderr).toBe(0);
    expect(moved.stdout.trim()).toBe("task-0001 moved to in_progress, assignee agent");
    const mine = sb.json(["list", "--category", "in_progress", "--assignee", "agent"]);
    expect(mine.tasks.map((t: { short: string }) => t.short)).toEqual(["task-0001"]);
    expect(sb.json(["list", "--assignee", "none"]).tasks.map((t: { short: string }) => t.short)).toEqual([
      "task-0002",
    ]);

    // set
    const set = sb.run(["set", "task-0002", "--title", "Renamed", "--needs-input", "true"]);
    expect(set.code, set.stderr).toBe(0);
    expect(set.stdout.trim()).toBe("task-0002 updated: title, needs_input");
    expect(sb.json(["list", "--needs-input"]).tasks).toMatchObject([{ short: "task-0002", title: "Renamed" }]);
    expect(sb.json(["set", "2", "--needs-input", "false", "--assignee", "user"])).toMatchObject({
      needs_input: false,
      assignee: "user",
    });

    // note with text and with --file
    expect(sb.run(["note", "0001", "Q: Which provider?"]).stdout.trim()).toBe("note added to task-0001");
    const noteFile = join(sb.dir, "note.txt");
    writeFileSync(noteFile, "A: GitHub.\n");
    expect(sb.run(["note", "1", "--file", noteFile]).code).toBe(0);
    expect(sb.json(["show", "1"]).body).toBe("## Description\nUse GitHub.\n\nQ: Which provider?\n\nA: GitHub.\n");

    // show: the full file in human mode, the Task in --json mode
    const shown = sb.run(["show", "task-0001"]);
    expect(shown.code).toBe(0);
    const task = sb.json(["show", "task-0001"]);
    expect(shown.stdout).toBe(readFileSync(task.file, "utf8"));
    expect(shown.stdout).toMatch(/^---\nid: [0-9A-Z]{26}\nshort: task-0001\n/);
    expect(task).toMatchObject({ category: "in_progress", assignee: "agent" });
    // A ULID reference works too.
    expect(sb.json(["show", task.id]).short).toBe("task-0001");

    // human list table
    const table = sb.run(["list"]).stdout.trim().split("\n");
    expect(table[0]).toMatch(/^SHORT\s+CATEGORY\s+ASSIGNEE\s+INPUT\s+TITLE$/);
    expect(table[1]).toMatch(/^task-0001\s+in_progress\s+agent\s+-\s+Implement OAuth2$/);
    expect(table[2]).toMatch(/^task-0002\s+todo\s+user\s+-\s+Renamed$/);

    // delete
    const deleted = sb.run(["delete", "1"]);
    expect(deleted.code, deleted.stderr).toBe(0);
    expect(deleted.stdout.trim()).toBe("task-0001 deleted");
    expect(existsSync(task.file)).toBe(false);
    expect(sb.json(["delete", "2"]).deleted.short).toBe("task-0002");
    expect(sb.run(["list"]).stdout.trim()).toBe("No tasks.");
    expect(sb.json(["list"])).toEqual({ tasks: [], invalid: [] });
  });

  it("add --body-file reads a file, and - reads stdin", () => {
    init();
    const f = join(sb.dir, "body.md");
    writeFileSync(f, "From a file\n");
    expect(sb.json(["add", "A", "--body-file", f]).body).toBe("From a file\n");
    expect(sb.json(["add", "B", "--body-file", "-"], { input: "From stdin" }).body).toBe("From stdin\n");
    expect(sb.json(["note", "2", "--file", "-"], { input: "Stdin note\n" }).body).toBe("From stdin\n\nStdin note\n");
  });

  it("note text that starts with - after --", () => {
    init();
    sb.run(["add", "A"]);
    const r = sb.run(["note", "1", "--json", "--", "- item one"]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).body).toBe("- item one\n");
  });

  it("finds the project from a subfolder and with -C", () => {
    init();
    const sub = join(sb.dir, "src", "deep");
    mkdirSync(sub, { recursive: true });
    expect(sb.run(["add", "From sub"], { cwd: sub }).code).toBe(0);
    const outside = join(sb.home); // not in the project
    expect(sb.json(["list", "-C", sub], { cwd: outside }).tasks).toHaveLength(1);
    expect(sb.json(["-C", sb.dir, "list"], { cwd: outside }).tasks).toHaveLength(1);
  });

  it("list shows invalid files as warnings on stderr, and in --json output", () => {
    init();
    sb.run(["add", "Good"]);
    writeFileSync(join(sb.dir, ".tracker", "tasks", "broken.md"), "no frontmatter\n");
    const human = sb.run(["list"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("Good");
    expect(human.stderr).toMatch(/^warning: .*broken\.md is not valid/);
    const json = sb.run(["list", "--json"]);
    expect(json.code).toBe(0);
    expect(json.stderr).toBe("");
    const out = JSON.parse(json.stdout);
    expect(out.tasks).toHaveLength(1);
    expect(out.invalid).toHaveLength(1);
    expect(out.invalid[0].file).toContain("broken.md");
  });
});

describe("check and migrate", () => {
  it("check gives 0 for a valid project", () => {
    init();
    sb.run(["add", "A"]);
    const r = sb.run(["check"]);
    expect(r.code, r.stdout).toBe(0);
    expect(r.stdout).toContain("OK: 0 error(s)");
    expect(sb.json(["check"])).toEqual({ ok: true, issues: [] });
  });

  it("check gives 0 with warnings only", () => {
    init();
    const t = sb.json(["add", "A"]);
    // A file name that does not agree with short and id is a warning.
    renameSync(t.file, join(sb.dir, ".tracker", "tasks", "renamed.md"));
    const r = sb.run(["check", "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).issues).toMatchObject([{ kind: "file_name", severity: "warning" }]);
  });

  it("migrate on the current version does nothing", () => {
    init();
    expect(sb.run(["migrate"]).stdout).toContain("Nothing to do");
    expect(sb.json(["migrate", "--dry-run"])).toMatchObject({ from: 1, to: 1, dryRun: true, applied: [] });
  });
});

describe("projects", () => {
  it("add, list and remove", () => {
    const a = join(sb.dir, "a");
    mkdirSync(a);
    sb.run(["init", "-C", a, "--yes"]);
    expect(sb.json(["projects", "list"])).toEqual({ projects: [a] });
    expect(sb.json(["projects", "remove", a])).toEqual({ path: a, removed: true });
    expect(sb.run(["projects", "list"]).stdout.trim()).toBe("No projects.");
    // Without a path: the project found from -C.
    expect(sb.json(["projects", "add", "-C", a])).toEqual({ path: a, added: true });
    expect(sb.run(["projects", "add", a]).stdout.trim()).toBe(`${a} is already in the list`);
    expect(sb.run(["projects", "list"]).stdout.trim()).toBe(a);
    expect(sb.run(["--json", "projects", "remove"], { cwd: a }).code).toBe(0);
    expect(sb.json(["projects", "list"]).projects).toEqual([]);
  });
});

describe("help and version", () => {
  it("--help documents TRACKER_HOME and gives 0", () => {
    const r = sb.run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("TRACKER_HOME");
    expect(sb.run(["list", "--help"]).code).toBe(0);
    expect(sb.run(["--version"]).code).toBe(0);
  });
});
