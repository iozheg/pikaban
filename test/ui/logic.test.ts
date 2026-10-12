import { describe, expect, it } from "vitest";
import {
  ApiError,
  apiErrorFrom,
  applyCurrent,
  assigneeLabel,
  buildPatch,
  categoryLabel,
  clampEditorWidth,
  columnsOf,
  draftOf,
  editorReducer,
  initEditor,
  isConflict,
  isDirty,
  moveTaskLocal,
  needsInputOnSave,
  pickProject,
  planEvent,
  removeInvalid,
  revertMove,
  sortTasks,
  upsertTask,
  useMineRequest,
  type EditorState,
} from "../../src/ui/logic.js";
import type { ProjectSummary, Task } from "../../src/ui/types.js";

// ULIDs in time sequence: A < B < C.
const A = "01JA0000000000000000000001";
const B = "01JA0000000000000000000002";
const C = "01JB0000000000000000000000";

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    short: `task-${id.slice(-4)}`,
    title: `Task ${id.slice(-1)}`,
    category: "backlog",
    assignee: null,
    needs_input: false,
    created_at: "2026-10-05T10:00:00.000Z",
    updated_at: "2026-10-05T10:00:00.000Z",
    body: "Body\n",
    file: `task-${id.slice(-4)}-${id}.md`,
    etag: `etag-${id}-1`,
    ...fields,
  };
}

function project(pid: string, status: ProjectSummary["status"] = "ok"): ProjectSummary {
  return { pid, root: `/p/${pid}`, name: pid, project_id: pid, schema_version: 1, status, config: null };
}

describe("task lists", () => {
  it("sorts by ULID, oldest first", () => {
    expect(sortTasks([task(C), task(A), task(B)]).map((t) => t.id)).toEqual([A, B, C]);
  });

  it("makes one column for each category, in config sequence", () => {
    const cols = columnsOf(
      ["backlog", "todo", "in_progress", "done"],
      [task(C, { category: "todo" }), task(B), task(A, { category: "todo" })],
    );
    expect(cols.map((c) => c.category)).toEqual(["backlog", "todo", "in_progress", "done"]);
    expect(cols[0]!.tasks.map((t) => t.id)).toEqual([B]);
    expect(cols[1]!.tasks.map((t) => t.id)).toEqual([A, C]);
    expect(cols[2]!.tasks).toEqual([]);
  });

  it("upsert replaces a task with the same id and keeps the sequence", () => {
    const list = [task(A), task(C)];
    expect(upsertTask(list, task(B)).map((t) => t.id)).toEqual([A, B, C]);
    const replaced = upsertTask(list, task(A, { title: "New" }));
    expect(replaced.map((t) => t.title)).toEqual(["New", "Task 0"]);
  });

  it("an optimistic move is reverted only while the list has the optimistic version", () => {
    const prev = task(A);
    const moved = moveTaskLocal([prev, task(B)], A, "in_progress");
    expect(moved[0]!.category).toBe("in_progress");
    expect(revertMove(moved, prev)[0]).toBe(prev);
    // A newer version arrived from the server (another etag): it stays.
    const newer = upsertTask(moved, task(A, { category: "done", etag: "etag-new" }));
    expect(revertMove(newer, prev)[0]!.category).toBe("done");
  });

  it("after 412 uses the current task, or removes it if the file is gone", () => {
    const list = [task(A), task(B)];
    const current = task(A, { title: "Changed on disk", etag: "etag-2" });
    expect(applyCurrent(list, A, current)[0]).toBe(current);
    expect(applyCurrent(list, A, null).map((t) => t.id)).toEqual([B]);
  });

  it("removes an error card by file name", () => {
    const invalid = [
      { file: "a.md", error: "x" },
      { file: "b.md", error: "y" },
    ];
    expect(removeInvalid(invalid, "a.md")).toEqual([{ file: "b.md", error: "y" }]);
    expect(removeInvalid(invalid, undefined)).toEqual(invalid);
  });
});

describe("API errors", () => {
  it("reads the error body and the current task of a 412", () => {
    const current = task(A);
    const err = apiErrorFrom(412, { error: { code: 5, message: "conflict" }, current }, "Precondition Failed");
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("conflict");
    expect(err.code).toBe(5);
    expect(err.current).toBe(current);
    expect(isConflict(err)).toBe(true);
  });

  it("current: null means that the file is gone; no current field gives undefined", () => {
    expect(apiErrorFrom(412, { error: { code: 5, message: "c" }, current: null }).current).toBeNull();
    expect(apiErrorFrom(404, { error: { code: 3, message: "not found" } }).current).toBeUndefined();
  });

  it("uses the HTTP status if the body is not an error body", () => {
    const err = apiErrorFrom(502, undefined, "Bad Gateway");
    expect(err.message).toBe("HTTP 502 Bad Gateway");
    expect(isConflict(err)).toBe(false);
    expect(isConflict(new Error("x"))).toBe(false);
  });
});

