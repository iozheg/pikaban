import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addProject, create, openProject, update } from "../../src/core/index.js";
import type { RunningServer } from "../../src/server/index.js";
import { pidOf } from "../../src/server/projects.js";
import { PLACEHOLDER_HTML } from "../../src/server/static.js";
import { makeEnv, request, start, writeUi, type Env } from "./helpers.js";
import { writeConfig } from "../helpers.js";

let env: Env;
let server: RunningServer | undefined;

beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  env.cleanup();
});

describe("pid", () => {
  it("is the first 12 hex characters of the SHA-256 of the absolute path", () => {
    expect(pidOf("/a/b")).toMatch(/^[0-9a-f]{12}$/);
    expect(pidOf("/a/b/../b")).toBe(pidOf("/a/b"));
    expect(pidOf("/a/c")).not.toBe(pidOf("/a/b"));
  });
});

describe("projects", () => {
  it("GET /api/projects gives each project with its status and config", async () => {
    const a = env.project("alpha");
    const old = env.project("old");
    writeConfig(old.root, { ...openProject(old.root).config, schema_version: 0 });
    const newer = env.project("newer");
    writeConfig(newer.root, { ...openProject(newer.root).config, schema_version: 2 });
    const broken = env.project("broken");
    writeFileSync(join(broken.root, ".pikaban", "config.json"), "{");
    const missing = join(env.base, "gone");
    addProject(missing, env.home);

    server = await start(env);
    const r = await request(server.port, "GET", "/api/projects");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    const byName = Object.fromEntries(r.json.map((p: any) => [p.name, p]));
    expect(byName.alpha).toEqual({
      pid: a.pid,
      root: a.root,
      name: "alpha",
      project_id: "alpha",
      schema_version: 1,
      status: "ok",
      config: openProject(a.root).config,
    });
    expect(byName.alpha.config.categories).toEqual(["backlog", "todo", "in_progress", "done"]);
    expect(byName.old.status).toBe("schema_mismatch");
    expect(byName.old.message).toContain("pikaban migrate");
    expect(byName.newer.status).toBe("schema_mismatch");
    expect(byName.newer.project_id).toBeNull();
    expect(byName.broken.status).toBe("invalid");
    expect(byName.gone).toMatchObject({ pid: pidOf(missing), status: "missing", project_id: null });
    for (const name of ["old", "newer", "broken", "gone"]) expect(byName[name].config, name).toBeNull();
  });

  it("GET /api/projects/<pid> gives 404: the list has the config", async () => {
    const a = env.project("alpha");
    server = await start(env);
    const r = await request(server.port, "GET", `/api/projects/${a.pid}`);
    expect(r.status).toBe(404);
    expect(r.json.error.code).toBe(3);
  });

  it("an unknown pid gives 404 for all project paths", async () => {
    env.project("alpha");
    server = await start(env);
    for (const [method, path] of [
      ["GET", "/api/projects/0123456789ab"],
      ["GET", "/api/projects/0123456789ab/tasks"],
      ["GET", "/api/projects/not-a-pid/tasks"],
      ["POST", "/api/projects/0123456789ab/tasks"],
    ] as const) {
      const r = await request(server.port, method, path, method === "POST" ? { body: { title: "x" } } : {});
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(r.json.error.code).toBe(3);
    }
  });

  it("a project that is not in the global config is not available, even if it exists", async () => {
    const a = env.project("alpha");
    server = await start(env);
    const { removeProject } = await import("../../src/core/index.js");
    removeProject(a.root, env.home);
    expect((await request(server.port, "GET", `/api/projects/${a.pid}/tasks`)).status).toBe(404);
  });
});

