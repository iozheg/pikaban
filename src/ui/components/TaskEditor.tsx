import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { api } from "../api.js";
import {
  assigneeLabel,
  buildPatch,
  categoryLabel,
  CONFLICT_MESSAGE,
  editorReducer,
  errorMessage,
  initEditor,
  isConflict,
  isDirty,
  isEmptyPatch,
  useMineRequest,
  type Draft,
} from "../logic.js";
import { renderMarkdown } from "../markdown.js";
import type { Assignee, Task } from "../types.js";

interface TaskEditorProps {
  pid: string;
  /** The task on the board now. null: the task is gone (deleted on disk). */
  task: Task | null;
  /** The task when the editor opened. */
  initial: Task;
  categories: string[];
  onClose(): void;
  /** A new version of the task (saved, or the disk version after 412). */
  onTask(task: Task): void;
  /** The task file is gone. Remove the card. */
  onGone(id: string): void;
  onDirtyChange(dirty: boolean): void;
  notify(message: string): void;
}

const ASSIGNEES: Assignee[] = [null, "agent", "user"];

const SAVE_SHORTCUT = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘S" : "Ctrl+S";

const toAssignee = (v: string): Assignee => (v === "agent" || v === "user" ? v : null);

/** The task editor (design 7.1 items 5, 6, 7 and 8). A side panel docked next to the board. */
export function TaskEditor(props: TaskEditorProps) {
  const { pid, task, initial, categories, onClose, onTask, onGone, onDirtyChange, notify } = props;
  const [s, dispatch] = useReducer(editorReducer, initial, initEditor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The body shows as rendered Markdown until the user clicks Edit.
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const dirty = isDirty(s);
  const gone = s.conflict ? s.conflict.current === null : s.disk?.task === null;
  const base = s.base;

  // A new version on the board (SSE or a drag): refresh silently, or show a notice if the draft has edits.
  useEffect(() => dispatch({ type: "disk", task }), [task]);
  useEffect(() => onDirtyChange(dirty), [dirty]);
  useEffect(() => () => onDirtyChange(false), []);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // The title grows with its text.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [s.draft.title]);
  useLayoutEffect(() => {
    if (!editing || !bodyRef.current) return;
    bodyRef.current.setSelectionRange(0, 0);
    bodyRef.current.focus();
  }, [editing]);

  const requestClose = () => {
    if (dirty && !confirm("Discard your unsaved changes?")) return;
    onClose();
  };

  // Escape closes the editor. Ctrl+S / Cmd+S saves.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      requestClose();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const edit = (fields: Partial<Draft>) => dispatch({ type: "edit", fields });

  /** Sends one PATCH. On 412, keeps the draft and shows the disk version. */
  async function send(patch: ReturnType<typeof buildPatch>, etag: string) {
    if (patch.title !== undefined && patch.title === "") {
      setError("The title must not be empty.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.patchTask(pid, base.id, patch, etag);
      dispatch({ type: "saved", task: saved });
      setEditing(false);
      onTask(saved);
    } catch (err) {
      if (isConflict(err)) {
        const current = err.current ?? null;
        dispatch({ type: "conflict", current });
        if (current) onTask(current);
        else onGone(base.id);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (busy || s.conflict || gone) return;
    const patch = buildPatch(s.base, s.draft, s.needsTouched);
    if (isEmptyPatch(patch)) return;
    await send(patch, s.base.etag);
  }

  async function useMine() {
    const req = useMineRequest(s);
    if (!req) return;
    if (isEmptyPatch(req.patch)) {
      dispatch({ type: "discardMine" });
      return;
    }
    await send(req.patch, req.etag);
  }

  function discardMine() {
    if (gone) {
      onClose();
      return;
    }
    dispatch({ type: "discardMine" });
    setError(null);
  }

  /** Puts the body back as it was and shows the rendered view. Other fields keep their edits. */
  function cancelBody() {
    edit({ body: s.base.body });
    setEditing(false);
  }

  async function remove() {
    if (!confirm(`Delete ${base.short} "${base.title}"?\n\nThe task file is deleted.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTask(pid, base.id, base.etag);
      onGone(base.id);
      notify(`Deleted ${base.short}.`);
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        const current = err.current ?? null;
        if (current) {
          onTask(current);
          dispatch({ type: "disk", task: current });
          notify(`${CONFLICT_MESSAGE} It was not deleted.`);
        } else {
          onGone(base.id);
          notify(`${base.short} was already deleted.`);
          onClose();
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const bodyChanged = s.draft.body !== base.body;
  const willClear = bodyChanged && !s.needsTouched && base.needs_input;
  const preview = useMemo(() => (editing ? "" : renderMarkdown(s.draft.body)), [editing, s.draft.body]);
  // During a conflict the fields stay editable: the user can merge the disk text into the draft, then "Use mine".
  const locked = busy;

  async function copyShort() {
    try {
      await navigator.clipboard.writeText(base.short);
    } catch (err) {
      notify(`Cannot copy ${base.short}: ${errorMessage(err)}`);
      return;
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <aside class={`editor${s.conflict ? " has-conflict" : ""}`} aria-label={`Task ${base.short}`}>
      <header class="editor-head">
        {/* The task number and the icon are one button: a click on either copies the number. */}
        <button
          type="button"
          class="copy-button"
          onClick={() => void copyShort()}
          title="Copy task number"
          aria-label={`Copy task number ${base.short}`}
        >
          <span class="editor-short">{base.short}</span>
          <CopyIcon />
          {copied && <span class="copied">Copied</span>}
        </button>
        <span class="spacer" />
        <button type="button" class="close-button" onClick={requestClose} aria-label="Close the editor" title="Close (Esc)">
          ×
        </button>
      </header>

      <div class="editor-body">
        {s.disk && !s.conflict && (
          <div class="notice notice-warn" role="status">
            {s.disk.task ? (
              <>
                <p>This task changed on disk. Your unsaved edits are kept. If you save, the editor shows both versions.</p>
                <button type="button" onClick={discardMine}>
                  Discard mine and load the disk version
                </button>
              </>
            ) : (
              <>
                <p>This task was deleted on disk. You cannot save it. Copy your text if you need it.</p>
                <button type="button" onClick={onClose}>
                  Close
                </button>
              </>
            )}
          </div>
        )}

        {s.conflict && (
          <div class="notice notice-error" role="alert">
            {s.conflict.current ? (
              <p>
                This task changed on disk before your save. Your text is kept in the editor. Compare it with the
                version on disk.
              </p>
            ) : (
              <p>This task was deleted on disk before your save. Your text is kept in the editor. Copy it if you need it.</p>
            )}
            <div class="button-row">
              {s.conflict.current && (
                <button type="button" class="primary" disabled={busy} onClick={() => void useMine()}>
                  Use mine
                </button>
              )}
              <button type="button" disabled={busy} onClick={discardMine}>
                Discard mine
              </button>
            </div>
          </div>
        )}

        <form
          class="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {/* A textarea, so that a long title wraps like a heading. A title has no line breaks. */}
          <textarea
            ref={titleRef}
            class="title-input"
            rows={1}
            aria-label="Title"
            placeholder="Title"
            value={s.draft.title}
            required
            readOnly={locked}
            onInput={(e) => edit({ title: e.currentTarget.value.replace(/[\r\n]+/g, " ") })}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />

          <label
            class={`needs-toggle${s.draft.needs_input ? " is-on" : ""}`}
            title="Saving a changed description clears this flag, unless you change this box yourself."
          >
            <input
              type="checkbox"
              checked={s.draft.needs_input}
              disabled={locked}
              onChange={(e) => edit({ needs_input: e.currentTarget.checked })}
            />
            Needs input from developer
          </label>

          <div class="field-grid">
            <label class="field">
              <span class="field-label">Status</span>
              <select
                value={s.draft.category}
                disabled={locked}
                onChange={(e) => edit({ category: e.currentTarget.value })}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              <span class="field-label">Assignee</span>
              <select
                value={s.draft.assignee ?? ""}
                disabled={locked}
                onChange={(e) => edit({ assignee: toAssignee(e.currentTarget.value) })}
              >
                {ASSIGNEES.map((a) => (
                  <option key={a} value={a ?? ""}>
                    {assigneeLabel(a)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div class="field">
            <span class="field-label">Description</span>
            {editing ? (
              <>
                <textarea
                  ref={bodyRef}
                  class="body-input"
                  rows={10}
                  aria-label="Description (Markdown)"
                  placeholder="Description (Markdown)"
                  value={s.draft.body}
                  readOnly={locked}
                  spellcheck
                  onInput={(e) => edit({ body: e.currentTarget.value })}
                />
                <p class={`hint${willClear ? " hint-warn" : ""}`}>
                  {base.needs_input && !s.needsTouched ? "Saving clears “needs input”." : "Markdown"}
                </p>
              </>
            ) : (
              // Only the pencil starts editing, so the rendered text can be selected and copied; an empty
              // description has nothing to select, so a click on it starts editing too.
              <div class="preview">
                <button
                  type="button"
                  class="body-edit"
                  aria-label="Edit the description"
                  title="Edit"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon />
                </button>
                {s.draft.body.trim() === "" ? (
                  <p class="preview-empty" onClick={() => setEditing(true)}>
                    No description. Click to add one.
                  </p>
                ) : (
                  <div class="markdown" dangerouslySetInnerHTML={{ __html: preview }} />
                )}
              </div>
            )}
          </div>

          {error && (
            <p class="form-error" role="alert">
              {error}
            </p>
          )}

          <div class="editor-actions">
            <button type="submit" class="primary" disabled={!dirty || busy || s.conflict !== null || gone}>
              {busy ? "Saving…" : "Save"}
            </button>
            {/* During a conflict the notice has its own "Use mine" and "Discard mine". */}
            {editing && !s.conflict ? (
              <button type="button" disabled={busy} onClick={cancelBody}>
                Cancel
              </button>
            ) : (
              <button type="button" onClick={requestClose}>
                Close
              </button>
            )}
            {dirty && <span class="unsaved">Unsaved changes</span>}
            <span class="spacer" />
            <span class="shortcut">{SAVE_SHORTCUT}</span>
          </div>

          <footer class="editor-foot">
            <div class="meta">
              <span class="meta-file" title={base.id}>
                {base.file}
              </span>
              <span class="meta-dates">
                Created {formatTime(base.created_at)} · Updated {formatTime(base.updated_at)}
              </span>
            </div>
            <button type="button" class="delete-button" disabled={busy || gone || s.conflict !== null} onClick={() => void remove()}>
              Delete
            </button>
          </footer>
        </form>

        {s.conflict?.current && <DiskVersion task={s.conflict.current} />}
      </div>
    </aside>
  );
}

function PencilIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

/** The version on disk after a conflict, next to the user's text. */
function DiskVersion({ task }: { task: Task }) {
  return (
    <section class="disk-version" aria-label="The version on disk now">
      <h3>On disk now</h3>
      <dl class="disk-fields">
        <dt>Title</dt>
        <dd>{task.title}</dd>
        <dt>Status</dt>
        <dd>{categoryLabel(task.category)}</dd>
        <dt>Assignee</dt>
        <dd>{assigneeLabel(task.assignee)}</dd>
        <dt>Needs input</dt>
        <dd>{task.needs_input ? "yes" : "no"}</dd>
      </dl>
      <pre class="disk-body">{task.body}</pre>
    </section>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
