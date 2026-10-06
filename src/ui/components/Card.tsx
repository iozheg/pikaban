import type { InvalidFile, Task } from "../types.js";

interface CardProps {
  task: Task;
  selected: boolean;
  dragging: boolean;
  onOpen(id: string): void;
  onDragStart(id: string, e: DragEvent): void;
  onDragEnd(): void;
}

/** A task card: short name, title, assignee badge and "needs input" badge (design 7.1 item 3). */
export function Card({ task, selected, dragging, onOpen, onDragStart, onDragEnd }: CardProps) {
  const cls = ["card", selected ? "is-selected" : "", dragging ? "is-dragging" : "", task.needs_input ? "needs-input" : ""];
  return (
    <li
      class={cls.filter(Boolean).join(" ")}
      draggable
      data-id={task.id}
      onDragStart={(e) => onDragStart(task.id, e)}
      onDragEnd={onDragEnd}
    >
      <div class="card-head">
        <span class="card-short">{task.short}</span>
        <span class="badges">
          {task.needs_input && (
            <span class="badge badge-needs" title="The agent waits for an answer from the user">
              needs input
            </span>
          )}
          {task.assignee !== null && (
            <span class={`badge badge-${task.assignee}`} title={`Assignee: ${task.assignee}`}>
              {task.assignee}
            </span>
          )}
        </span>
      </div>
      <button type="button" class="card-title" onClick={() => onOpen(task.id)} title="Open the task editor">
        {task.title}
      </button>
    </li>
  );
}

/** A task file that is not valid (design 7.1 item 9). It cannot move: it has no valid category. */
export function ErrorCard({ file }: { file: InvalidFile }) {
  return (
    <li class="card card-error">
      <div class="card-head">
        <span class="card-short">{file.file}</span>
        <span class="badge badge-error">not valid</span>
      </div>
      <pre class="card-error-text">{file.error}</pre>
    </li>
  );
}
