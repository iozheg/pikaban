import type { Command } from "commander";
import { EXIT_CONFLICT, TrackerError } from "../../core/index.js";
import {
  installSkill,
  packagedSkill,
  planSkillInstall,
  settingsFile,
  skillFile,
  skillInstallCommand,
  type SkillInstallResult,
  type SkillScope,
} from "../../skill/install.js";
import { addPermissionRule, PERMISSION_RULE, readSettings, type PermissionResult } from "../../skill/settings.js";
import { contextOf } from "../context.js";

export interface SkillInstallOptions {
  project?: boolean;
  force?: boolean;
  allow?: boolean;
}

/** One line for a skill install result. */
export function describeSkillResult(r: SkillInstallResult, show: (file: string) => string = (f) => f): string {
  const file = show(r.file);
  switch (r.status) {
    case "installed":
      return `Installed the skill (version ${r.version}): ${file}`;
    case "unchanged":
      return `The skill is already current (version ${r.version}): ${file}`;
    case "updated":
      return `Updated the skill from version ${r.previousVersion} to ${r.version}: ${file}`;
    case "replaced":
      return `Replaced the changed skill file (--force), version ${r.version}: ${file}`;
    case "conflict":
      return `The skill file has local changes and was not replaced: ${file}`;
  }
}

/** One line for a permission rule result. */
export function describePermissionResult(r: PermissionResult, show: (file: string) => string = (f) => f): string {
  const file = show(r.file);
  if (r.status === "present") return `The permission rule "${PERMISSION_RULE}" is already in ${file}`;
  const backup = r.backup ? ` (backup: ${show(r.backup)})` : "";
  return `Added the permission rule "${PERMISSION_RULE}" to ${file}${backup}`;
}

/** The code 5 error for a skill file with local changes. The message contains the diff. */
export function skillConflictError(r: SkillInstallResult, fix: string): TrackerError {
  return new TrackerError(
    EXIT_CONFLICT,
    `${r.file} is different from the skill text of this CLI. Nothing was written.\n` +
      `${r.diff ?? ""}To replace the file, run: ${fix}`,
  );
}

export function register(program: Command): void {
  const skill = program.command("skill").description("install the agent skill for Claude Code");

  skill
    .command("install")
    .description(
      "install the skill into ~/.claude/skills/tracker/ (or the project with --project). " +
        "A changed skill file gives exit code 5 and a diff, unless --force",
    )
    .option("--project", "install into <project>/.claude/skills/tracker/ (the project found from -C or the current folder)")
    .option("--force", "replace a skill file that has local changes")
    .option(
      "--allow",
      `add "${PERMISSION_RULE}" to permissions.allow in ~/.claude/settings.json (or <project>/.claude/settings.json with --project)`,
    )
    .action((opts: SkillInstallOptions, cmd: Command) => {
      const ctx = contextOf(cmd);
      const scope: SkillScope = opts.project ? "project" : "user";
      const base = scope === "project" ? ctx.projectRoot() : ctx.homeDir;
      const file = skillFile(base);
      const text = packagedSkill();
      const settings = settingsFile(base);

      // Check everything before the first write: a conflict or invalid settings JSON writes nothing.
      const plan = planSkillInstall(file, text, { force: opts.force });
      if (plan.status === "conflict") {
        ctx.out.result({ skill: plan, permission: null }, "");
        throw skillConflictError(plan, skillInstallCommand(scope, { force: true, allow: opts.allow }));
      }
      if (opts.allow) readSettings(settings);

      const skillResult = installSkill(file, text, { force: opts.force });
      const permission = opts.allow ? addPermissionRule(settings) : null;
      const lines = [describeSkillResult(skillResult)];
      if (permission) lines.push(describePermissionResult(permission));
      ctx.out.result({ skill: skillResult, permission }, lines.join("\n"));
    });
}