describe("tasks: full CRUD", () => {
  it("POST, GET, PATCH, DELETE", async () => {
    const a = env.project("alpha");
    server = await start(env);
    const base = `/api/projects/${a.pid}/tasks`;

    // create
    const c = await request(server.port, "POST", base, { body: { title: "First", body: "## Description\nText." } });
    expect(c.status).toBe(201);
    expect(c.json).toMatchObject({ short: "task-0001", title: "First", category: "backlog", assignee: null, needs_input: false });
    expect(c.json.body).toBe("## Description\nText.\n");
    expect(c.json.file).toBe(`task-0001-${c.json.id}.md`);
    expect(c.headers.etag).toBe(`"${c.json.etag}"`);
    expect(c.headers.location).toBe(`${base}/${c.json.id}`);
    const c2 = await request(server.port, "POST", base, { body: { title: "Second", category: "todo" } });
    expect(c2.json.category).toBe("todo");

    // list
    const l = await request(server.port, "GET", base);
    expect(l.status).toBe(200);
    expect(l.json.invalid).toEqual([]);
    expect(l.json.tasks.map((t: any) => t.title)).toEqual(["First", "Second"]);
    expect(l.json.tasks[0].etag).toBe(c.json.etag);
    // No absolute paths.
    expect(l.text).not.toContain(a.root);

    // get one
    const g = await request(server.port, "GET", `${base}/${c.json.id}`);
    expect(g.status).toBe(200);
    expect(g.json.title).toBe("First");
    expect(g.headers.etag).toBe(`"${c.json.etag}"`);
    // A lowercase ULID is accepted.
    expect((await request(server.port, "GET", `${base}/${c.json.id.toLowerCase()}`)).status).toBe(200);

    // update (If-Match with quotes)
    const u = await request(server.port, "PATCH", `${base}/${c.json.id}`, {
      body: { category: "in_progress", assignee: "user", needs_input: true, title: "First!", body: "New body" },
      headers: { "If-Match": c.headers.etag as string },
    });
    expect(u.status).toBe(200);
    expect(u.json).toMatchObject({ title: "First!", category: "in_progress", assignee: "user", needs_input: true, body: "New body\n" });
    expect(u.headers.etag).toBe(`"${u.json.etag}"`);
    expect(u.json.etag).not.toBe(c.json.etag);
    const text = readFileSync(join(a.root, ".pikaban", "tasks", u.json.file), "utf8");
    expect(text).toContain("title: First!");

    // update (If-Match without quotes)
    const u2 = await request(server.port, "PATCH", `${base}/${c.json.id}`, {
      body: { assignee: null },
      headers: { "If-Match": u.json.etag },
    });
    expect(u2.status).toBe(200);
    expect(u2.json.assignee).toBeNull();

    // delete
    const d = await request(server.port, "DELETE", `${base}/${c.json.id}`, { headers: { "If-Match": u2.headers.etag as string } });
    expect(d.status).toBe(204);
    expect(d.text).toBe("");
    expect(readdirSync(join(a.root, ".pikaban", "tasks"))).toEqual([c2.json.file]);
    expect((await request(server.port, "GET", `${base}/${c.json.id}`)).status).toBe(404);
  });

  it("PATCH with a stale If-Match gives 412 with the current task", async () => {
    const a = env.project("alpha");
    const t = create(openProject(a.root), { title: "T" });
    const changed = update(openProject(a.root), t.id, { title: "Changed by the agent" });
    server = await start(env);
    const r = await request(server.port, "PATCH", `/api/projects/${a.pid}/tasks/${t.id}`, {
      body: { title: "UI title" },
      headers: { "If-Match": `"${t.etag}"` },
    });
    expect(r.status).toBe(412);
    expect(r.json.error.code).toBe(5);
    expect(r.json.current.title).toBe("Changed by the agent");
    expect(r.json.current.etag).toBe(changed.etag);
    expect(readFileSync(changed.file, "utf8")).toContain("Changed by the agent");
  });

  it("DELETE with a stale If-Match gives 412 and keeps the file", async () => {
    const a = env.project("alpha");
    const t = create(openProject(a.root), { title: "T" });
    update(openProject(a.root), t.id, { title: "Changed" });
    server = await start(env);
    const r = await request(server.port, "DELETE", `/api/projects/${a.pid}/tasks/${t.id}`, {
      headers: { "If-Match": `"${t.etag}"` },
    });
    expect(r.status).toBe(412);
    expect(readdirSync(join(a.root, ".pikaban", "tasks"))).toHaveLength(1);
  });

  it("PATCH and DELETE without If-Match give 428", async () => {
    const a = env.project("alpha");
    const t = create(openProject(a.root), { title: "T" });
    server = await start(env);
    const path = `/api/projects/${a.pid}/tasks/${t.id}`;
    const p = await request(server.port, "PATCH", path, { body: { title: "x" } });
    expect(p.status).toBe(428);
    expect((await request(server.port, "PATCH", path, { body: { title: "x" }, headers: { "If-Match": "*" } })).status).toBe(428);
    expect((await request(server.port, "DELETE", path)).status).toBe(428);
    expect(readFileSync(t.file, "utf8")).toContain("title: T");
  });

  it("validation errors give 422, a short name in the path gives 400, unknown task 404", async () => {
    const a = env.project("alpha");
    const t = create(openProject(a.root), { title: "T" });
    server = await start(env);
    const base = `/api/projects/${a.pid}/tasks`;
    const ifMatch = { "If-Match": `"${t.etag}"` };
    const cases: [string, string, unknown, number][] = [
      ["POST", base, { title: "" }, 422],
      ["POST", base, { title: "x", category: "nope" }, 422],
      ["POST", base, { title: "x", extra: 1 }, 422],
      ["POST", base, { body: "no title" }, 422],
      ["POST", base, [1, 2], 422],
      ["PATCH", `${base}/${t.id}`, { category: "nope" }, 422],
      ["PATCH", `${base}/${t.id}`, { id: "01JA2B3C4D5E6F7G8H9J0KMNPQ" }, 422],
      ["PATCH", `${base}/${t.id}`, { updated_at: "2026-01-01T00:00:00.000Z" }, 422],
      ["PATCH", `${base}/${t.id}`, { assignee: "robot" }, 422],
      ["PATCH", `${base}/${t.id}`, {}, 422],
      ["PATCH", `${base}/task-0001`, { title: "x" }, 400],
      ["PATCH", `${base}/01JA2B3C4D5E6F7G8H9J0KMNPQ`, { title: "x" }, 404],
    ];
    for (const [method, path, body, status] of cases) {
      const r = await request(server.port, method, path, { body, headers: method === "PATCH" ? ifMatch : {} });
      expect(r.status, `${method} ${path} ${JSON.stringify(body)}: ${r.text}`).toBe(status);
      expect(r.json.error.message).toBeTypeOf("string");
    }
    expect(readdirSync(join(a.root, ".pikaban", "tasks"))).toHaveLength(1);
  });

  it("invalid task files are in `invalid`, with the file name only", async () => {
    const a = env.project("alpha");
    create(openProject(a.root), { title: "Good" });
    writeFileSync(join(a.root, ".pikaban", "tasks", "task-0002-broken.md"), "no frontmatter");
    server = await start(env);
    const r = await request(server.port, "GET", `/api/projects/${a.pid}/tasks`);
    expect(r.json.tasks).toHaveLength(1);
    expect(r.json.invalid).toEqual([{ file: "task-0002-broken.md", error: expect.stringContaining("---") }]);
  });

  it("unknown API paths give 404, a wrong method gives 405", async () => {
    const a = env.project("alpha");
    server = await start(env);
    expect((await request(server.port, "GET", "/api/nothing")).status).toBe(404);
    expect((await request(server.port, "GET", `/api/projects/${a.pid}/other`)).status).toBe(404);
    const r = await request(server.port, "DELETE", "/api/projects", { headers: {} });
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET");
    const put = await request(server.port, "PUT", `/api/projects/${a.pid}/tasks`, {
      body: {},
      headers: { Origin: `http://127.0.0.1:${server.port}` },
    });
    expect(put.status).toBe(405);
  });
});

