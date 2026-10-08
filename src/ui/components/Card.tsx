import type { InvalidFile, Task } from "../types.js";

interface CardProps {
  task: Task;
  selected: boolean;
  dragging: boolean;
  /** The "Waiting on developer" filter is on and this task does not wait. */
  dimmed: boolean;
  onOpen(id: string): void;
  onDragStart(id: string, e: DragEvent): void;
  onDragEnd(): void;
}

/** A task card: "needs input" label, title, then short name and assignee (design 7.1 item 3). */
export function Card({ task, selected, dragging, dimmed, onOpen, onDragStart, onDragEnd }: CardProps) {
  const cls = ["card", selected ? "is-selected" : "", dragging ? "is-dragging" : "", dimmed ? "is-dimmed" : ""];
  return (
    <li
      class={cls.filter(Boolean).join(" ")}
      draggable
      data-id={task.id}
      onClick={() => onOpen(task.id)}
      onDragStart={(e) => onDragStart(task.id, e)}
      onDragEnd={onDragEnd}
    >
      {task.needs_input && (
        <span class="needs-label" title="The agent waits for an answer from the developer">
          Needs input from developer
        </span>
      )}
      {/* The whole card opens the editor. The button gives keyboard access. */}
      <button type="button" class="card-title" title="Open the task editor">
        {task.title}
      </button>
      <div class="card-meta">
        <span class="card-short">{task.short}</span>
        {task.assignee !== null && (
          <span class={`assignee assignee-${task.assignee}`}>{task.assignee === "user" ? "developer" : "agent"}</span>
        )}
      </div>
    </li>
  );
}

/** A task file that is not valid (design 7.1 item 9). It cannot move: it has no valid category. */
export function ErrorCard({ file }: { file: InvalidFile }) {
  return (
    <li class="card card-error">
      <div class="card-meta">
        <span class="card-short">{file.file}</span>
        <span class="badge badge-error">not valid</span>
      </div>
      <pre class="card-error-text">{file.error}</pre>
    </li>
  );
}
