import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_GENERAL, EXIT_SCHEMA_VERSION } from "../../src/core/errors.js";
import { migrate } from "../../src/core/migrate.js";
import { CONFIG, makeProject, removeDir, tempDir, pikabanError } from "../helpers.js";

let root: string;
const configText = () => readFileSync(join(root, ".pikaban", "config.json"), "utf8");

beforeEach(() => {
  root = tempDir("migrate");
});

afterEach(() => {
  removeDir(root);
});

describe("migrate", () => {
  it("does nothing for a project with the current version", () => {
    makeProject(root);
    const before = configText();
    expect(migrate(root)).toEqual({ from: 1, to: 1, dryRun: false, applied: [], changedFiles: [] });
    expect(migrate(root, { dryRun: true })).toMatchObject({ dryRun: true, applied: [] });
    expect(configText()).toBe(before);
  });

  it("gives code 1 for an older version (no migrations exist) and writes nothing", () => {
    makeProject(root, { ...CONFIG, schema_version: 0 });
    const before = configText();
    pikabanError(EXIT_GENERAL, () => migrate(root));
    expect(configText()).toBe(before);
  });

  it("gives code 6 for a higher version", () => {
    makeProject(root, { ...CONFIG, schema_version: 2 });
    pikabanError(EXIT_SCHEMA_VERSION, () => migrate(root));
  });
});