describe("schema version", () => {
  it("a project with an older schema version: reads work, writes give 409 (code 6)", async () => {
    const a = env.project("alpha");
    const t = create(openProject(a.root), { title: "T" });
    writeConfig(a.root, { ...openProject(a.root).config, schema_version: 0 });
    server = await start(env);
    const base = `/api/projects/${a.pid}/tasks`;
    expect((await request(server.port, "GET", base)).status).toBe(200);

    const post = await request(server.port, "POST", base, { body: { title: "x" } });
    expect(post.status).toBe(409);
    expect(post.json.error.code).toBe(6);
    const patch = await request(server.port, "PATCH", `${base}/${t.id}`, {
      body: { title: "x" },
      headers: { "If-Match": t.etag },
    });
    expect(patch.status).toBe(409);
    const del = await request(server.port, "DELETE", `${base}/${t.id}`, { headers: { "If-Match": t.etag } });
    expect(del.status).toBe(409);
    expect(readFileSync(t.file, "utf8")).toContain("title: T");
  });

  it("a newer schema version gives 409 for reads too", async () => {
    const a = env.project("alpha");
    writeConfig(a.root, { ...openProject(a.root).config, schema_version: 2 });
    server = await start(env);
    const r = await request(server.port, "GET", `/api/projects/${a.pid}/tasks`);
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe(6);
  });

  it("a missing project gives 404 for its tasks", async () => {
    addProject(join(env.base, "gone"), env.home);
    server = await start(env);
    const r = await request(server.port, "GET", `/api/projects/${pidOf(join(env.base, "gone"))}/tasks`);
    expect(r.status).toBe(404);
  });
});

