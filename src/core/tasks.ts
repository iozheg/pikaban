import { mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { EXIT_CONFLICT, EXIT_VALIDATION, TrackerError } from "./errors.js";
import { parseTaskFile, serializeTaskFile } from "./frontmatter.js";
import { atomicWrite, contentHash, createExclusive } from "./fs.js";
import { fileName, newUlid, nextShort, resolveRef } from "./ids.js";
import { assertWritable, type Project } from "./project.js";
import {
  TaskPatchSchema,
  defaultCategory,
  validate,
  type Assignee,
  type TaskFrontmatter,
  type TaskPatch,
} from "./schema.js";

export interface Task extends TaskFrontmatter {
  /** The body without the blank line after the closing `---`. */
  body: string;
  /** Absolute path of the task file. */
  file: string;
  /** contentHash of the full file text. The concurrency token (design 4.5). */
  etag: string;
}

export interface InvalidTaskFile {
  file: string;
  error: string;
}

// Valid tasks sort by ULID (oldest first). Invalid files do not stop the list.
export interface TaskList {
  tasks: Task[];
  invalid: InvalidTaskFile[];
}

export interface TaskFilter {
  category?: string;
  /** `null` selects tasks without an assignee. */
  assignee?: Assignee;
  needs_input?: boolean;
}

export interface WriteOptions {
  /** If set, the operation stops with code 5 when the file hash is different. */
  ifMatch?: string;
}

/** Reads all `*.md` files at depth 0 of `.tracker/tasks/`. */
export function list(p: Project, filter: TaskFilter = {}): TaskList {
  const tasks: Task[] = [];
  const invalid: InvalidTaskFile[] = [];
  for (const file of taskFilePaths(p.tasksDir)) {
    try {
      tasks.push(readTask(p, file));
    } catch (err) {
      invalid.push({ file, error: (err as Error).message });
    }
  }
  tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    tasks: tasks.filter(
      (t) =>
        (filter.category === undefined || t.category === filter.category) &&
        (filter.assignee === undefined || t.assignee === filter.assignee) &&
        (filter.needs_input === undefined || t.needs_input === filter.needs_input),
    ),
    invalid,
  };
}

/** Finds one task by short name or ULID. Codes 3 and 4. */
export function get(p: Project, ref: string): Task {
  const { tasks, invalid } = list(p);
  const hint = invalid.length > 0 ? ` (${invalid.length} task file(s) are not valid: run "tracker check")` : "";
  return resolveRef(tasks, ref, hint);
}

export function create(p: Project, input: { title: string; body?: string; category?: string }): Task {
  assertWritable(p);
  mkdirSync(p.tasksDir, { recursive: true });
  const now = new Date().toISOString();
  const short = nextShort(list(p).tasks);
  const make = () => {
    const frontmatter: TaskFrontmatter = {
      id: newUlid(),
      short,
      title: input.title,
      category: input.category ?? defaultCategory(p.config),
      assignee: null,
      needs_input: false,
      created_at: now,
      updated_at: now,
    };
    const file = join(p.tasksDir, fileName(short, frontmatter.id));
    const body = normalizeBody(input.body ?? "");
    const text = toText(p, frontmatter, body, file);
    createExclusive(file, text);
    return toTask(file, text, frontmatter, body);
  };
  try {
    return make();
  } catch (err) {
    // The file exists: try again one time with a new ULID.
    if (err instanceof TrackerError && err.code === EXIT_CONFLICT) return make();
    throw err;
  }
}

/** Changes title, category, assignee, needs_input or body. Sets `updated_at`. */
export function update(p: Project, ref: string, patch: TaskPatch, opts: WriteOptions = {}): Task {
  assertWritable(p);
  const fields = validate(TaskPatchSchema, patch, "task change");
  const task = get(p, ref);
  checkMatch(task, opts.ifMatch);

  const { body, ...changes } = fields;
  const frontmatter: TaskFrontmatter = {
    ...frontmatterOf(task),
    ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)),
    updated_at: new Date().toISOString(),
  };
  const newBody = body === undefined ? task.body : normalizeBody(body);
  const text = toText(p, frontmatter, newBody, task.file);

  assertUnchanged(task);
  atomicWrite(task.file, text);
  return toTask(task.file, text, frontmatter, newBody);
}

/** Adds `text` to the end of the body, after a blank line. */
export function appendNote(p: Project, ref: string, text: string, opts: WriteOptions = {}): Task {
  if (text.trim() === "") throw new TrackerError(EXIT_VALIDATION, "note text must not be empty");
  const task = get(p, ref);
  checkMatch(task, opts.ifMatch);
  const note = normalizeBody(text);
  const body = task.body.trim() === "" ? note : task.body.replace(/\n*$/, "\n\n") + note;
  return update(p, task.id, { body }, { ifMatch: task.etag });
}

/** Gives the task a new short name and renames its file to match. For `check --fix`. */
export function changeShort(p: Project, task: Task, short: string): Task {
  assertWritable(p);
  const frontmatter: TaskFrontmatter = { ...frontmatterOf(task), short, updated_at: new Date().toISOString() };
  const file = join(p.tasksDir, fileName(short, task.id));
  const text = toText(p, frontmatter, task.body, file);
  assertUnchanged(task);
  createExclusive(file, text);
  unlinkSync(task.file);
  return toTask(file, text, frontmatter, task.body);
}

/** Deletes the task file. */
export function remove(p: Project, ref: string, opts: WriteOptions = {}): void {
  assertWritable(p);
  const task = get(p, ref);
  checkMatch(task, opts.ifMatch);
  unlinkSync(task.file);
}

/** Absolute paths of the `*.md` files at depth 0 of a tasks folder, sorted by name. */
export function taskFilePaths(tasksDir: string): string[] {
  try {
    return readdirSync(tasksDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(tasksDir, e.name))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

function readTask(p: Project, file: string): Task {
  const text = readFileSync(file, "utf8");
  const { frontmatter, body } = parseTaskFile(text, { categories: p.config.categories, source: basename(file) });
  return toTask(file, text, frontmatter, body.replace(/^\r?\n/, ""));
}

function toText(p: Project, frontmatter: TaskFrontmatter, body: string, file: string): string {
  return serializeTaskFile(
    { frontmatter, body: body === "" ? "" : `\n${body}` },
    { categories: p.config.categories, source: basename(file) },
  );
}

function toTask(file: string, text: string, frontmatter: TaskFrontmatter, body: string): Task {
  return { ...frontmatter, body, file, etag: contentHash(text) };
}

function frontmatterOf(t: Task): TaskFrontmatter {
  const { body: _body, file: _file, etag: _etag, ...fm } = t;
  return fm;
}

/** A second read: the file must not change during the operation. */
function assertUnchanged(task: Task): void {
  let current: string | undefined;
  try {
    current = readFileSync(task.file, "utf8");
  } catch {
    current = undefined;
  }
  if (current === undefined || contentHash(current) !== task.etag) {
    throw new TrackerError(EXIT_CONFLICT, `${task.short}: the file changed during the operation. Try again.`);
  }
}

function checkMatch(task: Task, ifMatch: string | undefined): void {
  if (ifMatch !== undefined && ifMatch !== task.etag) {
    throw new TrackerError(EXIT_CONFLICT, `${task.short}: the file changed. Load the task again.`);
  }
}

/** A non-empty body ends with a newline. */
function normalizeBody(body: string): string {
  return body === "" || body.endsWith("\n") ? body : `${body}\n`;
}
