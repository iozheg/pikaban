import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunningServer } from "../../src/server/index.js";
import { MAX_BODY_BYTES } from "../../src/server/security.js";
import { makeEnv, request, start, type Env } from "./helpers.js";

let env: Env;
let server: RunningServer;
let pid: string;

beforeEach(async () => {
  env = makeEnv();
  pid = env.project("alpha").pid;
});
afterEach(async () => {
  await server?.close();
  env.cleanup();
});

const tasksPath = () => `/api/projects/${pid}/tasks`;

describe("Host header (design 7.4)", () => {
  beforeEach(async () => {
    server = await start(env);
  });

  it("accepts 127.0.0.1:<port> and localhost:<port>", async () => {
    expect((await request(server.port, "GET", "/api/projects")).status).toBe(200);
    const r = await request(server.port, "GET", "/api/projects", { headers: { Host: `localhost:${server.port}` } });
    expect(r.status).toBe(200);
  });

  it("gives 403 for another host (DNS rebinding), a wrong port or no port", async () => {
    for (const host of ["evil.example.com", `evil.example.com:${server.port}`, "127.0.0.1", `127.0.0.1:${server.port + 1}`]) {
      const r = await request(server.port, "GET", "/api/projects", { headers: { Host: host } });
      expect(r.status, host).toBe(403);
      expect(r.json.error.code).toBe(2);
    }
  });

  it("applies to static files and SSE too", async () => {
    const headers = { Host: "evil.example.com" };
    expect((await request(server.port, "GET", "/", { headers })).status).toBe(403);
    expect((await request(server.port, "GET", "/api/events", { headers })).status).toBe(403);
  });

  it("does not accept the Vite dev host when dev mode is off", async () => {
    const r = await request(server.port, "GET", "/api/projects", { headers: { Host: "localhost:5173" } });
    expect(r.status).toBe(403);
  });
});

describe("Origin header for writes", () => {
  beforeEach(async () => {
    server = await start(env);
  });

  it("POST with a wrong Origin gives 403, and makes no task", async () => {
    const r = await request(server.port, "POST", tasksPath(), {
      body: { title: "x" },
      headers: { Origin: "http://evil.example.com" },
    });
    expect(r.status).toBe(403);
    expect(r.json.error.message).toContain("origin");
    expect((await request(server.port, "GET", tasksPath())).json.tasks).toEqual([]);
  });

  it("POST without Origin gives 403", async () => {
    const r = await request(server.port, "POST", tasksPath(), { body: { title: "x" }, headers: { Origin: undefined } });
    expect(r.status).toBe(403);
  });

  it("PATCH and DELETE without the correct Origin give 403", async () => {
    const id = "01JA2B3C4D5E6F7G8H9J0KMNPQ";
    const path = `${tasksPath()}/${id}`;
    const headers = { Origin: "null", "If-Match": '"x"' };
    expect((await request(server.port, "PATCH", path, { body: { title: "y" }, headers })).status).toBe(403);
    expect((await request(server.port, "DELETE", path, { headers })).status).toBe(403);
    expect((await request(server.port, "DELETE", path, { headers: { Origin: undefined, "If-Match": '"x"' } })).status).toBe(403);
  });

  it("accepts the localhost form of the server origin", async () => {
    const r = await request(server.port, "POST", tasksPath(), {
      body: { title: "x" },
      headers: { Origin: `http://localhost:${server.port}` },
    });
    expect(r.status).toBe(201);
  });

  it("does not accept the Vite dev origin when dev mode is off", async () => {
    const r = await request(server.port, "POST", tasksPath(), {
      body: { title: "x" },
      headers: { Origin: "http://localhost:5173" },
    });
    expect(r.status).toBe(403);
  });
});

describe("dev mode", () => {
  it("accepts the Vite dev origin and host", async () => {
    server = await start(env, { dev: true });
    const r = await request(server.port, "POST", tasksPath(), {
      body: { title: "x" },
      headers: { Origin: "http://localhost:5173", Host: "localhost:5173" },
    });
    expect(r.status).toBe(201);
    const other = await request(server.port, "POST", tasksPath(), {
      body: { title: "x" },
      headers: { Origin: "http://localhost:5174" },
    });
    expect(other.status).toBe(403);
  });
});

describe("request body", () => {
  beforeEach(async () => {
    server = await start(env);
  });

  it("a content type that is not JSON gives 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const r = await request(server.port, "POST", tasksPath(), {
        body: JSON.stringify({ title: "x" }),
        headers: { "Content-Type": type },
      });
      expect(r.status, type).toBe(415);
    }
    const none = await request(server.port, "POST", tasksPath(), {
      body: JSON.stringify({ title: "x" }),
      headers: { "Content-Type": undefined },
    });
    expect(none.status).toBe(415);
    expect((await request(server.port, "GET", tasksPath())).json.tasks).toEqual([]);
  });

  it("accepts application/json with a charset", async () => {
    const r = await request(server.port, "POST", tasksPath(), {
      body: { title: "x" },
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    expect(r.status).toBe(201);
  });

  it("a body larger than 1 MB gives 413", async () => {
    const r = await request(server.port, "POST", tasksPath(), {
      body: { title: "x", body: "a".repeat(MAX_BODY_BYTES) },
    });
    expect(r.status).toBe(413);
  });

  it("invalid JSON gives 400", async () => {
    const r = await request(server.port, "POST", tasksPath(), { body: "{not json" });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe(2);
  });
});
