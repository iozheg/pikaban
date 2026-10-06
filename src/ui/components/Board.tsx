import { useState } from "preact/hooks";
import { columnsOf } from "../logic.js";
import type { InvalidFile, Task } from "../types.js";
import { Card, ErrorCard } from "./Card.js";

/** The drag data type. Other drags (files, text) are not accepted. */
const DRAG_TYPE = "application/x-tracker-task";

interface BoardProps {
  categories: string[];
  tasks: Task[];
  invalid: InvalidFile[];
  selectedId: string | null;
  onOpen(id: string): void;
  onMove(id: string, category: string): void;
}

/** One column for each category (design 7.1 item 2). HTML5 drag and drop moves a card (item 4). */
export function Board({ categories, tasks, invalid, selectedId, onOpen, onMove }: BoardProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const columns = columnsOf(categories, tasks);
  const dragFrom = dragId === null ? undefined : tasks.find((t) => t.id === dragId)?.category;

  const onDragStart = (id: string, e: DragEvent) => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(DRAG_TYPE, id);
    e.dataTransfer.setData("text/plain", tasks.find((t) => t.id === id)?.short ?? id);
    e.dataTransfer.effectAllowed = "move";
    setDragId(id);
  };
  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };
  const accepts = (e: DragEvent) => e.dataTransfer?.types.includes(DRAG_TYPE) ?? false;

  return (
    <div class="board-wrap">
      {invalid.length > 0 && (
        <section class="invalid-strip" aria-label="Task files that are not valid">
          <h2>
            Task files that are not valid <span class="count">{invalid.length}</span>
          </h2>
          <p class="hint">
            Correct these files by hand, or run <code>tracker check</code>. The other tasks operate normally.
          </p>
          <ul class="card-list invalid-list">
            {invalid.map((f) => (
              <ErrorCard key={f.file} file={f} />
            ))}
          </ul>
        </section>
      )}
      <div class="board">
        {columns.map((col) => (
          <section
            key={col.category}
            class={`column${over === col.category && dragFrom !== col.category ? " is-over" : ""}`}
            aria-label={`Column ${col.category}`}
            onDragOver={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
              if (over !== col.category) setOver(col.category);
            }}
            onDragLeave={(e) => {
              const to = e.relatedTarget as Node | null;
              if (to === null || !(e.currentTarget as HTMLElement).contains(to)) {
                setOver((o) => (o === col.category ? null : o));
              }
            }}
            onDrop={(e) => {
              if (!accepts(e)) return;
              e.preventDefault();
              const id = e.dataTransfer?.getData(DRAG_TYPE) ?? "";
              endDrag();
              if (id !== "") onMove(id, col.category);
            }}
          >
            <h2 class="column-head">
              <span class="column-name">{col.category}</span>
              <span class="count">{col.tasks.length}</span>
            </h2>
            <ul class="card-list">
              {col.tasks.map((t) => (
                <Card
                  key={t.id}
                  task={t}
                  selected={t.id === selectedId}
                  dragging={t.id === dragId}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onDragEnd={endDrag}
                />
              ))}
            </ul>
            {col.tasks.length === 0 && <p class="column-empty">No tasks</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
