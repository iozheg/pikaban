import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { api, connectEvents } from "./api.js";
import { Board } from "./components/Board.js";
import { ProjectSelector } from "./components/ProjectSelector.js";
import { TaskEditor } from "./components/TaskEditor.js";
import {
  ApiError,
  applyCurrent,
  CONFLICT_MESSAGE,
  errorMessage,
  isAvailable,
  isConflict,
  moveTaskLocal,
  pickProject,
  planEvent,
  removeInvalid,
  removeTask,
  revertMove,
  sortTasks,
  upsertTask,
} from "./logic.js";
import { loadSelectedProject, loadTheme, saveSelectedProject, saveTheme, type Theme } from "./storage.js";
import type { InvalidFile, ProjectSummary, Task, PikabanEvent } from "./types.js";
import "./styles.css";

interface Toast {
  id: number;
  text: string;
}

type Live = "connecting" | "live" | "down";

// Before the first render, so the board does not show the other theme first. Without a saved
// choice there is no attribute: the CSS follows prefers-color-scheme.
const savedTheme = loadTheme();
if (savedTheme !== null) document.documentElement.dataset.theme = savedTheme;
const darkQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

/** The theme switch: Light / Dark. Shows the system theme until the user picks one. */
function ThemeSwitch() {
  const [saved, setSaved] = useState<Theme | null>(savedTheme);
  const [systemDark, setSystemDark] = useState(darkQuery?.matches ?? false);
  useEffect(() => {
    if (!darkQuery) return;
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    darkQuery.addEventListener("change", h);
    return () => darkQuery.removeEventListener("change", h);
  }, []);
  const theme = saved ?? (systemDark ? "dark" : "light");
  const pick = (t: Theme) => {
    setSaved(t);
    saveTheme(t);
    document.documentElement.dataset.theme = t;
  };
  return (
    <div class="segmented" role="group" aria-label="Theme">
      {(["light", "dark"] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} class={theme === t ? "is-on" : ""} onClick={() => pick(t)}>
          {t === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [pid, setPid] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invalid, setInvalid] = useState<InvalidFile[]>([]);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openInitial, setOpenInitial] = useState<Task | null>(null);
  const [live, setLive] = useState<Live>("connecting");
  // "Waiting on developer": dims the other cards. Not saved.
  const [waitingFilter, setWaitingFilter] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // The SSE handlers and async loads read these refs, not stale state.
  const pidRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const preferredRef = useRef<string | null>(loadSelectedProject());
  const toastSeq = useRef(0);
  // The last move of each task: the saved task, or null if the move failed.
  const pendingMoves = useRef(new Map<string, Promise<Task | null>>());

  const notify = (text: string) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };

  const confirmDiscard = () => !dirtyRef.current || confirm("Discard your unsaved changes?");

  // --- Loads -----------------------------------------------------------------------------------

  async function loadTasks(p: string) {
    try {
      const list = await api.tasks(p);
      if (pidRef.current !== p) return;
      setTasks(sortTasks(list.tasks));
      setInvalid(list.invalid);
      setTasksError(null);
    } catch (err) {
      if (pidRef.current === p) setTasksError(errorMessage(err));
    }
  }

  async function loadTask(p: string, id: string) {
    try {
      const t = await api.task(p, id);
      if (pidRef.current !== p) return;
      setTasks((ts) => upsertTask(ts, t));
      setInvalid((inv) => removeInvalid(inv, t.file));
    } catch (err) {
      if (pidRef.current !== p) return;
      // 404: the file is gone, or it is not valid now (then the list shows an error card).
      if (err instanceof ApiError && err.status === 404) setTasks((ts) => removeTask(ts, id));
      void loadTasks(p);
    }
  }

  /** Selects a project. `force`: no question about unsaved edits (the project is gone). */
  function selectProject(next: string | null, force = false): boolean {
    if (next === pidRef.current) return true;
    if (!force && !confirmDiscard()) return false;
    pidRef.current = next;
    setPid(next);
    if (next !== null) {
      preferredRef.current = next;
      saveSelectedProject(next);
    }
    setOpenId(null);
    setTasks([]);
    setInvalid([]);
    setTasksError(null);
    if (next !== null) void loadTasks(next);
    return true;
  }

  /** The user selects a project. Loads the project list again too: it has the config. */
  function chooseProject(next: string): boolean {
    if (!selectProject(next)) return false;
    void loadProjects();
    return true;
  }

  async function loadProjects() {
    try {
      const list = await api.projects();
      setProjects(list);
      setProjectsError(null);
      const current = pidRef.current;
      // Keep the selected project while it is in the list, also when it is not available now:
      // the page then shows why.
      if (current === null || !list.some((p) => p.pid === current)) {
        selectProject(pickProject(list, current ?? preferredRef.current), true);
      }
    } catch (err) {
      setProjectsError(errorMessage(err));
    }
  }

  function reloadAll() {
    void loadProjects();
    const p = pidRef.current;
    if (p !== null) void loadTasks(p);
  }

  function onEvent(e: PikabanEvent) {
    const p = pidRef.current;
    const plan = planEvent(e, p);
    if (plan.kind === "none" || (plan.kind !== "projects" && p === null)) return;
    switch (plan.kind) {
      case "projects":
        void loadProjects();
        break;
      case "project":
        void loadProjects();
        void loadTasks(p!);
        break;
      case "task":
        void loadTask(p!, plan.id);
        break;
      case "removed":
        setTasks((ts) => removeTask(ts, plan.id));
        setInvalid((inv) => removeInvalid(inv, plan.file));
        break;
      case "tasks":
        void loadTasks(p!);
        break;
    }
  }

  // --- Live updates ------------------------------------------------------------------------------

  const handlers = useRef({ reloadAll, onEvent });
  handlers.current = { reloadAll, onEvent };

  useEffect(() => {
    void loadProjects();
    const close = connectEvents({
      // After each (re)connection, load everything: the watcher can miss very early changes.
      onOpen: () => {
        setLive("live");
        handlers.current.reloadAll();
      },
      onDown: () => setLive("down"),
      onEvent: (e) => handlers.current.onEvent(e),
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      close();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);

  // --- Board actions -----------------------------------------------------------------------------

  function moveTask(id: string, category: string) {
    const p = pidRef.current;
    const shown = tasks.find((t) => t.id === id);
    if (p === null || !shown || shown.category === category) return;
    setTasks((ts) => moveTaskLocal(ts, id, category));
    // A second move before the first one ends waits for it and sends its new etag: the optimistic
    // card still has the old one.
    const before = pendingMoves.current.get(id);
    const run = (async (): Promise<Task | null> => {
      const prev = before ? await before : shown;
      if (prev === null || pidRef.current !== p) return null;
      try {
        const saved = await api.patchTask(p, id, { category }, prev.etag);
        if (pidRef.current === p) setTasks((ts) => upsertTask(ts, saved));
        return saved;
      } catch (err) {
        if (pidRef.current !== p) return null;
        if (isConflict(err)) {
          setTasks((ts) => applyCurrent(ts, id, err.current ?? null));
          notify(CONFLICT_MESSAGE);
        } else {
          setTasks((ts) => revertMove(ts, prev));
          notify(`Cannot move ${prev.short}: ${errorMessage(err)}`);
        }
        return null;
      }
    })();
    pendingMoves.current.set(id, run);
    void run.finally(() => {
      if (pendingMoves.current.get(id) === run) pendingMoves.current.delete(id);
    });
  }

  /** Makes a task from a column's "+ Add task" input and opens it. */
  async function createTask(title: string, category: string): Promise<boolean> {
    const p = pidRef.current;
    if (p === null) return false;
    try {
      const t = await api.createTask(p, { title, category });
      if (pidRef.current !== p) return true;
      setTasks((ts) => upsertTask(ts, t));
      notify(`Added ${t.short}.`);
      openTask(t.id, t);
      return true;
    } catch (err) {
      notify(`Cannot add the task: ${errorMessage(err)}`);
      return false;
    }
  }

  /** `known`: the task, if `tasks` in this render does not have it yet (just made). */
  function openTask(id: string, known?: Task) {
    if (id === openId) return;
    const t = known ?? tasks.find((x) => x.id === id);
    if (!t || !confirmDiscard()) return;
    dirtyRef.current = false;
    setOpenInitial(t);
    setOpenId(id);
  }

  function closeEditor() {
    dirtyRef.current = false;
    setOpenId(null);
  }

  // --- Render ----------------------------------------------------------------------------------

  const summary = projects?.find((p) => p.pid === pid) ?? null;
  const config = summary?.status === "ok" ? summary.config : null;
  const openTaskNow = openId === null ? null : (tasks.find((t) => t.id === openId) ?? null);
  const waitingCount = tasks.filter((t) => t.needs_input).length;

  useEffect(() => {
    document.title = summary ? `${summary.name} · Pikaban` : "Pikaban";
  }, [summary?.name]);

  return (
    <div class="app">
      <header class="topbar">
        <h1 class="brand">Pikaban</h1>
        {projects && <ProjectSelector projects={projects} selected={pid} onSelect={chooseProject} />}
        <span class="spacer" />
        <span class={`live live-${live}`} title="Live updates from the files on disk">
          {live === "live" ? "Live" : live === "down" ? "Reconnecting…" : "Connecting…"}
        </span>
        {config && (
          <button
            type="button"
            class={`waiting-filter${waitingFilter ? " is-on" : ""}`}
            aria-pressed={waitingFilter}
            title="Dim the tasks that do not wait for the developer"
            onClick={() => setWaitingFilter((f) => !f)}
          >
            <span class="waiting-count">{waitingCount}</span>
            Waiting on developer
          </button>
        )}
        <ThemeSwitch />
      </header>

      <div class="content">
        <main class="main">
          {projectsError && (
            <div class="notice notice-error" role="alert">
              <p>Cannot load the projects: {projectsError}</p>
              <button type="button" onClick={() => void loadProjects()}>
                Try again
              </button>
            </div>
          )}

          {projects && projects.length === 0 && (
            <div class="empty">
              <h2>No projects</h2>
              <p>
                Run <code>pikaban init</code> in a project folder, or <code>pikaban projects add &lt;path&gt;</code>.
                The board shows the project at once.
              </p>
            </div>
          )}

          {projects && projects.length > 0 && pid === null && (
            <div class="empty">
              <h2>No available project</h2>
              <p>All projects in the list are unavailable. Open “unavailable projects” above to see why.</p>
            </div>
          )}

          {summary && !isAvailable(summary) && (
            <div class="notice notice-error" role="alert">
              <p>
                <strong>{summary.name}</strong> is not available: {summary.message ?? summary.status}
              </p>
            </div>
          )}

          {tasksError && summary && isAvailable(summary) && (
            <div class="notice notice-error" role="alert">
              <p>Cannot load the tasks: {tasksError}</p>
            </div>
          )}

          {pid !== null && config && summary && isAvailable(summary) && (
            <Board
              categories={config.categories}
              tasks={tasks}
              invalid={invalid}
              selectedId={openId}
              waitingFilter={waitingFilter}
              onOpen={openTask}
              onMove={moveTask}
              onCreate={createTask}
            />
          )}
        </main>

        {pid !== null && config && openId !== null && openInitial !== null && (
          <TaskEditor
            key={openId}
            pid={pid}
            task={openTaskNow}
            initial={openInitial}
            categories={config.categories}
            onClose={closeEditor}
            onTask={(t) => setTasks((ts) => upsertTask(ts, t))}
            onGone={(id) => setTasks((ts) => removeTask(ts, id))}
            onDirtyChange={(d) => {
              dirtyRef.current = d;
            }}
            notify={notify}
          />
        )}
      </div>

      <div class="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

render(<App />, document.getElementById("app")!);
