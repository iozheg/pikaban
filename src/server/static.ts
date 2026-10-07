import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "./http.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Headers for the UI pages and files. */
const STATIC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; " +
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

/**
 * Locations of the built UI (`dist/ui/`), relative to this module at run time:
 * - built: this code is bundled into `dist/*.js`, so the UI is in `./ui/`;
 * - source (tests, tsx): this module is `src/server/static.ts`, so the UI is in `../../dist/ui/`.
 */
export function defaultUiDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "ui"), join(here, "..", "..", "dist", "ui")];
  return candidates.find((d) => existsSync(join(d, "index.html"))) ?? candidates[0]!;
}

export const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pikaban</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem}code{background:#eee;padding:0 .25rem}</style>
</head>
<body>
<h1>Pikaban UI server</h1>
<p>The server operates, but the browser UI is not built. Run <code>npm run build</code> in the pikaban package.</p>
<p>The API is available at <a href="/api/projects"><code>/api/projects</code></a>.</p>
</body>
</html>
`;

/**
 * The file in `uiDir` for a URL path, or undefined. Never leaves `uiDir`: `..` segments, encoded
 * separators and NUL give 400, and the real path (after symlinks) must stay inside `uiDir`.
 */
export function resolveStaticPath(uiDir: string, rawPath: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new HttpError(400, "invalid path");
  }
  if (decoded.includes("\0") || decoded.includes("\\")) throw new HttpError(400, "invalid path");
  const segments = decoded.split("/");
  if (segments.some((s) => s === "..")) throw new HttpError(400, "invalid path");

  const root = resolve(uiDir);
  const rel = segments.filter((s) => s !== "" && s !== ".").join(sep);
  const file = resolve(root, rel === "" ? "index.html" : rel);
  if (file !== root && !file.startsWith(root + sep)) return undefined;
  if (!existsSync(file)) return undefined;
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(file);
    realRoot = realpathSync(root);
  } catch {
    return undefined;
  }
  if (!real.startsWith(realRoot + sep)) return undefined;
  return statSync(real).isFile() ? real : undefined;
}

/** Serves a GET or HEAD request for a file of the built UI. "/" without a built UI gives a placeholder page. */
export function serveStatic(req: IncomingMessage, res: ServerResponse, rawPath: string, uiDir: string): void {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    throw new HttpError(405, "method not allowed. Use: GET, HEAD", undefined, { Allow: "GET, HEAD" });
  }
  const file = resolveStaticPath(uiDir, rawPath);
  let body: Buffer;
  let type: string;
  if (file !== undefined) {
    body = readFileSync(file);
    type = CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  } else if (rawPath === "/" || rawPath === "/index.html") {
    body = Buffer.from(PLACEHOLDER_HTML);
    type = CONTENT_TYPES[".html"]!;
  } else {
    throw new HttpError(404, `not found: ${rawPath}`);
  }
  res.writeHead(200, {
    ...STATIC_HEADERS,
    "Content-Type": type,
    "Content-Length": String(body.length),
    // Vite puts a content hash in asset names. index.html must always be loaded again.
    "Cache-Control": rawPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(method === "HEAD" ? undefined : body);
}
