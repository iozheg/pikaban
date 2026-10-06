import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, EXIT_GENERAL, TrackerError, type CheckIssue } from "../core/index.js";
import { lineDiff } from "./diff.js";
import { CLI_VERSION, compareVersions } from "./version.js";

export type SkillScope = "user" | "project";

/** `--skill` answers of `tracker init`. */
export const SKILL_CHOICES = ["project", "user", "none"] as const;
export type SkillChoice = (typeof SKILL_CHOICES)[number];

const VERSION_PLACEHOLDER = "{{version}}";
const VERSION_LINE = /<!--[ \t]*tracker-skill-version:[ \t]*(\S+?)[ \t]*-->/;

/**
 * The skill file under `base`. `base` is the home folder (user scope) or the project folder.
 * Both give `<base>/.claude/skills/tracker/SKILL.md`.
 */
export function skillFile(base: string): string {
  return join(base, ".claude", "skills", "tracker", "SKILL.md");
}

/** The Claude Code settings file under `base` (home folder or project folder). */
export function settingsFile(base: string): string {
  return join(base, ".claude", "settings.json");
}

/**
 * Locations of the packaged `SKILL.md`, relative to this module at run time:
 * - built: this code is bundled into `dist/cli.js`, and the build copies the file to `dist/skill/`;
 * - source (tests): this module is `src/skill/install.ts`, next to `SKILL.md`.
 */
export function packagedSkillCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "skill", "SKILL.md"), join(here, "SKILL.md")];
}

/** The skill template text of the package (with the `{{version}}` placeholder). Code 1 if missing. */
export function readSkillTemplate(): string {
  const candidates = packagedSkillCandidates();
  for (const file of candidates) {
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  throw new TrackerError(
    EXIT_GENERAL,
    `the skill text is not in the package (looked for ${candidates.join(", ")}). Reinstall the tracker CLI.`,
  );
}

/** The skill text with `version` in the version line. */
export function renderSkill(template: string, version: string): string {
  if (!template.includes(VERSION_PLACEHOLDER)) {
    throw new TrackerError(EXIT_GENERAL, `the skill template has no ${VERSION_PLACEHOLDER} placeholder`);
  }
  return template.split(VERSION_PLACEHOLDER).join(version);
}

/** The skill text that this CLI installs. */
export function packagedSkill(version = CLI_VERSION): string {
  return renderSkill(readSkillTemplate(), version);
}

/** The version in the `<!-- tracker-skill-version: X.Y.Z -->` line, or null if there is no such line. */
export function skillVersionOf(text: string): string | null {
  return VERSION_LINE.exec(text)?.[1] ?? null;
}

/**
 * - `installed`: the file did not exist. It was written.
 * - `unchanged`: the file has the same content. Nothing was written.
 * - `updated`: the file had an older version line and no other changes. It was replaced.
 * - `replaced`: the file had other changes. `--force` replaced it.
 * - `conflict`: the file had other changes. Nothing was written (no `--force`).
 */
export type SkillInstallStatus = "installed" | "unchanged" | "updated" | "replaced" | "conflict";

export interface SkillInstallResult {
  status: SkillInstallStatus;
  file: string;
  /** The version of the package text. */
  version: string;
  /** The version line of the file before the operation. Null if no file or no version line. */
  previousVersion: string | null;
  /** For `conflict` and `replaced`: a line diff from the file to the package text. */
  diff?: string;
}

/** Finds what `installSkill` does with `file`. Writes nothing. */
export function planSkillInstall(file: string, text: string, opts: { force?: boolean } = {}): SkillInstallResult {
  const version = skillVersionOf(text) ?? "";
  if (!existsSync(file)) return { status: "installed", file, version, previousVersion: null };
  const current = readFileSync(file, "utf8");
  const previousVersion = skillVersionOf(current);
  if (current === text) return { status: "unchanged", file, version, previousVersion };

  // Only an older version line is different: an automatic update.
  if (previousVersion !== null && compareVersions(previousVersion, version) === -1) {
    const sameVersion = current.replace(VERSION_LINE, () => `<!-- tracker-skill-version: ${version} -->`);
    if (sameVersion === text) return { status: "updated", file, version, previousVersion };
  }

  const diff = lineDiff(current, text, { old: `${file} (installed)`, new: `skill text of tracker ${CLI_VERSION}` });
  return { status: opts.force ? "replaced" : "conflict", file, version, previousVersion, diff };
}

/**
 * Installs the skill text into `file` (plan step 8). Writes atomically and makes the folders.
 * A `conflict` result writes nothing: the caller shows the diff and stops.
 */
export function installSkill(file: string, text: string, opts: { force?: boolean } = {}): SkillInstallResult {
  const result = planSkillInstall(file, text, opts);
  if (result.status === "installed" || result.status === "updated" || result.status === "replaced") {
    mkdirSync(dirname(file), { recursive: true });
    atomicWrite(file, text);
  }
  return result;
}

/** The command that installs the skill of `scope` (for messages). */
export function skillInstallCommand(scope: SkillScope, opts: { force?: boolean; allow?: boolean; root?: string } = {}): string {
  const parts = ["tracker"];
  if (opts.root !== undefined) parts.push("-C", JSON.stringify(opts.root));
  parts.push("skill", "install");
  if (scope === "project") parts.push("--project");
  if (opts.force) parts.push("--force");
  if (opts.allow) parts.push("--allow");
  return parts.join(" ");
}

/**
 * `tracker check`: compares the version line of the installed skills (project and user scope)
 * with the CLI version. A skill that is not installed gives no issue (`init --skill none` is
 * a valid choice). A missing or older version line gives a warning.
 */
export function checkSkillVersions(opts: { projectRoot: string; homeDir: string; version?: string }): CheckIssue[] {
  const cli = opts.version ?? CLI_VERSION;
  const targets: { scope: SkillScope; file: string }[] = [
    { scope: "project", file: skillFile(opts.projectRoot) },
    { scope: "user", file: skillFile(opts.homeDir) },
  ];
  const issues: CheckIssue[] = [];
  const seen = new Set<string>();
  for (const { scope, file } of targets) {
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const installed = skillVersionOf(readFileSync(file, "utf8"));
    const fix = `Run "${skillInstallCommand(scope)}".`;
    let message: string | null = null;
    if (installed === null) {
      message = `the ${scope} skill has no tracker-skill-version line. ${fix}`;
    } else {
      const cmp = compareVersions(installed, cli);
      if (cmp === null) message = `the ${scope} skill has an invalid version "${installed}". ${fix}`;
      else if (cmp < 0) message = `the ${scope} skill version ${installed} is older than the CLI (${cli}). ${fix}`;
    }
    if (message !== null) issues.push({ kind: "skill_version", severity: "warning", file, message });
  }
  return issues;
}
