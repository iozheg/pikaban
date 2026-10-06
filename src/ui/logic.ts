// Pure UI logic (no DOM, no fetch), so that vitest can test it in Node.js.
import type { Assignee, InvalidFile, ProjectSummary, Task, TaskPatch, TrackerEvent } from "./types.js";

/** The short message after HTTP 412 on the board (plan step 11). */
export const CONFLICT_MESSAGE = "This task changed on disk. Reloaded.";

// ---------------------------------------------------------------------------------------------
// API errors

/** An error response of the API: `{"error":{"code","message"}}`. A 412 response also has `current`. */
export class ApiError extends Error {
  constructor(
    /** The HTTP status. 0 if the server did not answer. */
    readonly status: number,
    message: string,
    /** The tracker exit code from the error body, if there is one. */
    readonly code: number | null = null,
    /** Only for 412: the task on disk now, or null if the file is gone. */
    readonly current?: Task | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Makes an ApiError from a response status and its parsed JSON body (or undefined). */
export function apiErrorFrom(status: number, body: unknown, statusText = ""): ApiError {
  let message = statusText !== "" ? `HTTP ${status} ${statusText}` : `HTTP ${status}`;
  let code: number | null = null;
  let current: Task | null | undefined;
  if (body !== null && typeof body === "object") {
    const b = body as { error?: { code?: unknown; message?: unknown }; current?: unknown };
    if (b.error && typeof b.error.message === "string") message = b.error.message;
    if (b.error && typeof b.error.code === "number") code = b.error.code;
    if ("current" in b) current = (b.current ?? null) as Task | null;
  }
  return new ApiError(status, message, code, current);
}

/** True for HTTP 412: the file changed after the UI read it. */
export function isConflict(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 412;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------------------------
// Task lists

/** ULIDs sort by time: a string comparison gives oldest first (design 7.1 item 2). */
export function compareTasks(a: Task, b: Task): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}

export interface Column {
  category: string;
  tasks: Task[];
}

/** One column for each category, in the config sequence. Tasks sort by ULID. */
export function columnsOf(categories: readonly string[], tasks: readonly Task[]): Column[] {
  const sorted = sortTasks(tasks);
  return categories.map((category) => ({ category, tasks: sorted.filter((t) => t.category === category) }));
}

/** Adds the task, or replaces the task with the same id. The result is sorted. */
export function upsertTask(tasks: readonly Task[], task: Task): Task[] {
  return sortTasks([...tasks.filter((t) => t.id !== task.id), task]);
}

export function removeTask(tasks: readonly Task[], id: string): Task[] {
  return tasks.filter((t) => t.id !== id);
}

/** Optimistic move: the task shows in the new column before the server answers. */
export function moveTaskLocal(tasks: readonly Task[], id: string, category: string): Task[] {
  return tasks.map((t) => (t.id === id ? { ...t, category } : t));
}

/**
 * Undoes an optimistic move after an error. Only if the list still has the optimistic version
 * (the same etag as `prev`): a newer version from the server stays.
 */
export function revertMove(tasks: readonly Task[], prev: Task): Task[] {
  return tasks.map((t) => (t.id === prev.id && t.etag === prev.etag ? prev : t));
}

/** After 412: use `current` from the response. `null` means that the file is gone. */
export function applyCurrent(tasks: readonly Task[], id: string, current: Task | null): Task[] {
  return current === null ? removeTask(tasks, id) : upsertTask(tasks, current);
}

export function removeInvalid(invalid: readonly InvalidFile[], file: string | undefined): InvalidFile[] {
  return file === undefined ? [...invalid] : invalid.filter((f) => f.file !== file);
}

// ---------------------------------------------------------------------------------------------
// Projects

export function isAvailable(p: ProjectSummary): boolean {
  return p.status === "ok";
}

/** The project to show: `preferred` if it is in the list and available, else the first available one. */
export function pickProject(projects: readonly ProjectSummary[], preferred: string | null): string | null {
  const wanted = projects.find((p) => p.pid === preferred);
  if (wanted && isAvailable(wanted)) return wanted.pid;
  return projects.find(isAvailable)?.pid ?? null;
}

export function statusLabel(p: ProjectSummary): string {
  switch (p.status) {
    case "ok":
      return "available";
    case "missing":
      return "missing";
    case "schema_mismatch":
      return "different schema version";
    case "invalid":
      return "not valid";
  }
}

// ---------------------------------------------------------------------------------------------
// Live updates (design 7.3)

export type EventPlan =
  /** Load the project list again. */
  | { kind: "projects" }
  /** The config of the selected project changed: load the project list (it has the config) and the tasks. */
  | { kind: "project" }
  /** Load one task again. */
  | { kind: "task"; id: string }
  /** Remove one task (and an error card with the same file name). */
  | { kind: "removed"; id: string; file?: string }
  /** Load the task list of the selected project again. */
  | { kind: "tasks" }
  | { kind: "none" };

/** What to load again for an SSE event. `pid` is the selected project. */
export function planEvent(e: TrackerEvent, pid: string | null): EventPlan {
  if (e.type === "projects") return { kind: "projects" };
  if (pid === null || e.pid !== pid) return { kind: "none" };
  if (e.type === "config") return { kind: "project" };
  if (e.id === undefined) return { kind: "tasks" };
  if (e.type === "removed") return e.file === undefined ? { kind: "removed", id: e.id } : { kind: "removed", id: e.id, file: e.file };
  return { kind: "task", id: e.id };
}

// ---------------------------------------------------------------------------------------------
// Task editor (design 7.1 items 5, 6 and 8)

/** The editable fields. */
export interface Draft {
  title: string;
  category: string;
  assignee: Assignee;
  needs_input: boolean;
  body: string;
}

export function draftOf(t: Task): Draft {
  return { title: t.title, category: t.category, assignee: t.assignee, needs_input: t.needs_input, body: t.body };
}

/**
 * The `needs_input` value to save (design 7.1 item 6): the user writes answers in the body. When
 * the body changed and the user did not touch the check box, the save sets `needs_input: false`.
 * If the user touched the check box, its value is used.
 */
export function needsInputOnSave(base: Task, draft: Draft, needsTouched: boolean): boolean {
  if (needsTouched) return draft.needs_input;
  if (draft.body !== base.body) return false;
  return base.needs_input;
}

/** One PATCH with only the changed fields. Empty if nothing changed. */
export function buildPatch(base: Task, draft: Draft, needsTouched: boolean): TaskPatch {
  const patch: TaskPatch = {};
  const title = draft.title.trim();
  if (title !== base.title) patch.title = title;
  if (draft.category !== base.category) patch.category = draft.category;
  if (draft.assignee !== base.assignee) patch.assignee = draft.assignee;
  if (draft.body !== base.body) patch.body = draft.body;
  const needs = needsInputOnSave(base, draft, needsTouched);
  if (needs !== base.needs_input) patch.needs_input = needs;
  return patch;
}

export function isEmptyPatch(patch: TaskPatch): boolean {
  return Object.keys(patch).length === 0;
}

export interface EditorState {
  /** The version that the draft starts from. The PATCH sends its etag. */
  base: Task;
  draft: Draft;
  /** True after the user changed the `needs_input` check box. */
  needsTouched: boolean;
  /** After HTTP 412: the task on disk now (null: deleted). The draft stays (design 7.1 item 8). */
  conflict: { current: Task | null } | null;
  /** A newer version on disk while the draft has unsaved edits (null: deleted). */
  disk: { task: Task | null } | null;
}

export type EditorAction =
  | { type: "edit"; fields: Partial<Draft> }
  /** The server accepted the PATCH. */
  | { type: "saved"; task: Task }
  /** The server sent 412. */
  | { type: "conflict"; current: Task | null }
  /** A new version of the task arrived (SSE or board). null: the task is gone. */
  | { type: "disk"; task: Task | null }
  /** Discard the draft and use the version on disk (after a conflict or a disk change). */
  | { type: "discardMine" };

export function initEditor(task: Task): EditorState {
  return { base: task, draft: draftOf(task), needsTouched: false, conflict: null, disk: null };
}

export function isDirty(s: EditorState): boolean {
  return !isEmptyPatch(buildPatch(s.base, s.draft, s.needsTouched));
}

/** The PATCH for "Use mine" after a conflict: the user's edits, with the etag of the new version. */
export function useMineRequest(s: EditorState): { patch: TaskPatch; etag: string } | null {
  const current = s.conflict?.current;
  if (!current) return null;
  return { patch: buildPatch(s.base, s.draft, s.needsTouched), etag: current.etag };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "edit":
      return { ...s, draft: { ...s.draft, ...a.fields }, needsTouched: s.needsTouched || "needs_input" in a.fields };
    case "saved":
      return initEditor(a.task);
    case "conflict":
      return { ...s, conflict: { current: a.current }, disk: null };
    case "disk": {
      const t = a.task;
      if (s.conflict) {
        if ((t?.etag ?? null) === (s.conflict.current?.etag ?? null)) return s;
        return { ...s, conflict: { current: t } };
      }
      if (t !== null && t.etag === s.base.etag) return s;
      if (t !== null && !isDirty(s)) return initEditor(t);
      return { ...s, disk: { task: t } };
    }
    case "discardMine": {
      const t = s.conflict ? s.conflict.current : s.disk ? s.disk.task : s.base;
      return t === null ? s : initEditor(t);
    }
  }
}
