import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CONFLICT } from "../../src/core/errors.js";
import { openProject, type Project } from "../../src/core/project.js";
import { create, remove } from "../../src/core/tasks.js";
import { makeProject, pikabanError, removeDir, tempDir } from "../helpers.js";

// A hook after each readFileSync of the core module: a test changes the file between the read and the delete.
let afterRead: ((path: fs.PathOrFileDescriptor) => void) | undefined;

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    readFileSync: ((...args: Parameters<typeof real.readFileSync>) => {
      const result = real.readFileSync(...args);
      afterRead?.(args[0]);
      return result;
    }) as typeof real.readFileSync,
  };
});

let root: string;
let p: Project;

beforeEach(() => {
  root = tempDir("remove-race");
  makeProject(root);
  p = openProject(root, { write: true });
});

afterEach(() => {
  afterRead = undefined;
  removeDir(root);
});

describe("remove", () => {
  it("gives code 5 and keeps the file if it changes after the read", () => {
    const t = create(p, { title: "x" });
    afterRead = (path) => {
      if (path !== t.file) return;
      afterRead = undefined;
      fs.appendFileSync(t.file, "a note by the agent\n");
    };
    pikabanError(EXIT_CONFLICT, () => remove(p, t.id, { ifMatch: t.etag }));
    expect(fs.readFileSync(t.file, "utf8")).toContain("a note by the agent");
  });
});
