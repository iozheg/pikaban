import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  EXIT_GENERAL,
  EXIT_NOT_FOUND,
  EXIT_USAGE,
  findProject,
  openProject,
  TrackerError,
  type Assignee,
  type Project,
} from "../core/index.js";
import { Output } from "./output.js";

/**
 * Environment variable for the home folder of the tracker: the folder of `.tracker_config.json`,
 * and the base of `.claude/` for the user skill and the user `settings.json`. Default: the home
 * folder. Tests set it, so that they never touch the real `~/.tracker_config.json` or `~/.claude/`.
 */
export const TRACKER_HOME_ENV = "TRACKER_HOME";

export function homeDir(): string {
  const v = process.env[TRACKER_HOME_ENV];
  return v ? resolve(v) : homedir();
}

/** Values of the global options for one command run. */
export interface Context {
  /** `-C <path>` or the current folder, as an absolute path. */
  startDir: string;
  json: boolean;
  homeDir: string;
  out: Output;
  /** Searches up from `startDir` for `.tracker/` and opens the project (code 3 or 6). */
  project(opts: { write: boolean }): Project;
  /** The project folder (searched up from `startDir`). Code 3 if none. */
  projectRoot(): string;
}

/** Makes the Context from the global options (`-C`, `--json`) of the program. */
export function contextOf(cmd: Command): Context {
  const g = cmd.optsWithGlobals<{ C?: string; json?: boolean }>();
  const startDir = resolve(g.C ?? process.cwd());
  const projectRoot = () => {
    // Do not search up from a -C folder that does not exist: that can find an unexpected project.
    if (!existsSync(startDir)) throw new TrackerError(EXIT_NOT_FOUND, `folder not found: ${startDir}`);
    return findProject(startDir);
  };
  return {
    startDir,
    json: g.json ?? false,
    homeDir: homeDir(),
    out: new Output(g.json ?? false),
    project: (opts) => openProject(projectRoot(), opts),
    projectRoot,
  };
}

/** True if `--json` is in argv before `--`. For errors before or during the parse of the options. */
export function argvHasJson(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--json");
}

export function usageError(message: string): TrackerError {
  return new TrackerError(EXIT_USAGE, message);
}

/** `agent`, `user` or `none` (null). Other text gives code 2. */
export function parseAssignee(text: string): Assignee {
  if (text === "agent" || text === "user") return text;
  if (text === "none") return null;
  throw usageError(`invalid assignee "${text}". Use agent, user or none.`);
}

/** `true` or `false` only. Other text gives code 2. */
export function parseBool(text: string, option: string): boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  throw usageError(`invalid value "${text}" for ${option}. Use true or false.`);
}

/** Reads a text file. `-` reads stdin. A read error gives code 1. */
export function readTextFile(path: string): string {
  try {
    return readFileSync(path === "-" ? 0 : resolve(path), "utf8");
  } catch (err) {
    throw new TrackerError(EXIT_GENERAL, `cannot read ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Text from `--<textOption> <text>` or `--<fileOption> <path>`. Both given gives code 2. */
export function textOrFile(
  text: string | undefined,
  file: string | undefined,
  names: { text: string; file: string },
): string | undefined {
  if (text !== undefined && file !== undefined) {
    throw usageError(`use ${names.text} or ${names.file}, not both`);
  }
  return file !== undefined ? readTextFile(file) : text;
}
