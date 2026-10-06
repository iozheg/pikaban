import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_GENERAL, EXIT_SCHEMA_VERSION } from "../../src/core/errors.js";
import { MIGRATIONS, migrate, type Migration } from "../../src/core/migrate.js";
import { openProject } from "../../src/core/project.js";
import { list } from "../../src/core/tasks.js";
import { CONFIG, copyValidFixtures, makeProject, removeDir, tempDir, trackerError } from "../helpers.js";

// A test migration only. Version 0 files have no `needs_input` line.
const v0to1: Migration = {
  from: 0,
  to: 1,
  run(ctx) {
    for (const file of ctx.taskFiles) {
      const text = ctx.read(file);
      if (!/^needs_input:/m.test(text)) ctx.write(file, text.replace(/^(assignee:.*\n)/m, "$1needs_input: false\n"));
    }
  },
};

let root: string;
let tasksDir: string;

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of [join(root, ".tracker"), tasksDir]) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile()) out[join(dir, e.name)] = readFileSync(join(dir, e.name), "utf8");
    }
  }
  return out;
}

beforeEach(() => {
  root = tempDir("migrate");
  makeProject(root, { ...CONFIG, schema_version: 0 });
  copyValidFixtures(root);
  tasksDir = join(root, ".tracker", "tasks");
  for (const name of readdirSync(tasksDir)) {
    const file = join(tasksDir, name);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^needs_input:.*\n/m, ""));
  }
});

afterEach(() => {
  removeDir(root);
});

describe("migrate", () => {
  it("has no real migrations for version 1", () => {
    expect(MIGRATIONS).toEqual([]);
  });

  it("does nothing for a project with the current version", () => {
    makeProject(root);
    const before = snapshot();
    expect(migrate(root)).toEqual({ from: 1, to: 1, dryRun: false, applied: [], changedFiles: [] });
    expect(snapshot()).toEqual(before);
  });

  it("with dryRun, reports the changes and writes nothing", () => {
    const before = snapshot();
    const result = migrate(root, { dryRun: true, migrations: [v0to1] });
    expect(result.applied).toEqual(["0 -> 1"]);
    expect(result.changedFiles).toHaveLength(5);
    expect(result.changedFiles.at(-1)).toBe(join(root, ".tracker", "config.json"));
    expect(snapshot()).toEqual(before);
  });

  it("changes the files and the config, and a second run changes nothing", () => {
    trackerError(EXIT_SCHEMA_VERSION, () => openProject(root, { write: true }));
    const result = migrate(root, { migrations: [v0to1] });
    expect(result).toMatchObject({ from: 0, to: 1, applied: ["0 -> 1"] });
    expect(result.changedFiles).toHaveLength(5);

    const p = openProject(root, { write: true });
    expect(p.config.schema_version).toBe(1);
    const { tasks, invalid } = list(p);
    expect(invalid).toEqual([]);
    expect(tasks).toHaveLength(4);

    const after = snapshot();
    expect(migrate(root, { migrations: [v0to1] })).toMatchObject({ applied: [], changedFiles: [] });
    expect(snapshot()).toEqual(after);
  });

  it("can run again after a stop before the config write", () => {
    migrate(root, { migrations: [v0to1] });
    const tasksAfter = snapshot();
    makeProject(root, { ...CONFIG, schema_version: 0 });
    const result = migrate(root, { migrations: [v0to1] });
    expect(result.changedFiles).toEqual([join(root, ".tracker", "config.json")]);
    expect(snapshot()).toEqual(tasksAfter);
  });

  it("gives code 1 if a migration is missing", () => {
    const before = snapshot();
    trackerError(EXIT_GENERAL, () => migrate(root));
    expect(snapshot()).toEqual(before);
  });

  it("gives code 6 for a higher version", () => {
    makeProject(root, { ...CONFIG, schema_version: 2 });
    trackerError(EXIT_SCHEMA_VERSION, () => migrate(root, { migrations: [v0to1] }));
  });
});
