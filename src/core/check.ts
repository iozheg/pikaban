import { basename } from "node:path";
import { fileName, nextShort } from "./ids.js";
import type { Project } from "./project.js";
import { SCHEMA_VERSION } from "./schema.js";
import { changeShort, list, type Task } from "./tasks.js";

export type CheckIssueKind =
  | "schema_version"
  | "invalid_task"
  | "duplicate_short"
  | "file_name"
  | "skill_version";

export interface CheckIssue {
  kind: CheckIssueKind;
  severity: "error" | "warning";
  file: string;
  message: string;
  /** True if `fix` corrected the issue. */
  fixed?: boolean;
}

export interface CheckReport {
  /** True if no error remains. Warnings do not count. */
  ok: boolean;
  issues: CheckIssue[];
}

export interface CheckOptions {
  /** Give a new short name to the newer task of each duplicate pair, and rename its file. */
  fix?: boolean;
}

/** True if no error remains. Warnings do not count. */
export function isOk(issues: readonly CheckIssue[]): boolean {
  return !issues.some((i) => i.severity === "error" && !i.fixed);
}

/**
 * Validates the task files of a project. The config is already valid: `openProject` checked it.
 * Open the project with `write: true` for `fix`.
 */
export function check(p: Project, opts: CheckOptions = {}): CheckReport {
  const issues: CheckIssue[] = [];
  const v = p.config.schema_version;
  if (v !== SCHEMA_VERSION) {
    issues.push({
      kind: "schema_version",
      severity: "error",
      file: p.configFile,
      message: `schema version ${v} is different from the CLI (version ${SCHEMA_VERSION}). Run "tracker migrate".`,
    });
  }

  const { tasks, invalid } = list(p);
  for (const f of invalid) issues.push({ kind: "invalid_task", severity: "error", file: f.file, message: f.error });

  // Duplicate short names. The oldest task (lowest ULID) keeps the name. `tasks` is sorted by ULID.
  const live = tasks.map((t) => ({ id: t.id, short: t.short }));
  const seen = new Map<string, Task>();
  for (const [i, t] of tasks.entries()) {
    const older = seen.get(t.short);
    if (!older) {
      seen.set(t.short, t);
      continue;
    }
    const issue: CheckIssue = {
      kind: "duplicate_short",
      severity: "error",
      file: t.file,
      message: `${t.short} is also the short name of ${older.id}`,
    };
    if (opts.fix) {
      const short = nextShort(live);
      tasks[i] = changeShort(p, t, short);
      live[i]!.short = short;
      issue.message += `. New short name: ${short}`;
      issue.fixed = true;
    }
    issues.push(issue);
  }

  for (const t of tasks) {
    const expected = fileName(t.short, t.id);
    if (basename(t.file) !== expected) {
      issues.push({
        kind: "file_name",
        severity: "warning",
        file: t.file,
        message: `the file name does not agree with short and id. Expected: ${expected}`,
      });
    }
  }

  return { ok: isOk(issues), issues };
}
