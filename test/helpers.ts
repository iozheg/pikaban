import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { TrackerError, type ExitCode } from "../src/core/errors.js";

export const fixtures = join(import.meta.dirname, "fixtures");

export const CONFIG = {
  schema_version: 1,
  project_id: "my-project",
  project_name: "My Project",
  categories: ["backlog", "todo", "in_progress", "done"],
};

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `tracker-${prefix}-`));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Makes `<root>/.tracker/config.json` and `.tracker/tasks/`. */
export function makeProject(root: string, config: Record<string, unknown> = CONFIG): void {
  mkdirSync(join(root, ".tracker", "tasks"), { recursive: true });
  writeConfig(root, config);
}

export function writeConfig(root: string, config: Record<string, unknown>): void {
  writeFileSync(join(root, ".tracker", "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}

/** Copies the valid fixture tasks (task-0042 to task-0045) into the project. */
export function copyValidFixtures(root: string): void {
  const src = join(fixtures, "tasks", "valid");
  for (const name of readdirSync(src)) {
    writeFileSync(join(root, ".tracker", "tasks", name), readFileSync(join(src, name)));
  }
}

/** A valid task file text. */
export function taskText(fields: { id: string; short: string; title?: string; category?: string }, body = ""): string {
  return [
    "---",
    `id: ${fields.id}`,
    `short: ${fields.short}`,
    `title: ${fields.title ?? "A task"}`,
    `category: ${fields.category ?? "backlog"}`,
    "assignee: null",
    "needs_input: false",
    'created_at: "2026-10-05T10:00:00.000Z"',
    'updated_at: "2026-10-05T10:00:00.000Z"',
    "---",
    "",
  ].join("\n") + body;
}

/** Runs `fn` and returns the TrackerError. Fails if `fn` does not throw one with `code`. */
export function trackerError(code: ExitCode, fn: () => unknown): TrackerError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as TrackerError).code).toBe(code);
    return err as TrackerError;
  }
  throw new Error(`expected a TrackerError with code ${code}`);
}
