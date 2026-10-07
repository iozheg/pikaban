import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EXIT_AMBIGUOUS,
  EXIT_CONFLICT,
  EXIT_GENERAL,
  EXIT_NOT_FOUND,
  EXIT_SCHEMA_VERSION,
  EXIT_USAGE,
  EXIT_VALIDATION,
  PikabanError,
} from "../core/index.js";

/** An error with an HTTP status. `code` is the pikaban exit code in the error body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: number = status === 404 ? EXIT_NOT_FOUND : EXIT_USAGE,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Pikaban exit code to HTTP status (plan step 10).
const STATUS_OF_CODE: Record<number, number> = {
  [EXIT_USAGE]: 400,
  [EXIT_NOT_FOUND]: 404,
  [EXIT_AMBIGUOUS]: 409,
  [EXIT_CONFLICT]: 412,
  [EXIT_SCHEMA_VERSION]: 409,
  [EXIT_VALIDATION]: 422,
};

export function statusOfCode(code: number): number {
  return STATUS_OF_CODE[code] ?? 500;
}

/** Headers for all API responses. */
const API_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): void {
  const text = `${JSON.stringify(data)}\n`;
  res.writeHead(status, {
    ...API_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(text)),
    ...headers,
  });
  res.end(text);
}

export function sendNoContent(res: ServerResponse, headers: Record<string, string> = {}): void {
  res.writeHead(204, { ...API_HEADERS, ...headers });
  res.end();
}

/** The error body `{"error":{"code":N,"message":"..."}}`, plus `extra` fields. */
export function sendError(res: ServerResponse, err: unknown, extra: Record<string, unknown> = {}): void {
  let status: number;
  let code: number;
  let message: string;
  let headers: Record<string, string> = {};
  if (err instanceof HttpError) {
    ({ status, code, message, headers } = err);
  } else if (err instanceof PikabanError) {
    status = statusOfCode(err.code);
    code = err.code;
    message = err.message;
  } else {
    status = 500;
    code = EXIT_GENERAL;
    message = err instanceof Error ? err.message : String(err);
  }
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJson(res, status, { error: { code, message }, ...extra }, headers);
}

/** Above this size, `discardBody` closes the connection instead of reading the body to the end. */
const DISCARD_LIMIT = 16 * 1024 * 1024;

/**
 * Reads the rest of the request body and discards it. Call it before an error response: if the
 * server answers and closes the connection while the client still sends, the client gets a
 * connection reset and not the response.
 */
export function discardBody(req: IncomingMessage): Promise<void> {
  if (req.readableEnded || req.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > DISCARD_LIMIT) {
        req.destroy();
        resolve();
      }
    });
    req.once("end", () => resolve());
    req.once("close", () => resolve());
    req.once("error", () => resolve());
    req.resume();
  });
}

/** Discards the unread request body, then sends the error. */
export async function failRequest(req: IncomingMessage, res: ServerResponse, err: unknown): Promise<void> {
  await discardBody(req);
  sendError(res, err);
}
