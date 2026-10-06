import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { EXIT_VALIDATION, TrackerError } from "./errors.js";
import { atomicWrite } from "./fs.js";
import { GlobalConfigSchema, validate, type GlobalConfig } from "./schema.js";

export const GLOBAL_CONFIG_NAME = ".tracker_config.json";

export function globalConfigPath(homeDir = homedir()): string {
  return join(homeDir, GLOBAL_CONFIG_NAME);
}

/** Reads `~/.tracker_config.json`. A missing file gives an empty list. */
export function readGlobalConfig(homeDir = homedir()): GlobalConfig {
  const file = globalConfigPath(homeDir);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { projects: [] };
    throw err;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new TrackerError(EXIT_VALIDATION, `${file}: invalid JSON: ${(err as Error).message}`, { cause: err });
  }
  return validate(GlobalConfigSchema, data, file);
}

export function listProjects(homeDir = homedir()): string[] {
  return readGlobalConfig(homeDir).projects;
}

/** Adds the absolute path of `projectDir`. Returns false if the path is already in the list. */
export function addProject(projectDir: string, homeDir = homedir()): boolean {
  const config = readGlobalConfig(homeDir);
  const path = resolve(projectDir);
  if (config.projects.includes(path)) return false;
  writeGlobalConfig({ ...config, projects: [...config.projects, path] }, homeDir);
  return true;
}

/** Removes the path. Returns false if the path is not in the list. */
export function removeProject(projectDir: string, homeDir = homedir()): boolean {
  const config = readGlobalConfig(homeDir);
  const path = resolve(projectDir);
  if (!config.projects.includes(path)) return false;
  writeGlobalConfig({ ...config, projects: config.projects.filter((p) => p !== path) }, homeDir);
  return true;
}

function writeGlobalConfig(config: GlobalConfig, homeDir: string): void {
  atomicWrite(globalConfigPath(homeDir), `${JSON.stringify(config, null, 2)}\n`);
}
