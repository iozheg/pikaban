import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  EXIT_NOT_FOUND,
  EXIT_SCHEMA_VERSION,
  EXIT_VALIDATION,
  TrackerError,
} from "./errors.js";
import { ProjectConfigSchema, SCHEMA_VERSION, validate, type ProjectConfig } from "./schema.js";

export const TRACKER_DIR = ".tracker";

export interface ProjectPaths {
  /** The project folder (the parent of `.tracker/`). */
  root: string;
  trackerDir: string;
  tasksDir: string;
  configFile: string;
}

export interface Project extends ProjectPaths {
  config: ProjectConfig;
}

export function projectPaths(root: string): ProjectPaths {
  const abs = resolve(root);
  const trackerDir = join(abs, TRACKER_DIR);
  return {
    root: abs,
    trackerDir,
    tasksDir: join(trackerDir, "tasks"),
    configFile: join(trackerDir, "config.json"),
  };
}

/** Searches up from `startDir` for `.tracker/config.json`. Returns the project folder, or code 3. */
export function findProject(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(projectPaths(dir).configFile)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new TrackerError(
    EXIT_NOT_FOUND,
    `no ${TRACKER_DIR}/ folder in ${resolve(startDir)} or its parent folders. Run "tracker init" to make one.`,
  );
}

/** Reads `config.json` as JSON, without validation. Missing file gives code 3, bad JSON gives code 7. */
export function readRawConfig(configFile: string): unknown {
  let text: string;
  try {
    text = readFileSync(configFile, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TrackerError(EXIT_NOT_FOUND, `project config not found: ${configFile}`, { cause: err });
    }
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new TrackerError(EXIT_VALIDATION, `${configFile}: invalid JSON: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

/**
 * Reads the project config and compares `schema_version` with SCHEMA_VERSION (design 8).
 * Higher version: code 6. Lower version: code 6 only with `write: true`.
 */
export function openProject(dir: string, opts: { write?: boolean } = {}): Project {
  const paths = projectPaths(dir);
  const raw = readRawConfig(paths.configFile);
  // Compare the version before the full validation: another version can have other fields.
  const version = (raw as { schema_version?: unknown } | null)?.schema_version;
  if (Number.isInteger(version)) checkSchemaVersion(version as number, paths.configFile, opts.write ?? false);
  const config = validate(ProjectConfigSchema, raw, paths.configFile);
  return { ...paths, config };
}

/** Code 6 if a write is not allowed for a project opened with a lower schema version. */
export function assertWritable(p: Project): void {
  checkSchemaVersion(p.config.schema_version, p.configFile, true);
}

function checkSchemaVersion(version: number, source: string, write: boolean): void {
  if (version > SCHEMA_VERSION) {
    throw new TrackerError(
      EXIT_SCHEMA_VERSION,
      `${source}: schema version ${version} is newer than this CLI (version ${SCHEMA_VERSION}). Update the tracker CLI.`,
    );
  }
  if (version < SCHEMA_VERSION && write) {
    throw new TrackerError(
      EXIT_SCHEMA_VERSION,
      `${source}: schema version ${version} is older than this CLI (version ${SCHEMA_VERSION}). Run "tracker migrate".`,
    );
  }
}
