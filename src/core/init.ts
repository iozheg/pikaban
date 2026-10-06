import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename } from "node:path";
import { EXIT_GENERAL, EXIT_NOT_FOUND, TrackerError } from "./errors.js";
import { createExclusive } from "./fs.js";
import { projectPaths, TRACKER_DIR, type ProjectPaths } from "./project.js";
import { categoriesWith, DEFAULT_OPTIONAL_CATEGORIES } from "./categories.js";
import { ProjectConfigSchema, SCHEMA_VERSION, validate, type ProjectConfig } from "./schema.js";

export const DEFAULT_CATEGORIES: readonly string[] = categoriesWith(DEFAULT_OPTIONAL_CATEGORIES);

export interface InitOptions {
  /** `project_name`. Default: the folder name. */
  name?: string;
  /** `project_id`. Default: the folder name, in lowercase, with other characters changed to "-". */
  id?: string;
  /** Default: DEFAULT_CATEGORIES. */
  categories?: readonly string[];
}

/** A `project_id` from a folder name: `My Project` gives `my-project`. */
export function projectIdFrom(folderName: string): string {
  const id = folderName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  return id === "" ? "project" : id;
}

function alreadyInitialized(root: string): TrackerError {
  return new TrackerError(EXIT_GENERAL, `${TRACKER_DIR}/ already exists in ${root}. The project is already initialized.`);
}

/**
 * The checks before `initProject`. Writes nothing. Returns the config to write.
 * Code 3 if `root` is not a folder, code 1 if `.tracker/` already exists, code 7 for an invalid config.
 */
export function prepareInit(root: string, opts: InitOptions = {}): ProjectConfig {
  const paths = projectPaths(root);
  if (!existsSync(paths.root) || !statSync(paths.root).isDirectory()) {
    throw new TrackerError(EXIT_NOT_FOUND, `folder not found: ${paths.root}`);
  }
  if (existsSync(paths.trackerDir)) throw alreadyInitialized(paths.root);
  const folder = basename(paths.root);
  return validate(
    ProjectConfigSchema,
    {
      schema_version: SCHEMA_VERSION,
      project_id: opts.id ?? projectIdFrom(folder),
      project_name: opts.name ?? folder,
      categories: [...(opts.categories ?? DEFAULT_CATEGORIES)],
    },
    "project config",
  );
}

/**
 * Makes `<root>/.tracker/tasks/` and `<root>/.tracker/config.json` with `config` from `prepareInit`
 * (design 5). Code 1 if `.tracker/` exists now. Does not change the global config and does not run git.
 */
export function initProject(root: string, config: ProjectConfig): ProjectPaths {
  const paths = projectPaths(root);
  try {
    mkdirSync(paths.trackerDir); // Not recursive: fails if another process made it after the checks.
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw alreadyInitialized(paths.root);
    throw err;
  }
  mkdirSync(paths.tasksDir);
  createExclusive(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
  return paths;
}