describe("projects", () => {
  const list = [project("p1", "missing"), project("p2"), project("p3"), project("p4", "schema_mismatch")];

  it("selects the remembered project if it is available", () => {
    expect(pickProject(list, "p3")).toBe("p3");
  });

  it("else selects the first available project", () => {
    expect(pickProject(list, null)).toBe("p2");
    expect(pickProject(list, "p4")).toBe("p2");
    expect(pickProject(list, "gone")).toBe("p2");
  });

  it("gives null if no project is available", () => {
    expect(pickProject([project("x", "invalid")], "x")).toBeNull();
    expect(pickProject([], null)).toBeNull();
  });
});

describe("labels", () => {
  it("names the default categories in sentence case", () => {
    expect(["backlog", "todo", "in_progress", "review", "done"].map(categoryLabel)).toEqual([
      "Backlog",
      "To do",
      "In progress",
      "Review",
      "Done",
    ]);
  });

  it("makes a label for other categories from config.json", () => {
    expect(categoryLabel("waiting_for_qa")).toBe("Waiting for qa");
    expect(categoryLabel("ideas")).toBe("Ideas");
    expect(categoryLabel("_")).toBe("_");
  });

  it('calls the "user" assignee "Developer"', () => {
    expect([null, "agent", "user"].map((a) => assigneeLabel(a as Task["assignee"]))).toEqual(["Nobody", "Agent", "Developer"]);
  });
});

describe("SSE events", () => {
  it("projects: load the project list", () => {
    expect(planEvent({ type: "projects" }, null)).toEqual({ kind: "projects" });
  });

  it("ignores events of other projects", () => {
    expect(planEvent({ type: "changed", pid: "other", id: A, file: "f.md" }, "p")).toEqual({ kind: "none" });
    expect(planEvent({ type: "config", pid: "p" }, null)).toEqual({ kind: "none" });
  });

  it("config: load the project list and the tasks again", () => {
    expect(planEvent({ type: "config", pid: "p" }, "p")).toEqual({ kind: "project" });
  });

  it("changed or removed with an id: one task", () => {
    expect(planEvent({ type: "changed", pid: "p", id: A, file: "f.md" }, "p")).toEqual({ kind: "task", id: A });
    expect(planEvent({ type: "removed", pid: "p", id: A, file: "f.md" }, "p")).toEqual({
      kind: "removed",
      id: A,
      file: "f.md",
    });
  });

  it("without an id: the task list", () => {
    expect(planEvent({ type: "changed", pid: "p", file: "notes.md" }, "p")).toEqual({ kind: "tasks" });
    expect(planEvent({ type: "removed", pid: "p", file: "notes.md" }, "p")).toEqual({ kind: "tasks" });
  });
});

describe("needs_input on save (design 7.1 item 6)", () => {
  const base = task(A, { needs_input: true, body: "Q: which provider?\n" });

  it("a changed body clears the flag if the user did not touch the check box", () => {
    const draft = { ...draftOf(base), body: "Q: which provider?\nA: GitHub.\n" };
    expect(needsInputOnSave(base, draft, false)).toBe(false);
    expect(buildPatch(base, draft, false)).toEqual({ body: draft.body, needs_input: false });
  });

  it("the user can set the flag again before the save", () => {
    // The user cleared the box and set it again: touched, value true.
    const draft = { ...draftOf(base), body: "Q: ...\nA: ...\nQ: one more?\n", needs_input: true };
    expect(needsInputOnSave(base, draft, true)).toBe(true);
    expect(buildPatch(base, draft, true)).toEqual({ body: draft.body });
  });

  it("without a body change the flag stays", () => {
    const draft = { ...draftOf(base), title: "New title" };
    expect(buildPatch(base, draft, false)).toEqual({ title: "New title" });
  });

  it("an explicit change of the check box is sent", () => {
    const draft = { ...draftOf(base), needs_input: false };
    expect(buildPatch(base, draft, true)).toEqual({ needs_input: false });
    const off = task(B);
    expect(buildPatch(off, { ...draftOf(off), needs_input: true }, true)).toEqual({ needs_input: true });
  });

  it("a body change on a task without the flag does not send needs_input", () => {
    const off = task(B);
    expect(buildPatch(off, { ...draftOf(off), body: "new" }, false)).toEqual({ body: "new" });
  });
});

describe("buildPatch", () => {
  const base = task(A);

  it("is empty if nothing changed", () => {
    expect(buildPatch(base, draftOf(base), false)).toEqual({});
    expect(buildPatch(base, draftOf(base), true)).toEqual({});
  });

  it("sends only the changed fields, with a trimmed title", () => {
    const draft = { ...draftOf(base), title: "  Better title ", category: "todo", assignee: "agent" as const };
    expect(buildPatch(base, draft, false)).toEqual({ title: "Better title", category: "todo", assignee: "agent" });
  });

  it("an untouched title with spaces around it is no change", () => {
    const spaced = task(A, { title: " Fix login " });
    expect(buildPatch(spaced, draftOf(spaced), false)).toEqual({});
    expect(isDirty(initEditor(spaced))).toBe(false);
    expect(buildPatch(spaced, { ...draftOf(spaced), category: "todo" }, false)).toEqual({ category: "todo" });
  });

  it("sends assignee null to remove the assignee", () => {
    const b = task(A, { assignee: "user" });
    expect(buildPatch(b, { ...draftOf(b), assignee: null }, false)).toEqual({ assignee: null });
  });
});

