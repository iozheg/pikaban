import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunningServer } from "../../src/server/index.js";
import { makeEnv, request, start, type Env } from "../server/helpers.js";

// test/globalSetup.ts builds the UI (vite build) to dist/ui/, the same as `npm run build`.
const uiDir = join(import.meta.dirname, "..", "..", "dist", "ui");
const indexFile = join(uiDir, "index.html");

/** The opening tag and the content of each <script> element. */
function scripts(html: string): { tag: string; content: string }[] {
  return [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)].map((m) => ({ tag: m[1]!, content: m[2]! }));
}

/** The local paths in src="..." and href="..." (no data: URLs). */
function localRefs(html: string): string[] {
  return [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]!).filter((u) => u.startsWith("/"));
}

describe("UI build (dist/ui)", () => {
  it("has index.html with only external module scripts (CSP: script-src 'self')", () => {
    expect(existsSync(indexFile)).toBe(true);
    const html = readFileSync(indexFile, "utf8");
    const all = scripts(html);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) {
      expect(s.tag).toMatch(/\ssrc="\/assets\/[^"]+\.js"/);
      expect(s.content.trim()).toBe("");
    }
    // No inline event handlers and no javascript: URLs.
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  it("references only files that exist", () => {
    const html = readFileSync(indexFile, "utf8");
    const refs = localRefs(html);
    expect(refs.some((r) => r.endsWith(".js"))).toBe(true);
    expect(refs.some((r) => r.endsWith(".css"))).toBe(true);
    for (const r of refs) expect(existsSync(join(uiDir, r)), r).toBe(true);
  });
});

describe("UI server serves the built UI", () => {
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

  it('serves index.html at "/" and the assets with 200', async () => {
    server = await start(env, { uiDir });
    const html = readFileSync(indexFile, "utf8");

    const page = await request(server.port, "GET", "/");
    expect(page.status).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect(page.text).toBe(html);

    for (const ref of localRefs(html)) {
      const r = await request(server.port, "GET", ref);
      expect(r.status, ref).toBe(200);
      expect(r.text).toBe(readFileSync(join(uiDir, ref), "utf8"));
      expect(r.headers["cache-control"]).toContain("immutable");
      if (ref.endsWith(".js")) expect(r.headers["content-type"]).toContain("text/javascript");
      if (ref.endsWith(".css")) expect(r.headers["content-type"]).toContain("text/css");
    }
  });
});
