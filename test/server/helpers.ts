import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { addProject, initProject, prepareInit } from "../../src/core/index.js";
import { pidOf, startServer, type RunningServer, type ServerOptions, type TrackerEvent } from "../../src/server/index.js";
import { removeDir, tempDir } from "../helpers.js";

export interface Env {
  base: string;
  /** TRACKER_HOME */
  home: string;
  /** Makes `<base>/<name>` with `.tracker/` and adds it to the global config of `home`. */
  project(name: string): { root: string; pid: string };
  cleanup(): void;
}

export function makeEnv(): Env {
  // realpath: on macOS, tmpdir() is a symlink.
  const base = realpathSync(tempDir("server"));
  const home = join(base, "home");
  mkdirSync(home);
  return {
    base,
    home,
    project(name) {
      const root = join(base, name);
      mkdirSync(root);
      initProject(root, prepareInit(root, { name }));
      addProject(root, home);
      return { root, pid: pidOf(root) };
    },
    cleanup: () => removeDir(base),
  };
}

export function start(env: Env, opts: Partial<ServerOptions> = {}): Promise<RunningServer> {
  return startServer({ homeDir: env.home, port: 0, uiDir: join(env.base, "no-ui"), ...opts });
}

export interface Response {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: any;
}

export interface RequestOptions {
  headers?: Record<string, string | undefined>;
  /** An object is sent as JSON. A string is sent as is. */
  body?: unknown;
}

/**
 * A raw HTTP request (node:http, not fetch), so that tests control `Host`, `Origin` and the raw path.
 * Defaults: `Host: 127.0.0.1:<port>`; for writes, `Origin: http://127.0.0.1:<port>`; for a body,
 * `Content-Type: application/json`. A header with the value `undefined` is not sent.
 */
export function request(port: number, method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  const headers: Record<string, string | undefined> = { Host: `127.0.0.1:${port}` };
  if (["POST", "PATCH", "DELETE"].includes(method)) headers.Origin = `http://127.0.0.1:${port}`;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }
  Object.assign(headers, opts.headers);
  const sent = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<string, string>;
  return new Promise((resolve, reject) => {
    // agent: false: a new connection for each request. A 413 can arrive before the body is sent;
    // a late EPIPE on that socket must not be an uncaught error.
    const req = httpRequest({ host: "127.0.0.1", port, method, path, headers: sent, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    req.on("socket", (socket) => socket.on("error", () => {}));
    req.end(body);
  });
}

export interface SseClient {
  /** The events received so far. */
  events: TrackerEvent[];
  /** Waits for an event that matches. Rejects after `timeoutMs`. */
  waitFor(match: (e: TrackerEvent) => boolean, timeoutMs?: number): Promise<TrackerEvent>;
  close(): void;
}

/** Connects to `/api/events`. Resolves when the response headers arrive (the server knows the client then). */
export function sse(port: number): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/api/events", headers: { Host: `127.0.0.1:${port}`, Accept: "text/event-stream" } },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE status ${res.statusCode}`));
          return;
        }
        const events: TrackerEvent[] = [];
        const waiters = new Set<() => void>();
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let i: number;
          while ((i = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, i);
            buffer = buffer.slice(i + 2);
            const data = block
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            if (data !== "") events.push(JSON.parse(data));
          }
          for (const w of [...waiters]) w();
        });
        res.on("error", () => {});
        resolve({
          events,
          waitFor(match, timeoutMs = 1000) {
            return new Promise((ok, fail) => {
              let seen = 0;
              const check = () => {
                for (; seen < events.length; seen++) {
                  if (match(events[seen]!)) {
                    done();
                    ok(events[seen]!);
                    return;
                  }
                }
              };
              const timer = setTimeout(() => {
                done();
                fail(new Error(`no matching SSE event in ${timeoutMs} ms. Received: ${JSON.stringify(events)}`));
              }, timeoutMs);
              const done = () => {
                clearTimeout(timer);
                waiters.delete(check);
              };
              waiters.add(check);
              check();
            });
          },
          close: () => req.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** A port that is free now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export function writeUi(dir: string, files: Record<string, string>): void {
  for (const [name, text] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
}

/**
 * Waits until the watcher of the project at `root` sends events, then clears `client.events`.
 * On macOS, fs.watch (FSEvents) starts asynchronously: a change in the first milliseconds after
 * the watcher is ready can be lost, and a change just before the start can be reported late.
 */
export async function warmUp(client: SseClient, root: string): Promise<void> {
  const file = join(root, ".tracker", "tasks", "zz-warm-up.md");
  const deadline = Date.now() + 5000;
  for (;;) {
    writeFileSync(file, String(Date.now()));
    try {
      await client.waitFor((e) => e.file === "zz-warm-up.md" && e.type === "changed", 300);
      break;
    } catch (err) {
      if (Date.now() > deadline) throw err;
    }
  }
  rmSync(file);
  await client.waitFor((e) => e.file === "zz-warm-up.md" && e.type === "removed", 2000);
  client.events.length = 0;
}
