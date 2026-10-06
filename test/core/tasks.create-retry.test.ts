import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CONFLICT } from "../../src/core/errors.js";
import * as ids from "../../src/core/ids.js";
import { openProject, type Project } from "../../src/core/project.js";
import { create } from "../../src/core/tasks.js";
import { makeProject, removeDir, tempDir, trackerError } from "../helpers.js";

vi.mock("../../src/core/ids.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/core/ids.js")>();
  return { ...real, newUlid: vi.fn(real.newUlid) };
});

const TAKEN = "01JA2B3C4D5E6F7G8H9J0KMNPQ";
let root: string;
let p: Project;

beforeEach(() => {
  root = tempDir("retry");
  makeProject(root);
  p = openProject(root, { write: true });
  // A file with the name of the first ULID, but not a task that `list` sees.
  writeFileSync(join(p.tasksDir, `task-0001-${TAKEN}.md`), "not a task\n");
});

afterEach(() => {
  vi.mocked(ids.newUlid).mockReset();
  removeDir(root);
});

describe("create when the file exists", () => {
  it("tries again one time with a new ULID", () => {
    vi.mocked(ids.newUlid).mockReturnValueOnce(TAKEN).mockReturnValueOnce("01JA2B3C4D5E6F7G8H9J0KMNPR");
    const t = create(p, { title: "x" });
    expect(t.id).toBe("01JA2B3C4D5E6F7G8H9J0KMNPR");
    expect(readFileSync(join(p.tasksDir, `task-0001-${TAKEN}.md`), "utf8")).toBe("not a task\n");
  });

  it("stops with code 5 if the second ULID also exists", () => {
    vi.mocked(ids.newUlid).mockReturnValue(TAKEN);
    trackerError(EXIT_CONFLICT, () => create(p, { title: "x" }));
    expect(readdirSync(p.tasksDir)).toEqual([`task-0001-${TAKEN}.md`]);
  });
});
