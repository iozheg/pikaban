import { readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, resolve } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { globalConfigPath, projectPaths, ULID_RE } from "../core/index.js";
import { projectMap } from "./projects.js";

/**
 * An SSE event (design 7.3). The `data` of each SSE message is this object as JSON.
 * - `changed`: a task file was made or changed. `id` is the ULID from the file name.
 * - `removed`: the task file is gone.
 * - `config`: `.pikaban/config.json` of the project changed (or `.pikaban/` was made or removed).
 * - `projects`: `~/.pikaban_config.json` changed. No `pid`.
 */
export interface PikabanEvent {
  type: "changed" | "removed" | "config" | "projects";
  pid?: string;
  /** The task ULID, from the file name `task-XXXX-<ULID>.md`. Missing if the file name has another form. */
  id?: string;
  /** The task file name (no folder). For `changed` and `removed`. */
  file?: string;
}

export const DEBOUNCE_MS = 100;
export const HEARTBEAT_MS = 30_000;

// `task-XXXX-<ULID>.md`
const TASK_FILE_RE = new RegExp(`^task-\\d{4}-(${ULID_RE.source.slice(1, -1)})\\.md$`);

/** The ULID in a task file name, or undefined. */
export function idFromFileName(name: string): string | undefined {
  return TASK_FILE_RE.exec(name)?.[1];
}

/** The SSE clients of `GET /api/events`. */
export class EventHub {
  private readonly clients = new Set<ServerResponse>();
  private readonly timer: NodeJS.Timeout;

  constructor(heartbeatMs = HEARTBEAT_MS) {
    // A comment line keeps idle connections open.
    this.timer = setInterval(() => this.write(": ping\n\n"), heartbeatMs);
    this.timer.unref();
  }

  get size(): number {
    return this.clients.size;
  }

