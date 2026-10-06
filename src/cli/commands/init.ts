import { existsSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { Option, type Command } from "commander";
import {
  addProject,
  EXIT_GENERAL,
  EXIT_USAGE,
  initProject,
  prepareInit,
  projectPaths,
  readGlobalConfig,
  TRACKER_DIR,
  TrackerError,
  type ProjectConfig,
} from "../../core/index.js";
import {
  installSkill,
  packagedSkill,
  planSkillInstall,
  settingsFile,
  SKILL_CHOICES,
  skillFile,
  skillInstallCommand,
  type SkillChoice,
  type SkillInstallResult,
} from "../../skill/install.js";
import {
  addPermissionRule,
  hasPermissionRule,
  PERMISSION_RULE,
  readSettings,
  type PermissionResult,
} from "../../skill/settings.js";
import { contextOf, type Context } from "../context.js";
import { askChoice, askYesNo, isInteractive, withTerminal, type Ask } from "../prompt.js";
import { describePermissionResult, describeSkillResult, skillConflictError } from "./skill.js";

/** Options of `tracker init`. */
export interface InitCommandOptions {
  name?: string;
  id?: string;
  /** `--skill <project|user|none>`. */
  skill?: string;
  /** `--allow` (true) or `--no-allow` (false). Undefined if neither is given. */
  allow?: boolean;
  /** `--yes`: the default for each question without a flag, and no confirmation. */
  yes?: boolean;
}

/** The answers to the questions of design 5.1 (without the deferred git question). */
export interface InitAnswers {
  skill: SkillChoice;
  allow: boolean;
}

export const INIT_DEFAULTS: InitAnswers = { skill: "project", allow: false };

export interface InitDeps {
  /** Default: stdin and stdout are a TTY, and not `--json`. */
  interactive?: boolean;
  /** The question function. Default: the terminal (`node:readline/promises`). */
  ask?: Ask;
}

export interface InitRunResult {
  project: { root: string; config: ProjectConfig; configFile: string };
  /** False if the project was already in the global config. */
  registered: boolean;
  answers: InitAnswers;
  skill: SkillInstallResult | null;
  permission: PermissionResult | null;
}

export const SKILL_QUESTION = "Install the agent skill? project = <project>/.claude/skills/tracker, user = ~/.claude/skills/tracker";
export const ALLOW_QUESTION = `Let the agent run tracker without permission prompts? Adds "${PERMISSION_RULE}" to .claude/settings.json`;
export const CONFIRM_QUESTION = "Write these changes?";

/**
 * Resolves the answers from the flags, `--yes` or questions (plan step 9, steps 2 and 3).
 * Without a TTY, a missing answer (no flag, no `--yes`) gives code 2 with the missing flags.
 */
export async function resolveInitAnswers(
  opts: InitCommandOptions,
  io: { interactive: boolean; ask?: Ask },
): Promise<InitAnswers> {
  if (opts.skill !== undefined && !(SKILL_CHOICES as readonly string[]).includes(opts.skill)) {
    throw new TrackerError(EXIT_USAGE, `invalid --skill "${opts.skill}". Use ${SKILL_CHOICES.join(", ")}.`);
  }
  let skill = opts.skill as SkillChoice | undefined;
  let allow = opts.allow;
  if (opts.yes) {
    skill ??= INIT_DEFAULTS.skill;
    allow ??= INIT_DEFAULTS.allow;
  }
  if (skill !== undefined && allow !== undefined) return { skill, allow };

  if (!io.interactive || io.ask === undefined) {
    const missing: string[] = [];
    if (skill === undefined) missing.push("--skill <project|user|none>");
    if (allow === undefined) missing.push("--allow or --no-allow");
    throw new TrackerError(
      EXIT_USAGE,
      `missing answers: ${missing.join(", ")}. Without a terminal, tracker init does not ask questions. ` +
        "Give the flags, or --yes for the defaults (--skill project, --no-allow). Nothing was written.",
    );
  }
  skill ??= await askChoice(io.ask, SKILL_QUESTION, SKILL_CHOICES, INIT_DEFAULTS.skill);
  allow ??= await askYesNo(io.ask, ALLOW_QUESTION, INIT_DEFAULTS.allow);
  return { skill, allow };
}

interface Preflight {
  config: ProjectConfig;
  /** True if the project is already in the global config. */
  listed: boolean;
}

/** The checks before the questions (codes 1, 3, 7). Writes nothing. */
function preflight(root: string, opts: InitCommandOptions, homeDir: string): Preflight {
  const config = prepareInit(root, { name: opts.name, id: opts.id });
  const listed = readGlobalConfig(homeDir).projects.includes(projectPaths(root).root); // code 7
  return { config, listed };
}

interface Step {
  /** What the step did, for the summary of a partial run. */
  done: string;
  /** A command or an instruction that does the step later. */
  fix: string;
  run(): void;
}

/**
 * The init sequence (plan step 9). The project folder is `-C <path>` or the current folder (no
 * search up). It never asks about git and never runs git (the git question is deferred).
 */
export async function runInit(ctx: Context, opts: InitCommandOptions, deps: InitDeps = {}): Promise<InitRunResult> {
  const interactive = deps.interactive ?? (!ctx.json && isInteractive());
  // 1. Checks, before the terminal opens, so that a quick error does not wait for input.
  const pre = preflight(ctx.startDir, opts, ctx.homeDir);
  if (!interactive || deps.ask !== undefined) return initSequence(ctx, opts, pre, interactive, deps.ask);
  return withTerminal((ask) => initSequence(ctx, opts, pre, true, ask));
}

async function initSequence(
  ctx: Context,
  opts: InitCommandOptions,
  { config, listed }: Preflight,
  interactive: boolean,
  ask: Ask | undefined,
): Promise<InitRunResult> {
  const paths = projectPaths(ctx.startDir);
  const root = paths.root;

  // 2-3. Answers.
  const answers = await resolveInitAnswers(opts, { interactive, ask });

  // Find what each step will do. A skill conflict or invalid settings JSON stops here (no writes).
  const skillScope = answers.skill === "none" ? null : answers.skill;
  const skillBase = answers.skill === "user" ? ctx.homeDir : root;
  const skillText = skillScope ? packagedSkill() : "";
  const skillPlan = skillScope ? planSkillInstall(skillFile(skillBase), skillText) : null;
  if (skillPlan?.status === "conflict") {
    throw skillConflictError(skillPlan, `${skillInstallCommand(skillScope!, { force: true, root })}\nOr run tracker init with --skill none.`);
  }
  // The permission rule always goes into <project>/.claude/settings.json (git question deferred).
  const settings = settingsFile(root);
  const rulePresent = answers.allow ? hasPermissionRule(readSettings(settings)) : false; // code 7

  // 4. Summary and confirmation.
  const show = (file: string): string => {
    const rel = relative(root, file);
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? file : rel;
  };
  if (!ctx.json) {
    const lines = [`tracker init will make these changes in ${root}:`];
    lines.push(
      `  - make ${TRACKER_DIR}/ with config.json (project_id: ${config.project_id}, project_name: ${config.project_name}) and tasks/`,
    );
    lines.push(listed ? "  - the project is already in the global config" : `  - add the project to ${ctx.homeDir}/.tracker_config.json`);
    if (!skillPlan) lines.push("  - no agent skill (--skill none)");
    else if (skillPlan.status === "unchanged") lines.push(`  - the ${skillScope} skill is already current: ${show(skillPlan.file)}`);
    else if (skillPlan.status === "updated") {
      lines.push(`  - update the ${skillScope} skill from version ${skillPlan.previousVersion} to ${skillPlan.version}: ${show(skillPlan.file)}`);
    } else lines.push(`  - install the ${skillScope} skill (version ${skillPlan.version}): ${show(skillPlan.file)}`);
    if (!answers.allow) lines.push("  - no permission rule (--no-allow)");
    else if (rulePresent) lines.push(`  - the permission rule "${PERMISSION_RULE}" is already in ${show(settings)}`);
    else lines.push(`  - add the permission rule "${PERMISSION_RULE}" to ${show(settings)}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  if (interactive && ask && !opts.yes && !(await askYesNo(ask, CONFIRM_QUESTION, false))) {
    throw new TrackerError(EXIT_GENERAL, "cancelled. Nothing was written.");
  }

  // 5-7. The writes.
  const done: { registered: boolean; skill: SkillInstallResult | null; permission: PermissionResult | null } = {
    registered: false,
    skill: null,
    permission: null,
  };
  const steps: Step[] = [
    {
      done: `made ${paths.trackerDir}`,
      fix: `the ${TRACKER_DIR}/ folder is not complete. Remove ${paths.trackerDir}, then run tracker init again`,
      run: () => {
        initProject(root, config);
      },
    },
    {
      done: "added the project to the global config",
      fix: `tracker projects add ${JSON.stringify(root)}`,
      run: () => {
        done.registered = addProject(root, ctx.homeDir);
      },
    },
  ];
  // With a project skill, `skill install --project --allow` does both remaining steps.
  const allowWithSkill = answers.allow && skillScope === "project";
  if (skillScope) {
    steps.push({
      done: `installed the ${skillScope} skill`,
      fix: skillInstallCommand(skillScope, { root: skillScope === "project" ? root : undefined, allow: allowWithSkill }),
      run: () => {
        done.skill = installSkill(skillFile(skillBase), skillText);
        if (done.skill.status === "conflict") throw skillConflictError(done.skill, skillInstallCommand(skillScope, { force: true, root }));
      },
    });
  }
  if (answers.allow) {
    steps.push({
      done: "added the permission rule",
      fix: allowWithSkill ? "" : `add "${PERMISSION_RULE}" to permissions.allow in ${settings}`,
      run: () => {
        done.permission = addPermissionRule(settings);
      },
    });
  }
  for (const [i, step] of steps.entries()) {
    try {
      step.run();
    } catch (err) {
      // Nothing was written yet: the original error.
      if (i === 0 && !existsSync(paths.trackerDir)) throw err;
      throw partialError(err, steps.slice(0, i), steps.slice(i));
    }
  }

  // 8. Report.
  const { registered, skill, permission } = done;
  const result: InitRunResult = {
    project: { root, config, configFile: paths.configFile },
    registered,
    answers,
    skill,
    permission,
  };
  ctx.out.result(result, () => {
    const lines = [
      `Initialized ${paths.trackerDir}`,
      `project_id: ${config.project_id}, project_name: ${config.project_name}`,
      registered ? "Added the project to the global config." : "The project is already in the global config.",
      skill ? describeSkillResult(skill, show) : "No agent skill installed (--skill none).",
    ];
    if (permission) lines.push(describePermissionResult(permission, show));
    lines.push('Next: tracker add "<title>"');
    return lines.join("\n");
  });
  return result;
}

/** A step after the start failed. `.tracker/` stays. The message tells what is done and what to run. */
function partialError(err: unknown, done: Step[], notDone: Step[]): TrackerError {
  const message = err instanceof Error ? err.message : String(err);
  const fixes = notDone.map((s) => s.fix).filter((f) => f !== "");
  const lines = [`tracker init stopped: ${message}`];
  if (done.length > 0) lines.push(`Done: ${done.map((s) => s.done).join(", ")}.`);
  lines.push("Not done. Correct the problem, then run:", ...fixes.map((f) => `  ${f}`));
  return new TrackerError(err instanceof TrackerError ? err.code : EXIT_GENERAL, lines.join("\n"), { cause: err });
}

export function register(program: Command): void {
  program
    .command("init")
    .description(
      "make .tracker/ and config.json in the project folder (-C or the current folder), install the skill " +
        "and the permission rule. Without a terminal, give --skill and --allow/--no-allow, or --yes",
    )
    .option("--name <name>", "project name (default: the folder name)")
    .option("--id <id>", "project id (default: from the folder name)")
    .addOption(
      new Option("--skill <where>", "install the agent skill: project, user (~/.claude) or none").choices([...SKILL_CHOICES]),
    )
    .option("--allow", `add "${PERMISSION_RULE}" to <project>/.claude/settings.json`)
    .option("--no-allow", "do not add the permission rule")
    .option("--yes", "use the default for each question without a flag (--skill project, --no-allow); no confirmation")
    .action(async (opts: InitCommandOptions, cmd: Command) => {
      await runInit(contextOf(cmd), opts);
    });
}
