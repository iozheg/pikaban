import type { IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";
import { z } from "zod";
import {
  create,
  EXIT_CONFLICT,
  EXIT_NOT_FOUND,
  EXIT_VALIDATION,
  get,
  listProjects,
  remove,
  TrackerError,
  ULID_RE,
  update,
  validate,
  list,
  type InvalidTaskFile,
  type Project,
  type Task,
  type TaskPatch,
} from "../core/index.js";
import { failRequest, HttpError, sendError, sendJson, sendNoContent } from "./http.js";
import { describeProject, projectOf } from "./projects.js";
import { readJsonBody } from "./security.js";
import type { EventHub } from "./watcher.js";

export interface ApiContext {
  homeDir: string;
  events: EventHub;
}

/** A task in API responses: `file` is only the file name, not the absolute path. */
export type ApiTask = Omit<Task, "file"> & { file: string };

export function apiTask(t: Task): ApiTask {
  return { ...t, file: basename(t.file) };
}

function apiInvalid(f: InvalidTaskFile): InvalidTaskFile {
  return { file: basename(f.file), error: f.error };
}

/** `"<etag>"` (a strong HTTP entity tag). */
export function etagHeader(t: Task): string {
  return `"${t.etag}"`;
}

/** The token from `If-Match`, with or without quotes. Missing gives 428. */
export function ifMatchOf(req: IncomingMessage): string {
  const raw = req.headers["if-match"]?.trim() ?? "";
  if (raw === "" || raw === "*") {
    throw new HttpError(428, "the If-Match header is required. Send the ETag of the task.");
  }
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

const CreateSchema = z.strictObject({
  title: z.string(),
  body: z.string().optional(),
  category: z.string().optional(),
});

const PID_RE = /^[0-9a-f]{12}$/;

function methodNotAllowed(allow: string[]): HttpError {
  return new HttpError(405, `method not allowed. Use: ${allow.join(", ")}`, undefined, { Allow: allow.join(", ") });
}

function requireMethod(req: IncomingMessage, allow: string[]): string {
  const m = req.method ?? "GET";
  if (!allow.includes(m)) throw methodNotAllowed(allow);
  return m;
}

/** The task ULID from the path. Only a full ULID: a short name can have more than one task. */
function taskId(text: string): string {
  const id = text.toUpperCase();
  if (!ULID_RE.test(id)) throw new HttpError(400, `"${text}" is not a task ULID`);
  return id;
}

/** Handles a request to `/api/...`. The security checks are already done. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: ApiContext) {
  try {
    await route(req, res, pathname, ctx);
  } catch (err) {
    await failRequest(req, res, err);
  }
}

async function route(req: IncomingMessage, res: ServerResponse, pathname: string, ctx: ApiContext): Promise<void> {
  const parts = pathname.split("/").slice(2); // "/api/a/b" -> ["a", "b"]
  const notFound = () => new HttpError(404, `not found: ${pathname}`);

  if (parts.length === 1 && parts[0] === "events") {
    requireMethod(req, ["GET"]);
    ctx.events.connect(req, res);
    return;
  }
  if (parts[0] !== "projects") throw notFound();

  if (parts.length === 1) {
    requireMethod(req, ["GET"]);
    sendJson(res, 200, listProjects(ctx.homeDir).map((root) => describeProject(root)));
    return;
  }

  const pid = parts[1]!;
  if (!PID_RE.test(pid)) throw notFound();
  if (parts[2] !== "tasks" || parts.length > 4) throw notFound();

  if (parts.length === 3) {
    const method = requireMethod(req, ["GET", "POST"]);
    if (method === "GET") {
      const { tasks, invalid } = list(projectOf(ctx.homeDir, pid, { write: false }));
      sendJson(res, 200, { tasks: tasks.map(apiTask), invalid: invalid.map(apiInvalid) });
      return;
    }
    const input = validate(CreateSchema, await readJsonBody(req), "request body");
    const task = create(projectOf(ctx.homeDir, pid, { write: true }), input);
    sendJson(res, 201, apiTask(task), {
      ETag: etagHeader(task),
      Location: `/api/projects/${pid}/tasks/${task.id}`,
    });
    return;
  }

  const id = taskId(parts[3]!);
  const method = requireMethod(req, ["GET", "PATCH", "DELETE"]);
  if (method === "GET") {
    const task = get(projectOf(ctx.homeDir, pid, { write: false }), id);
    sendJson(res, 200, apiTask(task), { ETag: etagHeader(task) });
    return;
  }

  // Check the If-Match header before the body and before the project: 428 has priority.
  const ifMatch = ifMatchOf(req);
  if (method === "PATCH") {
    const patch = (await readJsonBody(req)) as TaskPatch;
    if (patch !== null && typeof patch === "object" && !Array.isArray(patch) && Object.keys(patch).length === 0) {
      throw new TrackerError(EXIT_VALIDATION, "request body: no fields to change");
    }
    const p = projectOf(ctx.homeDir, pid, { write: true });
    const task = withConflictBody(res, p, id, () => update(p, id, patch, { ifMatch }));
    if (task) sendJson(res, 200, apiTask(task), { ETag: etagHeader(task) });
    return;
  }

  const p = projectOf(ctx.homeDir, pid, { write: true });
  const done = withConflictBody(res, p, id, () => {
    remove(p, id, { ifMatch });
    return true;
  });
  if (done) sendNoContent(res);
}

/**
 * Runs a write. On a conflict (code 5), sends 412 with the current task in `current` (or null if the
 * file is gone), so that the UI can show the new content (design 7.1 item 8). Returns undefined then.
 */
function withConflictBody<T>(res: ServerResponse, p: Project, id: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    if (!(err instanceof TrackerError) || err.code !== EXIT_CONFLICT) throw err;
    let current: ApiTask | null = null;
    try {
      current = apiTask(get(p, id));
    } catch (e) {
      if (!(e instanceof TrackerError && e.code === EXIT_NOT_FOUND)) throw e;
    }
    sendError(res, err, { current });
    return undefined;
  }
}
