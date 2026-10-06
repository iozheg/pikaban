import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_GENERAL, EXIT_NOT_FOUND, EXIT_VALIDATION } from "../../src/core/errors.js";
import { initProject, prepareInit, projectIdFrom } from "../../src/core/init.js";
import { openProject } from "../../src/core/project.js";
import { create } from "../../src/core/tasks.js";
import { removeDir, tempDir, trackerError } from "../helpers.js";

let base: string;
let root: string;
let home: string;
beforeEach(() => {
  base = tempDir("init");
  root = join(base, "My Project");
  home = join(base, "home");
  mkdirSync(root);
  mkdirSync(home);
});
afterEach(() => removeDir(base));

describe("projectIdFrom", () => {
  it.each([
    ["My Project", "my-project"],
    ["tasktracker", "tasktracker"],
    ["a_b.c-d", "a_b.c-d"],
    ["  !!", "project"],
    [".hidden", "hidden"],
  ])("%s gives %s", (name, id) => {
    expect(projectIdFrom(name)).toBe(id);
  });
});

describe("prepareInit and initProject", () => {
  it("makes a project that openProject and create accept, and does not register it", () => {
    const config = prepareInit(root);
    expect(config).toEqual({
      schema_version: 1,
      project_id: "my-project",
      project_name: "My Project",
      categories: ["backlog", "todo", "in_progress", "done"],
    });
    const paths = initProject(root, config);
    expect(JSON.parse(readFileSync(paths.configFile, "utf8"))).toEqual(config);
    expect(existsSync(join(home, ".tracker_config.json"))).toBe(false);
    const p = openProject(root, { write: true });
    expect(create(p, { title: "A" }).short).toBe("task-0001");
  });

  it("uses name, id and categories", () => {
    const config = prepareInit(root, { name: "N", id: "i", categories: ["a", "todo", "in_progress", "done"] });
    expect(config).toMatchObject({ project_name: "N", project_id: "i", categories: ["a", "todo", "in_progress", "done"] });
  });

  it("stops with code 1 if .tracker/ exists, in the checks and in the write", () => {
    const config = prepareInit(root);
    mkdirSync(join(root, ".tracker"));
    trackerError(EXIT_GENERAL, () => prepareInit(root));
    trackerError(EXIT_GENERAL, () => initProject(root, config));
    expect(existsSync(join(root, ".tracker", "config.json"))).toBe(false);
  });

  it("stops with code 3 if the folder does not exist", () => {
    trackerError(EXIT_NOT_FOUND, () => prepareInit(join(base, "missing")));
  });

  it("stops with code 7 for invalid categories", () => {
    trackerError(EXIT_VALIDATION, () => prepareInit(root, { categories: ["todo"] }));
    expect(existsSync(join(root, ".tracker"))).toBe(false);
  });
});
