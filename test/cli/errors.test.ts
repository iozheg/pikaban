import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sandbox, type RunResult, type Sandbox } from "./run.js";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

const tasksDir = () => join(sb.dir, ".tracker", "tasks");
const configFile = () => join(sb.dir, ".tracker", "config.json");

function init(): void {
  expect(sb.run(["init", "--yes"]).code).toBe(0);
}

/** Expects the exit code, and in --json mode an empty stdout and a JSON error on stderr. */
function expectJsonError(r: RunResult, code: number): string {
  expect(r.code, r.stderr).toBe(code);
  expect(r.stdout).toBe("");
  const err = JSON.parse(r.stderr) as { error: { code: number; message: string } };
  expect(err.error.code).toBe(code);
  expect(err.error.message).not.toBe("");
  return err.error.message;
}

/** Runs the command in human mode and in --json mode, and expects `code` for both. */
function expectCode(args: string[], code: number, opts?: { input?: string }): string {
  const human = sb.run(args, opts);
  expect(human.code, human.stderr).toBe(code);
  expect(human.stderr).toMatch(/^error: /);
  return expectJsonError(sb.run([...args, "--json"], opts), code);
}

function setSchemaVersion(v: number): void {
  const config = JSON.parse(readFileSync(configFile(), "utf8"));
  writeFileSync(configFile(), JSON.stringify({ ...config, schema_version: v }));
}

describe("exit code 1: general error", () => {
  it("init stops if .tracker/ already exists", () => {
    init();
    const before = readFileSync(configFile(), "utf8");
    expect(expectCode(["init", "--name", "Other"], 1)).toContain("already exists");
    expect(readFileSync(configFile(), "utf8")).toBe(before);
  });

  it("a --body-file that does not exist", () => {
    init();
    expectCode(["add", "A", "--body-file", join(sb.dir, "missing.md")], 1);
  });
});

describe("exit code 2: incorrect usage", () => {
  beforeEach(init);

  it.each([
    ["unknown command", ["bogus"]],
    ["unknown option", ["list", "--bogus"]],
    ["missing argument", ["add"]],
    ["missing argument of move", ["move", "1"]],
    ["excess argument", ["show", "1", "2"]],
    ["option without value", ["add", "A", "--category"]],
    ["no subcommand of projects", ["projects"]],
  ])("commander usage error: %s", (_name, args) => {
    const human = sb.run(args);
    expect(human.code).toBe(2);
    expect(human.stdout).toBe("");
    const json = sb.run(["--json", ...args]);
    expect(json.code).toBe(2);
    expect(json.stdout).toBe("");
    // The JSON error is the last line (`projects` without a subcommand writes its help first).
    const last = json.stderr.trim().split("\n").at(-1)!;
    expect(JSON.parse(last).error.code).toBe(2);
  });

  it("no command at all", () => {
    expect(sb.run([]).code).toBe(2);
  });

  it.each([
    ["not a task reference", ["show", "abc"]],
    ["reference 0", ["show", "0"]],
    ["invalid --assignee in list", ["list", "--assignee", "bob"]],
    ["invalid --assignee in move", ["move", "1", "done", "--assignee", "bob"]],
    ["invalid --needs-input", ["set", "1", "--needs-input", "yes"]],
    ["set without fields", ["set", "1"]],
    ["--body and --body-file", ["add", "A", "--body", "x", "--body-file", "y"]],
    ["note text and --file", ["note", "1", "text", "--file", "y"]],
    ["note without text", ["note", "1"]],
    ["list with an unknown category", ["list", "--category", "nope"]],
  ])("%s", (_name, args) => {
    sb.run(["add", "A task"]);
    expectCode(args, 2);
  });

  it("an invalid --needs-input does not change the task", () => {
    const t = sb.json(["add", "A"]);
    expect(sb.run(["set", "1", "--title", "B", "--needs-input", "maybe"]).code).toBe(2);
    expect(readFileSync(t.file, "utf8")).toContain("title: A\n");
  });
});

describe("exit code 3: not found", () => {
  it("no project", () => {
    expect(expectCode(["list"], 3)).toContain("tracker init");
    expectCode(["add", "A"], 3);
    expectCode(["check"], 3);
    expectCode(["migrate"], 3);
  });

  it("task not found", () => {
    init();
    expectCode(["show", "42"], 3);
    expectCode(["move", "task-0042", "done"], 3);
    expectCode(["delete", "01JA2B3C4D5E6F7G8H9J0KMNPQ"], 3);
  });

  it("init or list with a -C folder that does not exist", () => {
    expectCode(["init", "-C", join(sb.dir, "missing")], 3);
    init();
    // No search up from a missing folder, also if a parent folder has a project.
    expect(expectCode(["list", "-C", join(sb.dir, "missing")], 3)).toContain("folder not found");
  });

  it("projects add without .tracker/, projects remove of a path not in the list", () => {
    expectCode(["projects", "add", sb.dir], 3);
    expectCode(["projects", "remove", sb.dir], 3);
  });
});

