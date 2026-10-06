import type { IncomingMessage } from "node:http";
import { HttpError } from "./http.js";

/** The origins of the Vite dev server (plan step 11). Accepted only in dev mode. */
export const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] as const;

/** The largest request body. A larger body gives 413. */
export const MAX_BODY_BYTES = 1024 * 1024;

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export interface SecurityOptions {
  /** The port that the server listens on. */
  port: number;
  /** Also accept the Vite dev server origin (and Host). Default: false. */
  dev?: boolean;
}

/** Values of the `Host` header that the server accepts (design 7.4: prevents DNS rebinding). */
export function allowedHosts(opts: SecurityOptions): Set<string> {
  const hosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  // The Vite proxy keeps the browser's Host header unless `changeOrigin` is set.
  if (opts.dev) for (const o of DEV_ORIGINS) hosts.add(new URL(o).host);
  return hosts;
}

/** Values of the `Origin` header that the server accepts for writes. */
export function allowedOrigins(opts: SecurityOptions): Set<string> {
  const origins = new Set([`http://127.0.0.1:${opts.port}`, `http://localhost:${opts.port}`]);
  if (opts.dev) for (const o of DEV_ORIGINS) origins.add(o);
  return origins;
}

/** True if the request has a body (or says that it has one). */
function hasBody(req: IncomingMessage): boolean {
  const length = req.headers["content-length"];
  if (length !== undefined && length !== "0") return true;
  return req.headers["transfer-encoding"] !== undefined;
}

function mediaType(req: IncomingMessage): string {
  return (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

/**
 * The checks of design 7.4, before each handler. Throws HttpError:
 * - 403 if `Host` is not `127.0.0.1:<port>` or `localhost:<port>`;
 * - 403 if a write (`POST`, `PATCH`, `PUT`, `DELETE`) has no `Origin` or another origin;
 * - 415 if a request with a body is not `application/json` (`POST` and `PATCH` always need it);
 * - 413 if `Content-Length` is larger than MAX_BODY_BYTES.
 */
export function checkRequest(req: IncomingMessage, opts: SecurityOptions): void {
  const host = (req.headers.host ?? "").toLowerCase();
  if (!allowedHosts(opts).has(host)) {
    throw new HttpError(403, `the Host header "${host}" is not accepted. Use http://127.0.0.1:${opts.port}/`);
  }

  const method = req.method ?? "GET";
  if (WRITE_METHODS.has(method)) {
    const origin = req.headers.origin;
    if (origin === undefined) throw new HttpError(403, "the Origin header is required for this request");
    if (!allowedOrigins(opts).has(origin.toLowerCase())) {
      throw new HttpError(403, `the origin "${origin}" is not accepted`);
    }
  }

  if (method === "POST" || method === "PATCH" || method === "PUT" || hasBody(req)) {
    if (mediaType(req) !== "application/json") {
      throw new HttpError(415, "the request body must be application/json");
    }
  }

  const length = Number(req.headers["content-length"] ?? 0);
  if (length > MAX_BODY_BYTES) {
    throw new HttpError(413, `the request body is larger than ${MAX_BODY_BYTES} bytes`);
  }
}

/** Reads the body as JSON. Larger than `limit` gives 413. Not valid JSON gives 400. */
export function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.off("data", onData);
        req.resume(); // discard the remainder
        reject(new HttpError(413, `the request body is larger than ${limit} bytes`));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("error", reject);
    req.on("end", () => {
      if (size > limit) return;
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        reject(new HttpError(400, "the request body is empty"));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new HttpError(400, `the request body is not valid JSON: ${(err as Error).message}`));
      }
    });
  });
}