describe("static files", () => {
  it("without a built UI, / gives a placeholder page", async () => {
    server = await start(env);
    const r = await request(server.port, "GET", "/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.text).toBe(PLACEHOLDER_HTML);
    expect((await request(server.port, "GET", "/app.js")).status).toBe(404);
  });

  it("serves files from uiDir with content types", async () => {
    const ui = join(env.base, "ui");
    writeUi(ui, { "index.html": "<p>board</p>", "assets/app-1234.js": "console.log(1)", "assets/app.css": "p{}" });
    server = await start(env, { uiDir: ui });
    const index = await request(server.port, "GET", "/");
    expect(index.text).toBe("<p>board</p>");
    expect(index.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(index.headers["x-frame-options"]).toBe("DENY");
    expect(index.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    const js = await request(server.port, "GET", "/assets/app-1234.js?v=1");
    expect(js.text).toBe("console.log(1)");
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect((await request(server.port, "GET", "/assets/app.css")).headers["content-type"]).toBe("text/css; charset=utf-8");
    const head = await request(server.port, "HEAD", "/index.html");
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
    expect((await request(server.port, "GET", "/assets")).status).toBe(404);
    expect((await request(server.port, "GET", "/missing.js")).status).toBe(404);
    expect((await request(server.port, "POST", "/index.html", { body: {} })).status).toBe(405);
  });

  it("does not serve files outside uiDir (path traversal)", async () => {
    const ui = join(env.base, "ui");
    writeUi(ui, { "index.html": "<p>board</p>" });
    writeFileSync(join(env.base, "secret.txt"), "SECRET");
    mkdirSync(join(env.base, "ui2"));
    writeFileSync(join(env.base, "ui2", "x.txt"), "SECRET");
    symlinkSync(join(env.base, "secret.txt"), join(ui, "link.txt"));
    server = await start(env, { uiDir: ui });
    for (const path of [
      "/../secret.txt",
      "/assets/../../secret.txt",
      "/%2e%2e/secret.txt",
      "/%2E%2E/secret.txt",
      "/..%2fsecret.txt",
      "/..%5csecret.txt",
      "/%2e%2e%2f%2e%2e%2fsecret.txt",
      "/../ui2/x.txt",
      "/link.txt",
      "/index.html%00.txt",
      "/%E0%A4%A",
      "//etc/passwd",
      "/..",
    ]) {
      const r = await request(server.port, "GET", path);
      expect([400, 404], `${path}: ${r.status}`).toContain(r.status);
      expect(r.text, path).not.toContain("SECRET");
      expect(r.text, path).not.toContain("root:");
    }
  });
});