describe("exit code 4: short name has more than one task", () => {
  it("gives the two ULIDs; check --fix corrects it", () => {
    init();
    const t = sb.json(["add", "Original"]);
    // A copy with the same short name and a newer ULID, as after a git merge.
    const newId = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ";
    const copy = readFileSync(t.file, "utf8").replace(t.id, newId).replace("title: Original", "title: Copy");
    writeFileSync(join(tasksDir(), `task-0001-${newId}.md`), copy);

    const msg = expectCode(["show", "1"], 4);
    expect(msg).toContain(t.id);
    expect(msg).toContain(newId);
    expectCode(["move", "task-0001", "done"], 4);
    // The ULID still works.
    expect(sb.json(["show", newId]).title).toBe("Copy");

    // check finds it (code 7), check --fix corrects it (code 0).
    expect(sb.run(["check"]).code).toBe(7);
    const fixed = sb.run(["check", "--fix", "--json"]);
    expect(fixed.code, fixed.stderr).toBe(0);
    expect(JSON.parse(fixed.stdout).issues).toMatchObject([{ kind: "duplicate_short", fixed: true }]);
    expect(sb.json(["show", "1"]).id).toBe(t.id);
    expect(sb.json(["show", "2"]).id).toBe(newId);
  });
});

// Exit code 5 (conflict) is not reachable from the CLI without a race: it needs a file change
// between two reads in one command (milliseconds). The core tests cover it. The CLI maps
// TrackerError code 5 to exit code 5 the same way as all other codes.

describe("exit code 6: schema version", () => {
  it("a higher version stops all commands", () => {
    init();
    sb.run(["add", "A"]);
    setSchemaVersion(2);
    for (const args of [["list"], ["show", "1"], ["add", "B"], ["move", "1", "done"], ["check"], ["migrate"]]) {
      expect(expectCode(args, 6)).toContain("Update the tracker CLI");
    }
  });

  it("a lower version allows reads and stops writes", () => {
    init();
    sb.run(["add", "A"]);
    setSchemaVersion(0);
    expect(sb.run(["list"]).code).toBe(0);
    expect(sb.run(["show", "1"]).code).toBe(0);
    for (const args of [
      ["add", "B"],
      ["move", "1", "done"],
      ["set", "1", "--title", "X"],
      ["note", "1", "x"],
      ["delete", "1"],
      ["check", "--fix"],
    ]) {
      expect(expectCode(args, 6)).toContain("tracker migrate");
    }
    // check without --fix reads: it reports the version as an error (code 7).
    expect(sb.run(["check"]).code).toBe(7);
    expect(readdirSync(tasksDir())).toHaveLength(1);
  });
});

describe("exit code 7: validation error", () => {
  it("check with an invalid task file", () => {
    init();
    copyFileSync(
      join(import.meta.dirname, "..", "fixtures", "tasks", "invalid", "empty-title.md"),
      join(tasksDir(), "task-0001-01JA2B3C4D5E6F7G8H9J0KMNPQ.md"),
    );
    const human = sb.run(["check"]);
    expect(human.code).toBe(7);
    expect(human.stdout).toContain("error: ");
    expect(human.stdout).toContain("FAILED: 1 error(s)");
    const json = sb.run(["check", "--json"]);
    expect(json.code).toBe(7);
    const report = JSON.parse(json.stdout);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ kind: "invalid_task", severity: "error" });
  });

  it("an unknown category, an empty title, an invalid config", () => {
    init();
    expectCode(["add", "A", "--category", "nope"], 7);
    expectCode(["add", " "], 7);
    sb.run(["add", "A"]);
    expectCode(["move", "1", "nope"], 7);
    expectCode(["set", "1", "--title", ""], 7);
    expectCode(["note", "1", "  "], 7);
    writeFileSync(configFile(), "{ not json");
    expectCode(["list"], 7);
    expect(existsSync(configFile())).toBe(true);
  });

  it("an invalid global config", () => {
    mkdirSync(join(sb.dir, "a"));
    writeFileSync(join(sb.home, ".tracker_config.json"), "[");
    expectCode(["projects", "list"], 7);
    // init reads the global config before it writes: nothing is made.
    expectCode(["init", "-C", join(sb.dir, "a")], 7);
    expect(existsSync(join(sb.dir, "a", ".tracker"))).toBe(false);
  });
});
