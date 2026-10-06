import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXIT_AMBIGUOUS,
  EXIT_CONFLICT,
  EXIT_GENERAL,
  EXIT_NOT_FOUND,
  EXIT_SCHEMA_VERSION,
  EXIT_USAGE,
  EXIT_VALIDATION,
  TrackerError,
} from "../../src/core/errors.js";
import {
  GlobalConfigSchema,
  ProjectConfigSchema,
  SCHEMA_VERSION,
  TaskFrontmatterSchema,
  defaultCategory,
  validate,
} from "../../src/core/schema.js";

const validConfig = JSON.parse(
  readFileSync(join(import.meta.dirname, "../fixtures/config.valid.json"), "utf8"),
);

describe("errors", () => {
  it("has the exit codes of design section 5", () => {
    expect([
      EXIT_GENERAL,
      EXIT_USAGE,
      EXIT_NOT_FOUND,
      EXIT_AMBIGUOUS,
      EXIT_CONFLICT,
      EXIT_SCHEMA_VERSION,
      EXIT_VALIDATION,
    ]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("TrackerError carries the code", () => {
    const err = new TrackerError(EXIT_NOT_FOUND, "no task");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(3);
    expect(err.name).toBe("TrackerError");
  });
});

describe("ProjectConfigSchema", () => {
  it("accepts the valid fixture", () => {
    const config = validate(ProjectConfigSchema, validConfig, "config.json");
    expect(config.schema_version).toBe(SCHEMA_VERSION);
    expect(defaultCategory(config)).toBe("backlog");
  });

  it.each([
    ["without in_progress", { categories: ["backlog", "done"] }, /in_progress/],
    ["without done", { categories: ["in_progress"] }, /done/],
    ["with duplicate categories", { categories: ["in_progress", "done", "done"] }, /unique/],
    ["with an empty category", { categories: ["", "in_progress", "done"] }, /category must not be empty/],
    ["with a negative schema_version", { schema_version: -1 }, /schema_version/],
    ["with a non-integer schema_version", { schema_version: 1.5 }, /schema_version/],
    ["with an empty project_name", { project_name: " " }, /project_name/],
    ["with an unknown key", { version: "1.0" }, /version/],
  ])("rejects a config %s (code 7)", (_name, patch, message) => {
    expect(() => validate(ProjectConfigSchema, { ...validConfig, ...patch }, "config.json")).toThrow(
      expect.objectContaining({ code: EXIT_VALIDATION, message: expect.stringMatching(message) }),
    );
  });

  it("accepts schema_version 0, so that project.ts can report code 6 for it", () => {
    expect(ProjectConfigSchema.safeParse({ ...validConfig, schema_version: 0 }).success).toBe(true);
  });
});

describe("TaskFrontmatterSchema", () => {
  const task = {
    id: "01JA2B3C4D5E6F7G8H9J0KMNPQ",
    short: "task-0042",
    title: "T",
    category: "backlog",
    assignee: null,
    needs_input: false,
    created_at: "2026-10-05T10:00:00.000Z",
    updated_at: "2026-10-05T10:00:00Z",
  };

  it("accepts a valid task", () => {
    expect(TaskFrontmatterSchema.safeParse(task).success).toBe(true);
    expect(TaskFrontmatterSchema.safeParse({ ...task, assignee: "agent" }).success).toBe(true);
    expect(TaskFrontmatterSchema.safeParse({ ...task, assignee: "user" }).success).toBe(true);
  });

  it.each([
    { id: "01ja2b3c4d5e6f7g8h9j0kmnpq" },
    { id: "01JA2B3C4D5E6F7G8H9J0KMNPU" },
    { id: "81JA2B3C4D5E6F7G8H9J0KMNPQ" },
    { id: "01JA2B3C4D5E6F7G8H9J0KMNP" },
    { short: "task-42" },
    { short: "TASK-0042" },
    { assignee: "robot" },
    { needs_input: "false" },
    { created_at: "2026-10-05T10:00:00+02:00" },
    { updated_at: "2026-10-05" },
  ])("rejects %o", (patch) => {
    expect(TaskFrontmatterSchema.safeParse({ ...task, ...patch }).success).toBe(false);
  });
});

describe("GlobalConfigSchema", () => {
  it("accepts absolute paths and keeps unknown keys", () => {
    const data = { projects: ["/Users/dev/a"], other: 1 };
    expect(GlobalConfigSchema.parse(data)).toEqual(data);
  });

  it("rejects relative paths", () => {
    expect(GlobalConfigSchema.safeParse({ projects: ["rel/path"] }).success).toBe(false);
  });
});
