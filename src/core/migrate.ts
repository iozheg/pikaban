import { readFileSync } from "node:fs";
import { EXIT_GENERAL, EXIT_SCHEMA_VERSION, EXIT_VALIDATION, TrackerError } from "./errors.js";
import { atomicWrite } from "./fs.js";
import { projectPaths, readRawConfig, type ProjectPaths } from "./project.js";
import { ProjectConfigSchema, SCHEMA_VERSION, validate } from "./schema.js";
import { taskFilePaths } from "./tasks.js";

export interface MigrationContext extends ProjectPaths {
  /** The config as raw JSON. A migration can change it. The runner sets `schema_version` and writes it last. */
  config: Record<string, unknown>;
  /** Absolute paths of the `*.md` files at depth 0 of `.tracker/tasks/`. */
  taskFiles: string[];
  read(file: string): string;
  /** Writes atomically. Does nothing with `dryRun`. Writes of the same text are not counted. */
  write(file: string, text: string): void;
}

/** One step from `from` to `from + 1`. `run` must give the same result if it runs two times. */
export interface Migration {
  from: number;
  to: number;
  run(ctx: MigrationContext): void;
}

// Version 1 is the first version: no migrations.
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrateResult {
  from: number;
  to: number;
  dryRun: boolean;
  /** The migrations that ran, as "n -> n+1". */
  applied: string[];
  /** Files that changed (or would change with `dryRun`). The config is last. */
  changedFiles: string[];
}

/** Applies the migrations in sequence from `config.schema_version` to SCHEMA_VERSION (design 8). */
export function migrate(
  dir: string,
  opts: { dryRun?: boolean; migrations?: readonly Migration[] } = {},
): MigrateResult {
  const paths = projectPaths(dir);
  const dryRun = opts.dryRun ?? false;
  const migrations = opts.migrations ?? MIGRATIONS;
  const raw = readRawConfig(paths.configFile);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TrackerError(EXIT_VALIDATION, `${paths.configFile}: the config must be a JSON object`);
  }
  const config = { ...(raw as Record<string, unknown>) };
  const from = config.schema_version;
  if (typeof from !== "number" || !Number.isInteger(from) || from < 0) {
    throw new TrackerError(EXIT_VALIDATION, `${paths.configFile}: schema_version must be an integer`);
  }
  if (from > SCHEMA_VERSION) {
    throw new TrackerError(
      EXIT_SCHEMA_VERSION,
      `${paths.configFile}: schema version ${from} is newer than this CLI (version ${SCHEMA_VERSION}). Update the tracker CLI.`,
    );
  }

  const result: MigrateResult = { from, to: SCHEMA_VERSION, dryRun, applied: [], changedFiles: [] };
  if (from === SCHEMA_VERSION) return result;

  // Find all steps before the first write.
  const steps: Migration[] = [];
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const m = migrations.find((x) => x.from === v && x.to === v + 1);
    if (!m) throw new TrackerError(EXIT_GENERAL, `no migration from schema version ${v} to ${v + 1}`);
    steps.push(m);
  }

  const changed = new Set<string>();
  // With dryRun, later migrations read the text that earlier migrations did not write.
  const pending = new Map<string, string>();
  const read = (file: string) => pending.get(file) ?? readFileSync(file, "utf8");
  const ctx: MigrationContext = {
    ...paths,
    config,
    taskFiles: taskFilePaths(paths.tasksDir),
    read,
    write: (file, text) => {
      if (readOrNull(read, file) === text) return;
      changed.add(file);
      if (dryRun) pending.set(file, text);
      else atomicWrite(file, text);
    },
  };

  for (const m of steps) {
    m.run(ctx);
    ctx.config.schema_version = m.to;
    result.applied.push(`${m.from} -> ${m.to}`);
  }

  // The config is written last. If a migration stops before, the next run starts again.
  validate(ProjectConfigSchema, ctx.config, paths.configFile);
  if (!dryRun) atomicWrite(paths.configFile, `${JSON.stringify(ctx.config, null, 2)}\n`);
  result.changedFiles = [...changed, paths.configFile];
  return result;
}

function readOrNull(read: (file: string) => string, file: string): string | null {
  try {
    return read(file);
  } catch {
    return null;
  }
}
