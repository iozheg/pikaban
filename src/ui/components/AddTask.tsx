import { useState } from "preact/hooks";
import { api } from "../api.js";
import { errorMessage } from "../logic.js";
import type { Task } from "../types.js";

interface AddTaskProps {
  pid: string;
  onCreated(task: Task): void;
}

/** Makes a task in `todo`, like the agent does (design 2.2, 7.1 item 7). */
export function AddTask({ pid, onCreated }: AddTaskProps) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    const t = title.trim();
    if (t === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await api.createTask(pid, { title: t, category: "todo" });
      onCreated(task);
      setTitle("");
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
          placeholder={`New task title (goes to “todo”)`}
          aria-label="New task title"
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          disabled={busy}
        />
        <button type="submit" class="primary" disabled={busy || title.trim() === ""}>
          Add task
        </button>
      </div>
      {error && (
        <p class="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