describe("editor reducer", () => {
  const base = task(A, { needs_input: true, body: "Q?\n" });
  const edited = (): EditorState => editorReducer(initEditor(base), { type: "edit", fields: { body: "Q?\nA!\n" } });

  it("edit marks the draft dirty; a check box edit is remembered as touched", () => {
    const s0 = initEditor(base);
    expect(isDirty(s0)).toBe(false);
    expect(isDirty(edited())).toBe(true);
    const s1 = editorReducer(s0, { type: "edit", fields: { needs_input: false } });
    expect(s1.needsTouched).toBe(true);
    const s2 = editorReducer(s1, { type: "edit", fields: { needs_input: true } });
    expect(s2.needsTouched).toBe(true);
    expect(isDirty(s2)).toBe(false);
  });

  it("saved resets the editor to the saved task", () => {
    const saved = task(A, { body: "Q?\nA!\n", etag: "etag-2" });
    const s = editorReducer(edited(), { type: "saved", task: saved });
    expect(s).toEqual(initEditor(saved));
  });

  it("a disk change without unsaved edits refreshes silently", () => {
    const disk = task(A, { title: "Agent changed it", etag: "etag-2" });
    expect(editorReducer(initEditor(base), { type: "disk", task: disk })).toEqual(initEditor(disk));
  });

  it("the same version (same etag) changes nothing", () => {
    const s = edited();
    expect(editorReducer(s, { type: "disk", task: { ...base, category: "todo" } })).toBe(s);
  });

  it("a disk change with unsaved edits keeps the draft and shows a notice", () => {
    const disk = task(A, { body: "Q?\nQ2?\n", etag: "etag-2" });
    const s = editorReducer(edited(), { type: "disk", task: disk });
    expect(s.draft.body).toBe("Q?\nA!\n");
    expect(s.base).toBe(base);
    expect(s.disk).toEqual({ task: disk });
    const discarded = editorReducer(s, { type: "discardMine" });
    expect(discarded).toEqual(initEditor(disk));
  });

  it("a deleted task shows a notice, also without edits", () => {
    const s = editorReducer(initEditor(base), { type: "disk", task: null });
    expect(s.disk).toEqual({ task: null });
    expect(editorReducer(s, { type: "discardMine" })).toBe(s);
  });

  it("412 keeps the user's text; Use mine sends the user's edits with the new etag", () => {
    const current = task(A, { title: "Agent title", body: "Q?\nQ2?\n", needs_input: true, etag: "etag-2" });
    const s = editorReducer(edited(), { type: "conflict", current });
    expect(s.draft.body).toBe("Q?\nA!\n");
    expect(s.conflict).toEqual({ current });
    // Only the user's edits (relative to the version they started from), not the agent's title.
    expect(useMineRequest(s)).toEqual({ patch: { body: "Q?\nA!\n", needs_input: false }, etag: "etag-2" });
  });

  it("412: Discard mine loads the version on disk", () => {
    const current = task(A, { body: "disk\n", etag: "etag-2" });
    const s = editorReducer(edited(), { type: "conflict", current });
    expect(editorReducer(s, { type: "discardMine" })).toEqual(initEditor(current));
  });

  it("412 with a deleted file: no Use mine", () => {
    const s = editorReducer(edited(), { type: "conflict", current: null });
    expect(useMineRequest(s)).toBeNull();
    expect(editorReducer(s, { type: "discardMine" })).toBe(s);
  });

  it("during a conflict, a newer disk version replaces the shown one; the same one changes nothing", () => {
    const current = task(A, { etag: "etag-2" });
    const s = editorReducer(edited(), { type: "conflict", current });
    expect(editorReducer(s, { type: "disk", task: current })).toBe(s);
    const newer = task(A, { etag: "etag-3" });
    const s2 = editorReducer(s, { type: "disk", task: newer });
    expect(s2.conflict).toEqual({ current: newer });
    expect(useMineRequest(s2)?.etag).toBe("etag-3");
  });
});

describe("clampEditorWidth", () => {
  it("keeps the width between the minimum and half of the area", () => {
    expect(clampEditorWidth(500, 1600)).toBe(500);
    expect(clampEditorWidth(1000, 1600)).toBe(800);
    expect(clampEditorWidth(100, 1600)).toBe(320);
    expect(clampEditorWidth(450.6, 1600)).toBe(451);
  });

  it("gives the minimum when half of the area is smaller", () => {
    expect(clampEditorWidth(500, 500)).toBe(320);
  });
});
