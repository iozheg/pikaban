import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addProject,
  appendNote,
  check,
  create,
  initProject,
  openProject,
  prepareInit,
  remove,
  removeProject,
  update,
} from "../../src/core/index.js";
import type { RunningServer } from "../../src/server/index.js";
import { idFromFileName, PikabanWatcher } from "../../src/server/watcher.js";
import { CLI } from "../cli/run.js";
import { taskText } from "../helpers.js";
import { makeEnv, request, sse, start, warmUp, type Env, type SseClient } from "./helpers.js";

let env: Env;
let server: RunningServer;
let client: SseClient | undefined;
let alpha: { root: string; pid: string };

beforeEach(async () => {
  env = makeEnv();
  alpha = env.project("alpha");
});
afterEach(async () => {
  client?.close();
  client = undefined;
  await server?.close();
  env.cleanup();
});

async function connect(opts: Parameters<typeof start>[1] = {}): Promise<SseClient> {
  server = await start(env, opts);
  client = await sse(server.port);
  await warmUp(client, alpha.root);
  return client;
}

describe("idFromFileName", () => {
  it("gives the ULID of task-XXXX-<ULID>.md", () => {
    expect(idFromFileName("task-0042-01JA2B3C4D5E6F7G8H9J0KMNPQ.md")).toBe("01JA2B3C4D5E6F7G8H9J0KMNPQ");
    expect(idFromFileName("task-0042.md")).toBeUndefined();
    expect(idFromFileName("task-0042-01JA2B3C4D5E6F7G8H9J0KMNPQ.md.abc.tmp")).toBeUndefined();
  });
});

