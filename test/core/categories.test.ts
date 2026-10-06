import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { categoriesWith, parseOptionalCategory, setCategoryEnabled } from "../../src/core/categories.js";
import { EXIT_GENERAL, EXIT_USAGE } from "../../src/core/errors.js";
import { addGitExcludes, excludePattern, findGitRepo } from "../../src/core/git.js";
import { DEFAULT_CATEGORIES } from "../../src/core/init.js";
import { openProject } from "../../src/core/project.js";
import { create, update } from "../../src/core/tasks.js";
import { CONFIG, makeProject, removeDir, tempDir, trackerError } from "../helpers.js";

let root: string;
beforeEach(() => {
  root = tempDir("categories");
});
afterEach(() => removeDir(root));

const categoriesOnDisk = () => JSON.parse(readFileSync(join(root, ".tracker", "config.json"), "utf8")).categories;

describe("categoriesWith", () => {
  it("gives the required categories and the selected optional ones in board order", () => {
    expect(categoriesWith([])).toEqual(["todo", "in_progress", "done"]);
    expect(categoriesWith(["review", "backlog"])).toEqual(["backlog", "todo", "in_progress", "review", "done"]);
    expect(DEFAULT_CATEGORIES).toEqual(["backlog", "todo", "in_progress", "done"]);
  });

  it("accepts only backlog and review", () => {
    expect(parseOptionalCategory("review")).toBe("review");
    trackerError(EXIT_USAGE, () => parseOptionalCategory("done"));
    trackerError(EXIT_USAGE, () => parseOptionalCategory("qa"));
  });
});

describe("setCategoryEnabled", () => {
  it("puts an enabled category into its board position and writes config.json", () => {
    makeProject(root);
    const r = setCategoryEnabled(openProject(root, { write: true }), "review", true);
    expect(r).toMatchObject({ changed: true, categories: ["backlog", "todo", "in_progress", "review", "done"] });
    expect(categoriesOnDisk()).toEqual(r.categories);

    makeProject(root, { ...CONFIG, categories: ["todo", "in_progress", "done"] });
    expect(setCategoryEnabled(openProject(root, { write: true }), "backlog", true).categories).toEqual(DEFAULT_CATEGORIES);
  });

  it("gives changed: false if the category is already on or off", () => {
    makeProject(root);
    const p = openProject(root, { write: true });
    expect(setCategoryEnabled(p, "backlog", true).changed).toBe(false);
    expect(setCategoryEnabled(p, "review", false).changed).toBe(false);
  });

  it("does not disable a category with tasks (code 1)", () => {
    makeProject(root, { ...CONFIG, categories: categoriesWith(["backlog", "review"]) });
    let p = openProject(root, { write: true });
    const t = create(p, { title: "t" });
    update(p, t.short, { category: "review" });
    const err = trackerError(EXIT_GENERAL, () => setCategoryEnabled(p, "review", false));
    expect(err.message).toContain(t.short);
    expect(categoriesOnDisk()).toContain("review");

    update(p, t.short, { category: "done" });
    p = openProject(root, { write: true });
    expect(setCategoryEnabled(p, "review", false).categories).toEqual(DEFAULT_CATEGORIES);
  });
});

describe("git exclude", () => {
  it("finds the repository of a subfolder and adds each pattern once", () => {
    mkdirSync(join(root, ".git", "info"), { recursive: true });
    writeFileSync(join(root, ".git", "info", "exclude"), "# comment");
    const sub = join(root, "a", "b");
    mkdirSync(sub, { recursive: true });
    const repo = findGitRepo(sub)!;
    expect(repo).toEqual({ root, excludeFile: join(root, ".git", "info", "exclude") });
    const pattern = excludePattern(repo, join(sub, ".tracker"));
    expect(pattern).toBe("/a/b/.tracker/");
    expect(addGitExcludes(repo, [pattern])).toEqual([pattern]);
    expect(addGitExcludes(repo, [pattern])).toEqual([]);
    expect(readFileSync(repo.excludeFile, "utf8")).toBe("# comment\n/a/b/.tracker/\n");
  });

  it("uses the common git folder of a linked worktree", () => {
    const main = join(root, "main", ".git");
    mkdirSync(join(main, "worktrees", "wt"), { recursive: true });
    writeFileSync(join(main, "worktrees", "wt", "commondir"), "../..\n");
    const wt = join(root, "wt");
    mkdirSync(wt);
    writeFileSync(join(wt, ".git"), `gitdir: ${join(main, "worktrees", "wt")}\n`);
    expect(findGitRepo(wt)).toEqual({ root: wt, excludeFile: join(main, "info", "exclude") });
    expect(addGitExcludes(findGitRepo(wt)!, ["/.tracker/"])).toEqual(["/.tracker/"]);
  });

  it("gives null outside a repository", () => {
    expect(findGitRepo(root)).toBeNull();
  });
});
