import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { check, isOk, type CheckIssue } from "../../src/core/check.js";
import { openProject } from "../../src/core/project.js";
import { get } from "../../src/core/tasks.js";
import { CONFIG, copyValidFixtures, makeProject, removeDir, taskText, tempDir } from "../helpers.js";

let root: string;
let tasksDir: string;

const OLDER = "01JA2B3C4D5E6F7G8H9J0KMNPQ"; // the fixture task-0042
const NEWER = "01JA2BAD4D5E6F7G8H9J0KMNPV";
const newerFile = () => join(tasksDir, `task-0042-${NEWER}.md`);

beforeEach(() => {
  root = tempDir("check");
  makeProject(root);
  copyValidFixtures(root);
  tasksDir = join(root, ".tracker", "tasks");
});

afterEach(() => {
  removeDir(root);
});

describe("check", () => {
  it("reports no issues for a valid project", () => {
    expect(check(openProject(root))).toEqual({ ok: true, issues: [] });
  });

  it("finds a duplicate short name and does not change files without fix", () => {
    writeFileSync(newerFile(), taskText({ id: NEWER, short: "task-0042" }, "\nbody\n"));
    const before = readdirSync(tasksDir);
    const report = check(openProject(root));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      { kind: "duplicate_short", severity: "error", file: newerFile(), message: expect.stringContaining(OLDER) },
    ]);
    expect(readdirSync(tasksDir)).toEqual(before);
  });

  it("fix gives a new short name to the newer task and renames its file", () => {
    writeFileSync(newerFile(), taskText({ id: NEWER, short: "task-0042" }, "\nbody\n"));
    const report = check(openProject(root, { write: true }), { fix: true });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([
      expect.objectContaining({ kind: "duplicate_short", fixed: true, message: expect.stringContaining("task-0046") }),
    ]);

    const p = openProject(root);
    expect(existsSync(newerFile())).toBe(false);
    const moved = get(p, NEWER);
    expect(moved.short).toBe("task-0046");
    expect(moved.file).toBe(join(tasksDir, `task-0046-${NEWER}.md`));
    expect(moved.body).toBe("body\n");
    expect(moved.updated_at > "2026-10-05T10:00:00.000Z").toBe(true);
    expect(get(p, "42").id).toBe(OLDER);
    expect(check(p)).toEqual({ ok: true, issues: [] });
  });

  it("fixes three tasks with one short name", () => {
    const third = "01JA2BAE4D5E6F7G8H9J0KMNPW";
    writeFileSync(newerFile(), taskText({ id: NEWER, short: "task-0042" }));
    writeFileSync(join(tasksDir, `task-0042-${third}.md`), taskText({ id: third, short: "task-0042" }));
    const report = check(openProject(root, { write: true }), { fix: true });
    expect(report.issues.filter((i) => i.fixed)).toHaveLength(2);
    const p = openProject(root);
    expect([get(p, NEWER).short, get(p, third).short]).toEqual(["task-0046", "task-0047"]);
    expect(check(p).ok).toBe(true);
  });

  it("reports a file name that does not agree with short and id, and fix does not change it", () => {
    renameSync(join(tasksDir, `task-0042-${OLDER}.md`), join(tasksDir, "oauth.md"));
    const report = check(openProject(root, { write: true }), { fix: true });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([
      {
        kind: "file_name",
        severity: "warning",
        file: join(tasksDir, "oauth.md"),
        message: expect.stringContaining(`task-0042-${OLDER}.md`),
      },
    ]);
    expect(existsSync(join(tasksDir, "oauth.md"))).toBe(true);
  });

  it("reports invalid task files, and fix does not change them", () => {
    const bad = join(tasksDir, "task-0050-bad.md");
    writeFileSync(bad, "---\ntitle: x\n---\n");
    const report = check(openProject(root, { write: true }), { fix: true });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      { kind: "invalid_task", severity: "error", file: bad, message: expect.stringMatching(/validation failed/) },
    ]);
    expect(readFileSync(bad, "utf8")).toBe("---\ntitle: x\n---\n");
  });

  it("reports a lower schema version", () => {
    makeProject(root, { ...CONFIG, schema_version: 0 });
    const report = check(openProject(root));
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([expect.objectContaining({ kind: "schema_version" })]);
  });

});

describe("isOk", () => {
  const issue = (severity: "error" | "warning", fixed?: boolean): CheckIssue => ({
    kind: "skill_version",
    severity,
    file: "f",
    message: "m",
    ...(fixed ? { fixed } : {}),
  });

  it("warnings and fixed errors do not count, other errors do", () => {
    expect(isOk([])).toBe(true);
    expect(isOk([issue("warning")])).toBe(true);
    expect(isOk([issue("error", true), issue("warning")])).toBe(true);
    expect(isOk([issue("warning"), issue("error")])).toBe(false);
  });
});
