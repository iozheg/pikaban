import { EXIT_GENERAL, TrackerError } from "./errors.js";
import { openProject } from "./project.js";
import { SCHEMA_VERSION } from "./schema.js";

export interface MigrateResult {
  from: number;
  to: number;
  dryRun: boolean;
  /** The migrations that ran, as "n -> n+1". */
  applied: string[];
  /** Files that changed (or would change with `dryRun`). */
  changedFiles: string[];
}

/**
 * `tracker migrate` (design 8). Version 1 is the first schema version, so there are no migrations
 * yet: a current project needs nothing, and an older one cannot exist. Add the migration runner
 * (n to n+1 steps, task files first, `config.json` last) together with the first migration.
 */
export function migrate(dir: string, opts: { dryRun?: boolean } = {}): MigrateResult {
  const p = openProject(dir); // code 6 for a newer schema version
  const from = p.config.schema_version;
  if (from !== SCHEMA_VERSION) {
    throw new TrackerError(EXIT_GENERAL, `${p.configFile}: no migration from schema version ${from} to ${SCHEMA_VERSION}`);
  }
  return { from, to: SCHEMA_VERSION, dryRun: opts.dryRun ?? false, applied: [], changedFiles: [] };
}
