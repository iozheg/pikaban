import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { categoryLabel, columnsOf } from "../logic.js";
import type { InvalidFile, Task } from "../types.js";
import { Card, ErrorCard } from "./Card.js";

/** The drag data type. Other drags (files, text) are not accepted. */
const DRAG_TYPE = "application/x-pikaban-task";

interface BoardProps {
  categories: string[];
  tasks: Task[];
  invalid: InvalidFile[];
  selectedId: string | null;
  /** "Waiting on developer": dim the cards without `needs_input`. */
  waitingFilter: boolean;
  onOpen(id: string): void;
  onMove(id: string, category: string): void;
  /** Makes a task in the column. Resolves to false if it failed (the input then keeps the title). */
  onCreate(title: string, category: string): Promise<boolean>;
}

/** One column for each category (design 7.1 item 2). HTML5 drag and drop moves a card (item 4). */
export function Board(props: BoardProps) {
  const { categories, tasks, invalid, selectedId, waitingFilter, onOpen, onMove, onCreate } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // The "+ Add task" input: one column at a time.
  const [addingColumn, setAddingColumn] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => addRef.current?.focus(), [addingColumn]);
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

  const startAdd = (category: string) => {
    setAddingColumn(category);
    setAddTitle("");
  };
  // While the request runs, blur and Escape do not cancel: the task is made anyway.
  const cancelAdd = () => {
    if (!adding) setAddingColumn(null);
  };
  async function submitAdd(category: string) {
    const title = addTitle.trim();
    if (title === "" || adding) return;
    setAdding(true);
    try {
      if (await onCreate(title, category)) setAddingColumn(null);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div class="board-wrap">
      {invalid.length > 0 && (
        <section class="invalid-strip" aria-label="Task files that are not valid">
          <h2>
            Task files that are not valid <span class="count">{invalid.length}</span>
          </h2>
          <p class="hint">
            Correct these files by hand, or run <code>pikaban check</code>. The other tasks operate normally.
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
            aria-label={`Column ${categoryLabel(col.category)}`}
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
              <span class="column-name">{categoryLabel(col.category)}</span>
              <span class="column-count">{col.tasks.length}</span>
            </h2>
            <ul class="card-list">
              {col.tasks.map((t) => (
                <Card
                  key={t.id}
                  task={t}
                  selected={t.id === selectedId}
                  dragging={t.id === dragId}
                  dimmed={waitingFilter && !t.needs_input}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onDragEnd={endDrag}
                />
              ))}
            </ul>
            {addingColumn === col.category ? (
              <input
                type="text"
                ref={addRef}
                class="add-input"
                placeholder="Task title, then Enter"
                aria-label={`New task in ${categoryLabel(col.category)}`}
                value={addTitle}
                readOnly={adding}
                onInput={(e) => setAddTitle(e.currentTarget.value)}
                onBlur={cancelAdd}
                onKeyDown={(e) => {
                  if (e.isComposing) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitAdd(col.category);
                  } else if (e.key === "Escape") {
                    // The editor also closes on Escape: this Escape is for the input only.
                    e.preventDefault();
                    cancelAdd();
                  }
                }}
              />
            ) : (
              <button type="button" class="add-button" onClick={() => startAdd(col.category)}>
                + Add task
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
