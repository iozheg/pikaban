import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_AMBIGUOUS,
  EXIT_CONFLICT,
  EXIT_NOT_FOUND,
  EXIT_SCHEMA_VERSION,
  EXIT_VALIDATION,
} from "../../src/core/errors.js";
import { contentHash } from "../../src/core/fs.js";
import { openProject, type Project } from "../../src/core/project.js";
import { ULID_RE, type TaskPatch } from "../../src/core/schema.js";
import { appendNote, changeShort, create, get, list, remove, update } from "../../src/core/tasks.js";
import { CONFIG, copyValidFixtures, fixtures, makeProject, removeDir, taskText, tempDir, pikabanError } from "../helpers.js";

let root: string;
let p: Project;
let tasksDir: string;

const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeEach(() => {
  root = tempDir("tasks");
  makeProject(root);
  p = openProject(root, { write: true });
  tasksDir = p.tasksDir;
});

afterEach(() => {
  removeDir(root);
});

describe("create", () => {
  it("makes a task file with defaults", () => {
    const t = create(p, { title: "First task", body: "Some text" });
    expect(t.id).toMatch(ULID_RE);
    expect(t.short).toBe("task-0001");
    expect(t.category).toBe("backlog");
    expect(t.assignee).toBeNull();
    expect(t.needs_input).toBe(false);
    expect(t.created_at).toMatch(ISO_MS);
    expect(t.updated_at).toBe(t.created_at);
    expect(t.body).toBe("Some text\n");
    expect(t.file).toBe(join(tasksDir, `task-0001-${t.id}.md`));

    const text = readFileSync(t.file, "utf8");
    expect(text).toBe(
      `---\nid: ${t.id}\nshort: task-0001\ntitle: First task\ncategory: backlog\nassignee: null\n` +
        `needs_input: false\ncreated_at: "${t.created_at}"\nupdated_at: "${t.updated_at}"\n---\n\nSome text\n`,
    );
    expect(t.etag).toBe(contentHash(text));
    expect(get(p, "1")).toEqual(t);
  });

  it("gives the next short names and accepts a category", () => {
    create(p, { title: "a" });
    const b = create(p, { title: "b", category: "todo" });
    expect(b.short).toBe("task-0002");
    expect(b.category).toBe("todo");
    expect(b.body).toBe("");
    expect(readFileSync(b.file, "utf8").endsWith("---\n")).toBe(true);
  });

  it("does not take the short name of a task file that is not valid", () => {
    create(p, { title: "a" });
    writeFileSync(join(tasksDir, "task-0002-01JA2BAD4D5E6F7G8H9J0KMNPV.md"), "---\ntitle: [broken\n---\n");
    expect(create(p, { title: "b" }).short).toBe("task-0003");
  });

  it("gives code 7 for an empty title or an unknown category, and writes nothing", () => {
    pikabanError(EXIT_VALIDATION, () => create(p, { title: " " }));
    pikabanError(EXIT_VALIDATION, () => create(p, { title: "x", category: "later" }));
    expect(readdirSync(tasksDir)).toEqual([]);
  });
});

