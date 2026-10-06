import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_NOT_FOUND, EXIT_SCHEMA_VERSION, EXIT_VALIDATION } from "../../src/core/errors.js";
import { assertWritable, findProject, openProject } from "../../src/core/project.js";
import { CONFIG, makeProject, removeDir, tempDir, trackerError, writeConfig } from "../helpers.js";

let root: string;

beforeEach(() => {
  root = tempDir("project");
});

afterEach(() => {
  removeDir(root);
});

describe("findProject", () => {
  it("searches up from a subfolder", () => {
    makeProject(root);
    const sub = join(root, "src", "deep");
    mkdirSync(sub, { recursive: true });
    expect(findProject(sub)).toBe(root);
    expect(findProject(root)).toBe(root);
  });

  it("gives code 3 when there is no .tracker/", () => {
    trackerError(EXIT_NOT_FOUND, () => findProject(root));
  });
});

describe("openProject", () => {
  it("reads the config and the paths", () => {
    makeProject(root);
    const p = openProject(root, { write: true });
    expect(p.config).toEqual(CONFIG);
    expect(p.tasksDir).toBe(join(root, ".tracker", "tasks"));
  });

  it("gives code 3 without config and code 7 for a bad config", () => {
    trackerError(EXIT_NOT_FOUND, () => openProject(root));
    makeProject(root, { ...CONFIG, categories: ["todo"] });
    trackerError(EXIT_VALIDATION, () => openProject(root));
    writeFileSync(join(root, ".tracker", "config.json"), "{ not json");
    trackerError(EXIT_VALIDATION, () => openProject(root));
  });

  it("gives code 6 for a higher schema version, for reads and writes", () => {
    makeProject(root, { ...CONFIG, schema_version: 2 });
    trackerError(EXIT_SCHEMA_VERSION, () => openProject(root));
    trackerError(EXIT_SCHEMA_VERSION, () => openProject(root, { write: true }));
  });

  it("compares the version before it validates the other fields", () => {
    makeProject(root, { schema_version: 2, columns: ["a"] });
    const err = trackerError(EXIT_SCHEMA_VERSION, () => openProject(root));
    expect(err.message).toMatch(/Update the tracker CLI/);
  });

  it("gives code 6 for a lower schema version only for writes", () => {
    makeProject(root, { ...CONFIG, schema_version: 0 });
    const p = openProject(root);
    expect(p.config.schema_version).toBe(0);
    trackerError(EXIT_SCHEMA_VERSION, () => assertWritable(p));
    const err = trackerError(EXIT_SCHEMA_VERSION, () => openProject(root, { write: true }));
    expect(err.message).toMatch(/tracker migrate/);
  });

  it("allows writes for the current version", () => {
    makeProject(root);
    writeConfig(root, CONFIG);
    expect(() => assertWritable(openProject(root))).not.toThrow();
  });
});
