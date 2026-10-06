// Types of the UI server API (design 7.2, plan step 10). The UI does not import the core module:
// the core module uses Node.js APIs. Keep these types in agreement with src/core/schema.ts and
// src/server/routes.ts.

export type Assignee = "agent" | "user" | null;

/** A task as the API sends it. `file` is the file name only. `etag` is the concurrency token. */
export interface Task {
  id: string;
  short: string;
  title: string;
  category: string;
  assignee: Assignee;
  needs_input: boolean;
  created_at: string;
  updated_at: string;
  body: string;
  file: string;
  etag: string;
}

/** A task file that is not valid. It has no category, so the board shows it as an error card. */
export interface InvalidFile {
  file: string;
  error: string;
}

export interface TaskList {
  tasks: Task[];
  invalid: InvalidFile[];
}

export type ProjectStatus = "ok" | "missing" | "schema_mismatch" | "invalid";

export interface ProjectSummary {
  pid: string;
  root: string;
  name: string;
  project_id: string | null;
  schema_version: number | null;
  status: ProjectStatus;
  /** Why the project is not available. */
  message?: string;
}

export interface ProjectConfig {
  schema_version: number;
  project_id: string;
  project_name: string;
  categories: string[];
}

export interface ProjectDetail extends ProjectSummary {
  config: ProjectConfig | null;
}

/** The fields that PATCH can change. */
export interface TaskPatch {
  title?: string;
  category?: string;
  assignee?: Assignee;
  needs_input?: boolean;
  body?: string;
}

/** The data of one SSE message from `GET /api/events` (design 7.3). */
export interface TrackerEvent {
  type: "changed" | "removed" | "config" | "projects";
  pid?: string;
  id?: string;
  file?: string;
}