describe("list", () => {
  beforeEach(() => {
    copyValidFixtures(root);
  });

  it("reads the tasks sorted by ULID", () => {
    const { tasks, invalid } = list(p);
    expect(invalid).toEqual([]);
    expect(tasks.map((t) => t.short)).toEqual(["task-0042", "task-0043", "task-0044", "task-0045"]);
    const ids = tasks.map((t) => t.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it("returns an invalid file as an entry with an error, and continues", () => {
    writeFileSync(join(tasksDir, "task-0050-broken.md"), "no frontmatter\n");
    const { tasks, invalid } = list(p);
    expect(tasks).toHaveLength(4);
    expect(invalid).toEqual([{ file: join(tasksDir, "task-0050-broken.md"), error: expect.stringContaining("---") }]);
  });

  it("reads only *.md files at depth 0", () => {
    writeFileSync(join(tasksDir, "notes.txt"), "x");
    mkdirSync(join(tasksDir, "sub"));
    writeFileSync(join(tasksDir, "sub", "task-0001-01JA2B3C4D5E6F7G8H9J0KMNPZ.md"), "x");
    mkdirSync(join(tasksDir, "folder.md"));
    const { tasks, invalid } = list(p);
    expect(tasks).toHaveLength(4);
    expect(invalid).toEqual([]);
  });

  it("filters by category, assignee and needs_input", () => {
    const shorts = (f: Parameters<typeof list>[1]) => list(p, f).tasks.map((t) => t.short);
    expect(shorts({ category: "todo" })).toEqual(["task-0045"]);
    expect(shorts({ category: "in_progress", assignee: "agent" })).toEqual(["task-0043"]);
    expect(shorts({ assignee: "user" })).toEqual(["task-0044"]);
    expect(shorts({ assignee: null })).toEqual(["task-0042", "task-0045"]);
    expect(shorts({ needs_input: true })).toEqual(["task-0043"]);
    expect(shorts({ needs_input: false, category: "backlog" })).toEqual(["task-0042"]);
    expect(shorts({ category: "later" })).toEqual([]);
  });

  it("gives an empty list if the tasks folder does not exist", () => {
    removeDir(tasksDir);
    expect(list(p)).toEqual({ tasks: [], invalid: [] });
  });
});

describe("get", () => {
  beforeEach(() => {
    copyValidFixtures(root);
  });

  it("accepts task-0042, 0042, 42 and the ULID", () => {
    for (const ref of ["task-0042", "0042", "42", "01JA2B3C4D5E6F7G8H9J0KMNPQ"]) {
      expect(get(p, ref).id).toBe("01JA2B3C4D5E6F7G8H9J0KMNPQ");
    }
  });

  it("uses the frontmatter, not the file name", () => {
    renameSync(join(tasksDir, "task-0042-01JA2B3C4D5E6F7G8H9J0KMNPQ.md"), join(tasksDir, "renamed.md"));
    expect(get(p, "42").file).toBe(join(tasksDir, "renamed.md"));
    expect(get(p, "01JA2B3C4D5E6F7G8H9J0KMNPQ").file).toBe(join(tasksDir, "renamed.md"));
  });

  it("finds a task by ULID when another task file is not valid", () => {
    writeFileSync(join(tasksDir, "bad.md"), "x");
    expect(get(p, "01JA2B9X4D5E6F7G8H9J0KMNPR").short).toBe("task-0043");
  });

  it("gives code 3 with the hint for a ULID whose file is not valid", () => {
    const file = join(tasksDir, "task-0042-01JA2B3C4D5E6F7G8H9J0KMNPQ.md");
    writeFileSync(file, readFileSync(file, "utf8").replace("category: ", "category: later\nx: "));
    expect(pikabanError(EXIT_NOT_FOUND, () => get(p, "01JA2B3C4D5E6F7G8H9J0KMNPQ")).message).toMatch(/not valid/);
  });

  it("finds a ULID through the frontmatter when the file name has another ULID", () => {
    const inName = "01JA2BAD4D5E6F7G8H9J0KMNPV";
    const inFile = "01JA2BAE4D5E6F7G8H9J0KMNPW";
    writeFileSync(join(tasksDir, `task-0099-${inName}.md`), taskText({ id: inFile, short: "task-0099" }));
    expect(get(p, inFile).short).toBe("task-0099");
    pikabanError(EXIT_NOT_FOUND, () => get(p, inName));
  });

  it("gives code 3 for an unknown task, with a hint about invalid files", () => {
    pikabanError(EXIT_NOT_FOUND, () => get(p, "7"));
    writeFileSync(join(tasksDir, "bad.md"), "x");
    expect(pikabanError(EXIT_NOT_FOUND, () => get(p, "7")).message).toMatch(/not valid/);
  });

  it("gives code 4 with both ULIDs when two tasks have one short name", () => {
    const other = "01JA2BAD4D5E6F7G8H9J0KMNPV";
    writeFileSync(join(tasksDir, `task-0042-${other}.md`), taskText({ id: other, short: "task-0042" }));
    const err = pikabanError(EXIT_AMBIGUOUS, () => get(p, "task-0042"));
    expect(err.message).toContain("01JA2B3C4D5E6F7G8H9J0KMNPQ");
    expect(err.message).toContain(other);
    expect(get(p, other).id).toBe(other);
  });
});

describe("update", () => {
  it("changes fields, sets updated_at and keeps id, short and created_at", async () => {
    const t = create(p, { title: "Old", body: "Body\n" });
    await new Promise((r) => setTimeout(r, 5));
    const u = update(p, "1", { title: "New", category: "in_progress", assignee: "agent", needs_input: true });
    expect(u).toMatchObject({ id: t.id, short: t.short, created_at: t.created_at, title: "New" });
    expect(u).toMatchObject({ category: "in_progress", assignee: "agent", needs_input: true, body: "Body\n" });
    expect(u.updated_at > t.updated_at).toBe(true);
    expect(u.etag).toBe(contentHash(readFileSync(t.file, "utf8")));
    expect(get(p, t.id)).toEqual(u);
    expect(update(p, "1", { assignee: null }).assignee).toBeNull();
  });

  it("replaces the body", () => {
    const t = create(p, { title: "x", body: "old" });
    expect(update(p, t.id, { body: "new text" }).body).toBe("new text\n");
    expect(readFileSync(t.file, "utf8").endsWith("---\n\nnew text\n")).toBe(true);
    expect(update(p, t.id, { body: "" }).body).toBe("");
  });

  it("keeps the body bytes of a fixture when only the category changes", () => {
    copyValidFixtures(root);
    const before = get(p, "42");
    const after = update(p, "42", { category: "done" });
    expect(after.body).toBe(before.body);
    const afterFrontmatter = (file: string) => readFileSync(file, "utf8").split("\n---\n")[1];
    const fixture = join(fixtures, "tasks", "valid", "task-0042-01JA2B3C4D5E6F7G8H9J0KMNPQ.md");
    expect(afterFrontmatter(before.file)).toBe(afterFrontmatter(fixture));
  });

  it("gives code 5 with an old ifMatch and does not change the file", () => {
    const t = create(p, { title: "x" });
    const u = update(p, t.id, { title: "y" }, { ifMatch: t.etag });
    const text = readFileSync(t.file, "utf8");
    pikabanError(EXIT_CONFLICT, () => update(p, t.id, { title: "z" }, { ifMatch: t.etag }));
    expect(readFileSync(t.file, "utf8")).toBe(text);
    expect(update(p, t.id, { title: "z" }, { ifMatch: u.etag }).title).toBe("z");
  });

  it("gives code 5 after a direct body edit", () => {
    const t = create(p, { title: "x", body: "a" });
    writeFileSync(t.file, `${readFileSync(t.file, "utf8")}edited by the agent\n`);
    pikabanError(EXIT_CONFLICT, () => update(p, t.id, { title: "y" }, { ifMatch: t.etag }));
  });

  it("gives code 7 for id, short or timestamps in the patch, and for invalid values", () => {
    const t = create(p, { title: "x" });
    for (const patch of [{ id: "01JA2B3C4D5E6F7G8H9J0KMNPQ" }, { short: "task-0009" }, { created_at: t.created_at }]) {
      pikabanError(EXIT_VALIDATION, () => update(p, t.id, patch as TaskPatch));
    }
    pikabanError(EXIT_VALIDATION, () => update(p, t.id, { category: "later" }));
    pikabanError(EXIT_VALIDATION, () => update(p, t.id, { title: "" }));
    pikabanError(EXIT_VALIDATION, () => update(p, t.id, { assignee: "bob" } as unknown as TaskPatch));
    expect(get(p, t.id)).toEqual(t);
  });

  it("ignores fields with the value undefined", () => {
    const t = create(p, { title: "x" });
    expect(update(p, t.id, { title: undefined, needs_input: true }).title).toBe("x");
  });
});

describe("changeShort", () => {
  it("gives code 5 if the file changed after the read", () => {
    const t = create(p, { title: "x" });
    writeFileSync(t.file, `${readFileSync(t.file, "utf8")}more\n`);
    pikabanError(EXIT_CONFLICT, () => changeShort(p, t, "task-0002"));
    expect(existsSync(t.file)).toBe(true);
    expect(readdirSync(tasksDir)).toHaveLength(1);
  });
});

describe("appendNote", () => {
  it("adds text after a blank line and ends with a newline", () => {
    const t = create(p, { title: "x", body: "## Description\nText" });
    expect(appendNote(p, t.id, "Q: Which provider?").body).toBe("## Description\nText\n\nQ: Which provider?\n");
    expect(appendNote(p, t.id, "A: GitHub.\n").body).toBe(
      "## Description\nText\n\nQ: Which provider?\n\nA: GitHub.\n",
    );
  });

  it("works on an empty body and on a body without a final newline", () => {
    const t = create(p, { title: "x" });
    expect(appendNote(p, t.id, "first").body).toBe("first\n");
    writeFileSync(t.file, readFileSync(t.file, "utf8").replace(/\n$/, ""));
    expect(appendNote(p, t.id, "second").body).toBe("first\n\nsecond\n");
  });

  it("checks ifMatch and rejects an empty note", () => {
    const t = create(p, { title: "x" });
    pikabanError(EXIT_CONFLICT, () => appendNote(p, t.id, "n", { ifMatch: "0" }));
    pikabanError(EXIT_VALIDATION, () => appendNote(p, t.id, " \n"));
  });
});

describe("remove", () => {
  it("deletes the task file", () => {
    const t = create(p, { title: "x" });
    remove(p, t.short);
    expect(existsSync(t.file)).toBe(false);
    pikabanError(EXIT_NOT_FOUND, () => get(p, t.id));
  });

  it("gives code 5 with an old ifMatch and keeps the file", () => {
    const t = create(p, { title: "x" });
    const u = update(p, t.id, { title: "y" });
    pikabanError(EXIT_CONFLICT, () => remove(p, t.id, { ifMatch: t.etag }));
    expect(existsSync(t.file)).toBe(true);
    remove(p, t.id, { ifMatch: u.etag });
    expect(existsSync(t.file)).toBe(false);
  });
});

describe("full cycle", () => {
  it("makes, changes, adds a note and deletes a task", () => {
    const t = create(p, { title: "Implement OAuth2", body: "## Description\nUse GitHub." });
    update(p, "1", { category: "in_progress", assignee: "agent" });
    appendNote(p, "task-0001", "Q: Which scopes?");
    update(p, "0001", { needs_input: true });
    const shown = get(p, t.id);
    expect(shown).toMatchObject({ category: "in_progress", assignee: "agent", needs_input: true });
    expect(shown.body).toBe("## Description\nUse GitHub.\n\nQ: Which scopes?\n");
    remove(p, "1");
    expect(list(p)).toEqual({ tasks: [], invalid: [] });
  });
});

describe("schema version", () => {
  function projectWithVersion(v: number): void {
    makeProject(root, { ...CONFIG, schema_version: v });
  }

  it("version 2 gives code 6 for all operations", () => {
    copyValidFixtures(root);
    projectWithVersion(2);
    pikabanError(EXIT_SCHEMA_VERSION, () => openProject(root));
    pikabanError(EXIT_SCHEMA_VERSION, () => openProject(root, { write: true }));
  });

  it("version 0 gives code 6 for writes only", () => {
    copyValidFixtures(root);
    projectWithVersion(0);
    const old = openProject(root);
    expect(list(old).tasks).toHaveLength(4);
    expect(get(old, "42").title).toBe("Implement OAuth2 authentication");
    pikabanError(EXIT_SCHEMA_VERSION, () => create(old, { title: "x" }));
    pikabanError(EXIT_SCHEMA_VERSION, () => update(old, "42", { title: "x" }));
    pikabanError(EXIT_SCHEMA_VERSION, () => appendNote(old, "42", "x"));
    pikabanError(EXIT_SCHEMA_VERSION, () => remove(old, "42"));
    pikabanError(EXIT_SCHEMA_VERSION, () => openProject(root, { write: true }));
    expect(readdirSync(tasksDir)).toHaveLength(4);
  });
});
