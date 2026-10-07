// Fetch wrapper for the UI server API (design 7.2) and the SSE client (design 7.3).
// Each task carries its `etag`. Writes send it in `If-Match`.
import { ApiError, apiErrorFrom } from "./logic.js";
import type { ProjectSummary, Task, TaskList, TaskPatch, PikabanEvent } from "./types.js";

interface CallOptions {
  body?: unknown;
  ifMatch?: string;
}

async function call<T>(method: string, path: string, opts: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ifMatch !== undefined) headers["If-Match"] = `"${opts.ifMatch}"`;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "The UI server does not answer. Make sure that `pikaban ui` runs.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text === "" ? undefined : JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!res.ok) throw apiErrorFrom(res.status, data, res.statusText);
  return data as T;
}

const enc = encodeURIComponent;
const projectPath = (pid: string) => `/api/projects/${enc(pid)}`;
const taskPath = (pid: string, id: string) => `${projectPath(pid)}/tasks/${enc(id)}`;

export const api = {
  projects: () => call<ProjectSummary[]>("GET", "/api/projects"),
  tasks: (pid: string) => call<TaskList>("GET", `${projectPath(pid)}/tasks`),
  task: (pid: string, id: string) => call<Task>("GET", taskPath(pid, id)),
  createTask: (pid: string, input: { title: string; body?: string; category?: string }) =>
    call<Task>("POST", `${projectPath(pid)}/tasks`, { body: input }),
  patchTask: (pid: string, id: string, patch: TaskPatch, etag: string) =>
    call<Task>("PATCH", taskPath(pid, id), { body: patch, ifMatch: etag }),
  deleteTask: (pid: string, id: string, etag: string) => call<void>("DELETE", taskPath(pid, id), { ifMatch: etag }),
};

export interface EventHandlers {
  onEvent(e: PikabanEvent): void;
  /** After each connection and each reconnection. Load everything again: events can be lost. */
  onOpen(): void;
  /** The connection stopped. The client connects again. */
  onDown(): void;
}

/** Connects to `GET /api/events`. Returns a function that closes the connection. */
export function connectEvents(h: EventHandlers): () => void {
  let es: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const open = () => {
    es = new EventSource("/api/events");
    es.onopen = () => h.onOpen();
    es.onmessage = (m: MessageEvent<string>) => {
      let e: PikabanEvent;
      try {
        e = JSON.parse(m.data) as PikabanEvent;
      } catch {
        return;
      }
      h.onEvent(e);
    };
    es.onerror = () => {
      h.onDown();
      // The browser connects again by itself, except after an HTTP error (for example 502 from
      // the Vite proxy): then the EventSource is closed. Make a new one.
      if (es?.readyState === EventSource.CLOSED && !closed) {
        es.close();
        retry = setTimeout(open, 2000);
      }
    };
  };
  open();
  return () => {
    closed = true;
    if (retry !== undefined) clearTimeout(retry);
    es?.close();
  };
}