describe("GET /api/events", () => {
  it("is an event stream", async () => {
    server = await start(env);
    const r = await new Promise<{ status: number; type: string; first: string }>((resolve) => {
      import("node:http").then(({ get }) => {
        const req = get(
          { host: "127.0.0.1", port: server.port, path: "/api/events", headers: { Host: `127.0.0.1:${server.port}` } },
          (res) => {
            res.setEncoding("utf8");
            res.once("data", (first: string) => {
              resolve({ status: res.statusCode!, type: String(res.headers["content-type"]), first });
              req.destroy();
            });
          },
        );
      });
    });
    expect(r.status).toBe(200);
    expect(r.type).toContain("text/event-stream");
    expect(r.first).toContain("retry: 1000");
  });

  it("a change by the core module gives a `changed` event in less than 1 s", async () => {
    const t = create(openProject(alpha.root), { title: "T" });
    const c = await connect();
    const started = Date.now();
    update(openProject(alpha.root), t.id, { title: "Changed" });
    const ev = await c.waitFor((e) => e.type === "changed" && e.id === t.id, 1000);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(ev).toEqual({ pid: alpha.pid, type: "changed", id: t.id, file: `task-0001-${t.id}.md` });
  });

  it("a new task and a note by the CLI give `changed` events", async () => {
    const c = await connect();
    const r = spawnSync(process.execPath, [CLI, "add", "From the CLI", "--json"], {
      cwd: alpha.root,
      encoding: "utf8",
      env: { ...process.env, PIKABAN_HOME: env.home },
    });
    expect(r.status, r.stderr).toBe(0);
    const id = JSON.parse(r.stdout).id as string;
    await c.waitFor((e) => e.type === "changed" && e.id === id);
    const n = c.events.length;
    appendNote(openProject(alpha.root, { write: true }), id, "A note");
    await c.waitFor((e) => e.type === "changed" && e.id === id && c.events.indexOf(e) >= n);
  });

  it("an atomic write (unlink + add) gives `changed`, not `removed`", async () => {
    const t = create(openProject(alpha.root), { title: "T" });
    const c = await connect();
    for (let i = 0; i < 3; i++) update(openProject(alpha.root), t.id, { title: `Change ${i}` });
    await c.waitFor((e) => e.type === "changed" && e.id === t.id);
    // The events for one file in 100 ms give one event. Wait a short time for more events.
    await new Promise((r) => setTimeout(r, 250));
    const forTask = c.events.filter((e) => e.id === t.id);
    expect(forTask.every((e) => e.type === "changed")).toBe(true);
    expect(forTask.length).toBeLessThanOrEqual(2);
  });

  it("a delete gives a `removed` event", async () => {
    const t = create(openProject(alpha.root), { title: "T" });
    const c = await connect();
    remove(openProject(alpha.root), t.id);
    const ev = await c.waitFor((e) => e.type === "removed");
    expect(ev).toEqual({ pid: alpha.pid, type: "removed", id: t.id, file: `task-0001-${t.id}.md` });
  });

  it("a rename by `check --fix` (same ULID) gives `changed`, not `removed`", async () => {
    const p = openProject(alpha.root, { write: true });
    const a = create(p, { title: "A" });
    // A second task with the same short name (as after a git merge).
    const id = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ";
    writeFileSync(join(p.tasksDir, `task-0001-${id}.md`), taskText({ id, short: "task-0001" }));
    const c = await connect();
    const report = check(p, { fix: true });
    expect(report.ok).toBe(true);
    const ev = await c.waitFor((e) => e.id === id);
    expect(ev.type).toBe("changed");
    expect(ev.file).toBe(`task-0002-${id}.md`);
    await new Promise((r) => setTimeout(r, 200));
    expect(c.events.filter((e) => e.type === "removed")).toEqual([]);
    expect(c.events.filter((e) => e.id === a.id)).toEqual([]);
  });

  it("temporary files and other files do not give events", async () => {
    const c = await connect();
    const dir = join(alpha.root, ".pikaban", "tasks");
    writeFileSync(join(dir, "task-0001-01JA2B3C4D5E6F7G8H9J0KMNPQ.md.abc123.tmp"), "x");
    writeFileSync(join(alpha.root, ".pikaban", "other.txt"), "x");
    writeFileSync(join(alpha.root, "outside.md"), "x");
    // A marker event: the events before it are already received.
    const t = create(openProject(alpha.root), { title: "marker" });
    await c.waitFor((e) => e.id === t.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(c.events).toEqual([{ pid: alpha.pid, type: "changed", id: t.id, file: `task-0001-${t.id}.md` }]);
  });

  it("a task file with another name gives an event without `id`", async () => {
    const c = await connect();
    const file = join(alpha.root, ".pikaban", "tasks", "notes.md");
    writeFileSync(file, "x");
    expect(await c.waitFor((e) => e.file === "notes.md")).toEqual({ pid: alpha.pid, type: "changed", file: "notes.md" });
    rmSync(file);
    expect(await c.waitFor((e) => e.type === "removed")).toEqual({ pid: alpha.pid, type: "removed", file: "notes.md" });
  });

  it("a change of .pikaban/config.json gives a `config` event", async () => {
    const c = await connect();
    const p = openProject(alpha.root);
    const file = p.configFile;
    writeFileSync(`${file}.tmp`, `${JSON.stringify({ ...p.config, project_name: "Renamed" }, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
    expect(await c.waitFor((e) => e.type === "config")).toEqual({ pid: alpha.pid, type: "config" });
  });

  it("a change of the global config gives a `projects` event and adds or removes project watchers", async () => {
    const c = await connect();
    // Add a project.
    const betaRoot = join(env.base, "beta");
    mkdirSync(betaRoot);
    initProject(betaRoot, prepareInit(betaRoot));
    addProject(betaRoot, env.home);
    await c.waitFor((e) => e.type === "projects");
    expect(c.events.find((e) => e.type === "projects")).toEqual({ type: "projects" });
    const listed = await request(server.port, "GET", "/api/projects");
    expect(listed.json.map((p: any) => p.name)).toEqual(["alpha", "beta"]);

    // The new project is watched.
    await warmUp(c, betaRoot);
    const t = create(openProject(betaRoot), { title: "In beta" });
    const ev = await c.waitFor((e) => e.id === t.id);
    expect(ev.pid).not.toBe(alpha.pid);

    // Remove alpha: no more events for it.
    const n = c.events.length;
    removeProject(alpha.root, env.home);
    await c.waitFor((e) => e.type === "projects" && c.events.indexOf(e) >= n);
    create(openProject(alpha.root), { title: "Not watched" });
    const marker = create(openProject(betaRoot), { title: "marker" });
    await c.waitFor((e) => e.id === marker.id);
    await new Promise((r) => setTimeout(r, 150));
    expect(c.events.slice(n).some((e) => e.pid === alpha.pid)).toBe(false);
  });

  it("a global config that is not valid JSON still gives a `projects` event", async () => {
    const c = await connect();
    writeFileSync(join(env.home, ".pikaban_config.json"), "{");
    await c.waitFor((e) => e.type === "projects");
    const r = await request(server.port, "GET", "/api/projects");
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe(7);
    // The watchers stay. A correct file again gives the projects.
    writeFileSync(join(env.home, ".pikaban_config.json"), `${JSON.stringify({ projects: [alpha.root] })}\n`);
    await c.waitFor((e) => e.type === "projects" && c.events.filter((x) => x.type === "projects").length >= 2);
    expect((await request(server.port, "GET", "/api/projects")).status).toBe(200);
  });

  it("a failed project sync does not stop the next ones", async () => {
    const errors: unknown[] = [];
    const c = await connect({ onError: (err) => errors.push(err) });
    const sync = vi
      .spyOn(PikabanWatcher.prototype as unknown as { syncProjects(): Promise<void> }, "syncProjects")
      .mockRejectedValueOnce(new Error("sync failed"));
    try {
      const betaRoot = join(env.base, "beta");
      mkdirSync(betaRoot);
      initProject(betaRoot, prepareInit(betaRoot));
      addProject(betaRoot, env.home);
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(c.events.some((e) => e.type === "projects")).toBe(false);

      // The next change of the global config syncs again: beta gets a watcher.
      removeProject(alpha.root, env.home);
      await c.waitFor((e) => e.type === "projects");
      await warmUp(c, betaRoot);
      const t = create(openProject(betaRoot), { title: "In beta" });
      await c.waitFor((e) => e.id === t.id);
    } finally {
      sync.mockRestore();
    }
  });

  it("sends heartbeat comments", async () => {
    server = await start(env, { heartbeatMs: 50 });
    const text = await new Promise<string>((resolve) => {
      import("node:http").then(({ get }) => {
        let all = "";
        const req = get(
          { host: "127.0.0.1", port: server.port, path: "/api/events", headers: { Host: `127.0.0.1:${server.port}` } },
          (res) => {
            res.setEncoding("utf8");
            res.on("data", (d: string) => {
              all += d;
              if (all.includes(": ping")) {
                req.destroy();
                resolve(all);
              }
            });
          },
        );
      });
    });
    expect(text).toContain(": ping\n\n");
  });

  it("close() ends the SSE streams", async () => {
    server = await start(env);
    const ended = new Promise<void>((resolve) => {
      import("node:http").then(({ get }) => {
        get(
          { host: "127.0.0.1", port: server.port, path: "/api/events", headers: { Host: `127.0.0.1:${server.port}` } },
          (res) => {
            res.resume();
            res.on("end", () => resolve());
            res.on("close", () => resolve());
            void server.close();
          },
        );
      });
    });
    await ended;
  });
});