  connect(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
    });
    // `retry`: the browser connects again after 1 s if the connection stops.
    res.write("retry: 1000\n: connected\n\n");
    this.clients.add(res);
    const drop = () => this.clients.delete(res);
    req.on("close", drop);
    res.on("close", drop);
  }

  broadcast(event: PikabanEvent): void {
    this.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  private write(text: string): void {
    for (const c of this.clients) c.write(text);
  }

  /** Ends all SSE responses. */
  close(): void {
    clearInterval(this.timer);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}

interface WatchedProject {
  root: string;
  watcher: FSWatcher;
}

/**
 * Watches `.pikaban/config.json` and `.pikaban/tasks/*.md` (depth 0) of each project in the global
 * config, and the global config file (design 7.3). Events for the same task (or file) in a period of
 * `debounceMs` give one PikabanEvent. Initial "add" events are ignored.
 */
export class PikabanWatcher {
  private readonly projects = new Map<string, WatchedProject>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private globalWatcher: FSWatcher | undefined;
  private sync: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly homeDir: string,
    private readonly emit: (event: PikabanEvent) => void,
    private readonly opts: { debounceMs?: number; onError?: (err: unknown) => void } = {},
  ) {}

  /** Starts the watchers. Resolves when they are ready. */
  async start(): Promise<void> {
    const file = resolve(globalConfigPath(this.homeDir));
    const home = dirname(file);
    // Watch the folder, not the file: an atomic write replaces the file (a new inode).
    this.globalWatcher = this.makeWatcher(home, {
      depth: 0,
      ignored: (p) => {
        const r = resolve(p);
        return r !== home && r !== file;
      },
    });
    this.globalWatcher.on("all", (_event, p) => {
      if (resolve(p) !== file) return;
      this.schedule("projects", () => {
        // The catch keeps the chain usable: one failed sync must not stop the next ones.
        this.sync = this.sync
          .then(() => this.syncProjects())
          .then(() => this.emitIfOpen({ type: "projects" }))
          .catch((err: unknown) => this.opts.onError?.(err));
      });
    });
    await ready(this.globalWatcher);
    this.sync = this.syncProjects();
    await this.sync;
  }

  /** The pids that have a watcher. */
  watchedPids(): string[] {
    return [...this.projects.keys()];
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    await this.sync.catch(() => {});
    const all = [...this.projects.values()].map((p) => p.watcher);
    if (this.globalWatcher) all.push(this.globalWatcher);
    this.projects.clear();
    await Promise.all(all.map((w) => w.close()));
  }

  /** Adds and removes project watchers to agree with the global config. */
  private async syncProjects(): Promise<void> {
    if (this.closed) return;
    let wanted: Map<string, string>;
    try {
      wanted = projectMap(this.homeDir);
    } catch (err) {
      // Not valid JSON (for example, during a manual edit): keep the current watchers.
      this.opts.onError?.(err);
      return;
    }
    const closing: Promise<void>[] = [];
    for (const [pid, w] of this.projects) {
      if (wanted.get(pid) === w.root) continue;
      this.projects.delete(pid);
      closing.push(w.watcher.close());
    }
    const starting: Promise<void>[] = [];
    for (const [pid, root] of wanted) {
      if (this.projects.has(pid)) continue;
      const watcher = this.watchProject(pid, root);
      this.projects.set(pid, { root, watcher });
      starting.push(ready(watcher));
    }
    await Promise.all([...closing, ...starting]);
  }

  private watchProject(pid: string, root: string): FSWatcher {
    const { pikabanDir, tasksDir, configFile } = projectPaths(root);
    const isTaskFile = (p: string) => dirname(p) === tasksDir && p.endsWith(".md");
    const watcher = this.makeWatcher(pikabanDir, {
      depth: 1,
      ignored: (p) => {
        const r = resolve(p);
        return !(r === pikabanDir || r === tasksDir || r === configFile || isTaskFile(r));
      },
    });
    watcher.on("all", (event, p) => {
      const r = resolve(p);
      if (r === configFile || ((event === "addDir" || event === "unlinkDir") && (r === pikabanDir || r === tasksDir))) {
        this.schedule(`${pid}:config`, () => this.emitIfOpen({ pid, type: "config" }));
        return;
      }
      if (!isTaskFile(r)) return;
      const name = basename(r);
      const id = idFromFileName(name);
      // Key by ULID: `check --fix` renames a file (a new name with the same ULID).
      this.schedule(`${pid}:${id ?? name}`, () => {
        const current = currentFile(tasksDir, name, id);
        const ev: PikabanEvent = { pid, type: current === undefined ? "removed" : "changed", file: current ?? name };
        if (id !== undefined) ev.id = id;
        this.emitIfOpen(ev);
      });
    });
    return watcher;
  }

  private makeWatcher(path: string, opts: { depth: number; ignored: (p: string) => boolean }): FSWatcher {
    const w = watch(path, { ...opts, ignoreInitial: true, persistent: true });
    w.on("error", (err) => this.opts.onError?.(err));
    return w;
  }

  private schedule(key: string, fn: () => void): void {
    if (this.closed) return;
    const old = this.timers.get(key);
    if (old) clearTimeout(old);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        fn();
      }, this.opts.debounceMs ?? DEBOUNCE_MS),
    );
  }

  private emitIfOpen(event: PikabanEvent): void {
    if (!this.closed) this.emit(event);
  }
}

/**
 * The name of the task file on disk now, or undefined if it is gone. With a ULID, any file with that
 * ULID counts (a rename). An atomic write gives "unlink" and "add" events: examine the disk, not the event.
 */
function currentFile(tasksDir: string, name: string, id: string | undefined): string | undefined {
  let names: string[];
  try {
    names = readdirSync(tasksDir);
  } catch {
    return undefined;
  }
  if (names.includes(name)) return name;
  if (id === undefined) return undefined;
  return names.find((n) => idFromFileName(n) === id);
}

function ready(w: FSWatcher): Promise<void> {
  return new Promise((r) => w.once("ready", () => r()));
}
