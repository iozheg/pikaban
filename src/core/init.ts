import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename } from "node:path";
import { EXIT_GENERAL, EXIT_NOT_FOUND, TrackerError } from "./errors.js";
import { createExclusive } from "./fs.js";
import { addProject, readGlobalConfig } from "./globalConfig.js";
import { projectPaths, TRACKER_DIR, type ProjectPaths } from "./project.js";
import { ProjectConfigSchema, SCHEMA_VERSION, validate, type ProjectConfig } from "./schema.js";

export const DEFAULT_CATEGORIES = ["backlog", "todo", "in_progress", "done"] as const;

export interface InitOptions {
  /** `project_name`. Default: the folder name. */
  name?: string;
  /** `project_id`. Default: the folder name, in lowercase, with other characters changed to "-". */
  id?: string;
  /** Default: DEFAULT_CATEGORIES. */
  categories?: readonly string[];
  /** Folder of `.tracker_config.json`. Default: `os.homedir()`. */
  homeDir?: string;
  /** Add the project to the global config. Default: true. */
  register?: boolean;
}

export interface InitResult extends ProjectPaths {
  config: ProjectConfig;
  /** False if the path was already in the global config, or `register` is false. */
  registered: boolean;
}

/** A `project_id` from a folder name: `My Project` gives `my-project`. */
export function projectIdFrom(folderName: string): string {
  const id = folderName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  return id === "" ? "project" : id;
}

/** The config that `initProject` writes. Validates it (code 7). */
export function initialConfig(root: string, opts: InitOptions = {}): ProjectConfig {
  const folder = basename(projectPaths(root).root);
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
 * Makes `<root>/.tracker/tasks/` and `<root>/.tracker/config.json`, then adds the project to the
 * global config (design 5, plan step 6). Stops with code 1 if `.tracker/` already exists, and with
 * code 3 if `root` is not a folder. Does not ask questions and does not run git.
 *
 * If the global config step fails, `.tracker/` stays. The error tells how to add the project.
 */
export function initProject(root: string, opts: InitOptions = {}): InitResult {
  const paths = projectPaths(root);
  if (!existsSync(paths.root) || !statSync(paths.root).isDirectory()) {
    throw new TrackerError(EXIT_NOT_FOUND, `folder not found: ${paths.root}`);
  }
  const config = initialConfig(paths.root, opts);
  const exists = () =>
    new TrackerError(EXIT_GENERAL, `${TRACKER_DIR}/ already exists in ${paths.root}. The project is already initialized.`);
  if (existsSync(paths.trackerDir)) throw exists();
  const register = opts.register ?? true;
  const home = opts.homeDir ?? homedir();
  // Read the global config first: if it is not valid (code 7), stop before the first write.
  if (register) readGlobalConfig(home);

  try {
    mkdirSync(paths.trackerDir); // Not recursive: fails if another process made it.
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw exists();
    throw err;
  }
  mkdirSync(paths.tasksDir);
  createExclusive(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);

  let registered = false;
  if (register) {
    try {
      registered = addProject(paths.root, home);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TrackerError(
        err instanceof TrackerError ? err.code : EXIT_GENERAL,
        `${TRACKER_DIR}/ was made, but the project was not added to the global config: ${msg}\n` +
          `Correct the problem, then run: tracker projects add "${paths.root}"`,
        { cause: err },
      );
    }
  }
  return { ...paths, config, registered };
}
