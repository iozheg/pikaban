import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_VALIDATION } from "../../src/core/errors.js";
import {
  addProject,
  globalConfigPath,
  listProjects,
  readGlobalConfig,
  removeProject,
} from "../../src/core/globalConfig.js";
import { removeDir, tempDir, trackerError } from "../helpers.js";

let home: string;

beforeEach(() => {
  home = tempDir("home");
});

afterEach(() => {
  removeDir(home);
});

describe("global config", () => {
  it("uses ~/.tracker_config.json in the given home folder", () => {
    expect(globalConfigPath(home)).toBe(join(home, ".tracker_config.json"));
  });

  it("gives an empty list when the file does not exist", () => {
    expect(listProjects(home)).toEqual([]);
  });

  it("adds a path one time, as an absolute path", () => {
    expect(addProject("/projects/a", home)).toBe(true);
    expect(addProject("/projects/b/", home)).toBe(true);
    expect(addProject("/projects/x/../a", home)).toBe(false);
    expect(listProjects(home)).toEqual(["/projects/a", "/projects/b"]);
    expect(addProject("relative/c", home)).toBe(true);
    expect(listProjects(home)[2]).toBe(join(process.cwd(), "relative/c"));
    expect(readFileSync(globalConfigPath(home), "utf8")).toMatch(/^\{\n {2}"projects": \[[\s\S]*\]\n\}\n$/);
    expect(readdirSync(home)).toEqual([".tracker_config.json"]);
  });

  it("removes a path", () => {
    addProject("/projects/a", home);
    addProject("/projects/b", home);
    expect(removeProject("/projects/a/", home)).toBe(true);
    expect(removeProject("/projects/a", home)).toBe(false);
    expect(listProjects(home)).toEqual(["/projects/b"]);
  });

  it("keeps unknown keys", () => {
    writeFileSync(globalConfigPath(home), JSON.stringify({ projects: [], theme: "dark" }));
    addProject("/projects/a", home);
    expect(readGlobalConfig(home)).toEqual({ projects: ["/projects/a"], theme: "dark" });
  });

  it("gives code 7 for invalid JSON or a relative path in the file, and does not write", () => {
    writeFileSync(globalConfigPath(home), "{ bad");
    trackerError(EXIT_VALIDATION, () => addProject("/projects/a", home));
    expect(readFileSync(globalConfigPath(home), "utf8")).toBe("{ bad");
    writeFileSync(globalConfigPath(home), JSON.stringify({ projects: ["rel"] }));
    trackerError(EXIT_VALIDATION, () => listProjects(home));
  });
});
