import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import {
  EXIT_NOT_FOUND,
  EXIT_SCHEMA_VERSION,
  listProjects,
  openProject,
  SCHEMA_VERSION,
  TrackerError,
  type Project,
  type ProjectConfig,
} from "../core/index.js";
import { HttpError } from "./http.js";

/** `<pid>`: the first 12 hex characters of the SHA-256 of the absolute project path (design 7.2). */
export function pidOf(root: string): string {
  return createHash("sha256").update(resolve(root)).digest("hex").slice(0, 12);
}

/** pid to absolute project path, from the global config. The only way from a request to a project. */
export function projectMap(homeDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const root of listProjects(homeDir)) map.set(pidOf(root), resolve(root));
  return map;
}

export type ProjectStatus = "ok" | "missing" | "schema_mismatch" | "invalid";

export interface ProjectSummary {
  pid: string;
  root: string;
  /** `project_name`, or the folder name if the config cannot be read. */
  name: string;
  project_id: string | null;
  schema_version: number | null;
  status: ProjectStatus;
  /** Why the project is not available. Only if `status` is not "ok". */
  message?: string;
  /** The project config. Null if the project is not available. */
  config: ProjectConfig | null;
}

/** The status of one project. Opens it read-only. A lower schema version is "schema_mismatch" (design 8). */
export function describeProject(root: string): ProjectSummary {
  const base = { pid: pidOf(root), root: resolve(root) };
  try {
    const p = openProject(root, { write: false });
    const summary: ProjectSummary = {
      ...base,
      name: p.config.project_name,
      project_id: p.config.project_id,
      schema_version: p.config.schema_version,
      status: "ok",
      config: p.config,
    };
    if (p.config.schema_version !== SCHEMA_VERSION) {
      summary.status = "schema_mismatch";
      summary.message =
        `schema version ${p.config.schema_version} is older than this tracker (version ${SCHEMA_VERSION}). ` +
        `Run "tracker migrate" in the project.`;
      summary.config = null;
    }
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    let status: ProjectStatus = "invalid";
    if (err instanceof TrackerError && err.code === EXIT_NOT_FOUND) status = "missing";
    if (err instanceof TrackerError && err.code === EXIT_SCHEMA_VERSION) status = "schema_mismatch";
    return { ...base, name: basename(base.root), project_id: null, schema_version: null, status, message, config: null };
  }
}

/** The project root for `pid`. Unknown pid gives 404. */
export function rootOf(homeDir: string, pid: string): string {
  const root = projectMap(homeDir).get(pid);
  if (root === undefined) throw new HttpError(404, `project not found: ${pid}`);
  return root;
}

/** Opens the project of `pid` (codes 3, 6, 7 from the core module). */
export function projectOf(homeDir: string, pid: string, opts: { write: boolean }): Project {
  return openProject(rootOf(homeDir, pid), opts);
}
