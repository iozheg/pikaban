import { useState } from "preact/hooks";
import { api } from "../api.js";
import { errorMessage } from "../logic.js";
import type { Task } from "../types.js";

interface AddTaskProps {
  pid: string;
  firstCategory: string;
  onCreated(task: Task): void;
}

/** Makes a task in the first category (design 2.2, 7.1 item 7). */
export function AddTask({ pid, firstCategory, onCreated }: AddTaskProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [withBody, setWithBody] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    const t = title.trim();
    if (t === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: { title: string; body?: string } = { title: t };
      if (withBody && body.trim() !== "") input.body = body;
      const task = await api.createTask(pid, input);
      onCreated(task);
      setTitle("");
      setBody("");
      setWithBody(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="add-task" onSubmit={(e) => void submit(e)}>
      <div class="add-row">
        <input
          type="text"
          placeholder={`New task title (goes to “${firstCategory}”)`}
          aria-label="New task title"
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          disabled={busy}
        />
        <button type="button" class="ghost" aria-expanded={withBody} onClick={() => setWithBody(!withBody)}>
          {withBody ? "No body" : "+ Body"}
        </button>
        <button type="submit" class="primary" disabled={busy || title.trim() === ""}>
          Add task
        </button>
      </div>
      {withBody && (
        <textarea
          class="add-body"
          placeholder="Body (Markdown, optional)"
          aria-label="New task body"
          value={body}
          onInput={(e) => setBody(e.currentTarget.value)}
          disabled={busy}
        />
      )}
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
