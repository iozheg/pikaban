import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { atomicWrite, EXIT_VALIDATION, TrackerError } from "../core/index.js";

/** The Claude Code permission rule that lets the agent run `tracker` without prompts. */
export const PERMISSION_RULE = "Bash(tracker:*)";

type JsonObject = Record<string, unknown>;

export interface SettingsFile {
  /** The parsed file. `{}` if the file does not exist. */
  data: JsonObject;
  /** The file text, or null if the file does not exist. */
  text: string | null;
}

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function invalid(file: string, why: string, cause?: unknown): TrackerError {
  return new TrackerError(EXIT_VALIDATION, `${file}: ${why}. The file was not changed.`, { cause });
}

/**
 * Reads a Claude Code `settings.json` (or `settings.local.json`). A missing file gives `{}`.
 * Code 7 if the JSON is not valid, or if `permissions` or `permissions.allow` has a wrong type.
 */
export function readSettings(file: string): SettingsFile {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, text: null };
    throw err;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw invalid(file, `invalid JSON: ${(err as Error).message}`, err);
  }
  if (!isObject(data)) throw invalid(file, "the JSON is not an object");
  const permissions = data.permissions;
  if (permissions !== undefined) {
    if (!isObject(permissions)) throw invalid(file, '"permissions" is not an object');
    const allow = permissions.allow;
    if (allow !== undefined && !Array.isArray(allow)) throw invalid(file, '"permissions.allow" is not an array');
  }
  return { data, text };
}

/** True if `permissions.allow` already contains the rule. */
export function hasPermissionRule(settings: SettingsFile, rule = PERMISSION_RULE): boolean {
  const allow = (settings.data.permissions as JsonObject | undefined)?.allow as unknown[] | undefined;
  return allow?.includes(rule) ?? false;
}

export interface PermissionResult {
  file: string;
  /** `added`: the rule was written. `present`: the rule was already there, nothing was written. */
  status: "added" | "present";
  /** The backup of the old file (`<file>.bak`), or null if no backup was written. */
  backup: string | null;
}

/** The indentation of the first indented line, so the file keeps its style. Default: 2 spaces. */
function indentOf(text: string | null): string {
  const m = text === null ? null : /\n([ \t]+)\S/.exec(text);
  return m ? m[1]! : "  ";
}

/**
 * Adds `Bash(tracker:*)` to `permissions.allow` in `file` (plan step 8). `file` is a
 * `settings.json` or a `settings.local.json`.
 * - A missing file is `{}`. The folder is made if necessary.
 * - Invalid JSON: code 7, nothing is written.
 * - All other keys stay, in the same sequence. The rule is not added two times.
 * - If the file existed, the old text goes to `<file>.bak` first. Then the file is written atomically.
 */
export function addPermissionRule(file: string, rule = PERMISSION_RULE): PermissionResult {
  const settings = readSettings(file);
  if (hasPermissionRule(settings, rule)) return { file, status: "present", backup: null };

  // Changes the parsed object in place: JSON.parse keeps the key sequence, and new keys go last.
  const data = settings.data;
  if (data.permissions === undefined) data.permissions = {};
  const permissions = data.permissions as JsonObject;
  if (permissions.allow === undefined) permissions.allow = [];
  (permissions.allow as unknown[]).push(rule);

  mkdirSync(dirname(file), { recursive: true });
  let backup: string | null = null;
  if (settings.text !== null) {
    backup = `${file}.bak`;
    atomicWrite(backup, settings.text);
  }
  atomicWrite(file, `${JSON.stringify(data, null, indentOf(settings.text))}\n`);
  return { file, status: "added", backup };
}
