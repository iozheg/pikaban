import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_GENERAL, EXIT_NOT_FOUND, EXIT_VALIDATION } from "../../src/core/errors.js";
import { listProjects } from "../../src/core/globalConfig.js";
import { initProject, projectIdFrom } from "../../src/core/init.js";
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

describe("initProject", () => {
  it("makes a project that openProject and create accept, and registers it", () => {
    const r = initProject(root, { homeDir: home });
    expect(r.registered).toBe(true);
    expect(r.config).toEqual({
      schema_version: 1,
      project_id: "my-project",
      project_name: "My Project",
      categories: ["backlog", "todo", "in_progress", "done"],
    });
    expect(JSON.parse(readFileSync(r.configFile, "utf8"))).toEqual(r.config);
    expect(listProjects(home)).toEqual([r.root]);
    const p = openProject(root, { write: true });
    expect(create(p, { title: "A" }).short).toBe("task-0001");
  });

  it("uses name, id and categories; register: false does not change the global config", () => {
    const r = initProject(root, { homeDir: home, name: "N", id: "i", categories: ["a", "in_progress", "done"], register: false });
    expect(r.config).toMatchObject({ project_name: "N", project_id: "i", categories: ["a", "in_progress", "done"] });
    expect(r.registered).toBe(false);
    expect(existsSync(join(home, ".tracker_config.json"))).toBe(false);
  });

  it("stops with code 1 if .tracker/ exists", () => {
    mkdirSync(join(root, ".tracker"));
    trackerError(EXIT_GENERAL, () => initProject(root, { homeDir: home }));
    expect(existsSync(join(root, ".tracker", "config.json"))).toBe(false);
  });

  it("stops with code 3 if the folder does not exist", () => {
    trackerError(EXIT_NOT_FOUND, () => initProject(join(base, "missing"), { homeDir: home }));
  });

  it("stops with code 7 before a write for invalid categories or an invalid global config", () => {
    trackerError(EXIT_VALIDATION, () => initProject(root, { homeDir: home, categories: ["todo"] }));
    writeFileSync(join(home, ".tracker_config.json"), "{");
    trackerError(EXIT_VALIDATION, () => initProject(root, { homeDir: home }));
    expect(existsSync(join(root, ".tracker"))).toBe(false);
  });

  it("keeps .tracker/ if the global config write fails, and tells how to add the project", () => {
    const err = trackerError(EXIT_GENERAL, () => initProject(root, { homeDir: join(base, "no-such-home") }));
    expect(err.message).toContain("tracker projects add");
    expect(existsSync(join(root, ".tracker", "config.json"))).toBe(true);
  });
});
