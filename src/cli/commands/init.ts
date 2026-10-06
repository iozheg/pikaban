import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { Option, type Command } from "commander";
import {
  addGitExcludes,
  addProject,
  CATEGORY_DESCRIPTIONS,
  categoriesWith,
  DEFAULT_OPTIONAL_CATEGORIES,
  excludePattern,
  EXIT_GENERAL,
  EXIT_USAGE,
  findGitRepo,
  initProject,
  OPTIONAL_CATEGORIES,
  prepareInit,
  projectPaths,
  readGlobalConfig,
  TRACKER_DIR,
  TrackerError,
  type GitRepo,
  type OptionalCategory,
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
  /** `--backlog` / `--no-backlog`. Undefined if neither is given. */
  backlog?: boolean;
  /** `--review` / `--no-review`. Undefined if neither is given. */
  review?: boolean;
  /** `--git` (keep the tracker files in git) / `--no-git` (add them to .git/info/exclude). */
  git?: boolean;
  /** `--yes`: the default for each question without a flag, and no confirmation. */
  yes?: boolean;
}

/** The answers to the questions of design 5.1. */
export interface InitAnswers {
  /** The optional categories to turn on. */
  categories: OptionalCategory[];
  skill: SkillChoice;
  allow: boolean;
  /** True: keep the tracker files in git. False: add them to .git/info/exclude. Null: not in a git repository. */
  git: boolean | null;
}

export const INIT_DEFAULTS: Readonly<InitAnswers & { git: boolean }> = {
  categories: [...DEFAULT_OPTIONAL_CATEGORIES],
  skill: "project",
  allow: false,
  git: true,
};

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
  /** The patterns that were added to .git/info/exclude ("no" to the git question). */
  gitExcludes: string[];
}

export const SKILL_QUESTION = "Install the agent skill? project = <project>/.claude/skills/tracker, user = ~/.claude/skills/tracker";
export const ALLOW_QUESTION = `Let the agent run tracker without permission prompts? Adds "${PERMISSION_RULE}" to .claude/settings.json`;
export const CATEGORIES_QUESTION = "Optional categories (todo, in_progress and done are always on):";
export const GIT_QUESTION = "Keep the tracker files in git? no = add them to .git/info/exclude";
export const CONFIRM_QUESTION = "Write these changes?";

/** The list of the optional categories and the question. Empty gives the default. */
async function askCategories(ask: Ask, def: readonly OptionalCategory[]): Promise<OptionalCategory[]> {
  const width = Math.max(...OPTIONAL_CATEGORIES.map((c) => c.length));
  const items = OPTIONAL_CATEGORIES.map(
    (c) => `  [${def.includes(c) ? "x" : " "}] ${c.padEnd(width)}  ${CATEGORY_DESCRIPTIONS[c]}`,
  );
  const shown = def.length === 0 ? "none" : def.join(",");
  const question = `${CATEGORIES_QUESTION}\n${items.join("\n")}\nCategories to turn on (${OPTIONAL_CATEGORIES.join(",")} or none) [${shown}]: `;
  for (let i = 0; i < 3; i++) {
    const a = (await ask(question)).trim().toLowerCase();
    if (a === "") return [...def];
    if (a === "none") return [];
    const picked = parseCategoryList(a);
    if (picked !== null) return picked;
  }
  throw new TrackerError(EXIT_USAGE, `no valid answer. Use ${OPTIONAL_CATEGORIES.join(", ")} (separated by commas) or none.`);
}

/** `backlog,review`, `b r` and the like, in board order. Null for an unknown name. */
function parseCategoryList(answer: string): OptionalCategory[] | null {
  const picked = new Set<OptionalCategory>();
  for (const word of answer.split(/[\s,]+/).filter((w) => w !== "")) {
    const match = OPTIONAL_CATEGORIES.filter((c) => c.startsWith(word));
    if (match.length !== 1) return null;
    picked.add(match[0]!);
  }
  return OPTIONAL_CATEGORIES.filter((c) => picked.has(c));
}

/** The optional categories from `--backlog` / `--review` (each flag without a value keeps the default). */
function categoriesFromFlags(opts: InitCommandOptions): OptionalCategory[] {
  const on = (c: OptionalCategory, flag: boolean | undefined) => flag ?? INIT_DEFAULTS.categories.includes(c);
  return OPTIONAL_CATEGORIES.filter((c) => on(c, c === "backlog" ? opts.backlog : opts.review));
}

/**
 * Resolves the answers from the flags, `--yes` or questions (plan step 9, steps 2 and 3).
 * Without a TTY, a missing answer (no flag, no `--yes`) gives code 2 with the missing flags.
 */
export async function resolveInitAnswers(
  opts: InitCommandOptions,
  io: { interactive: boolean; ask?: Ask; gitRepo?: boolean },
): Promise<InitAnswers> {
  if (opts.skill !== undefined && !(SKILL_CHOICES as readonly string[]).includes(opts.skill)) {
    throw new TrackerError(EXIT_USAGE, `invalid --skill "${opts.skill}". Use ${SKILL_CHOICES.join(", ")}.`);
  }
  let skill = opts.skill as SkillChoice | undefined;
  let allow = opts.allow;
  // Categories and git have safe defaults: without a terminal, a missing flag gives the default.
  const askable = io.interactive && io.ask !== undefined && !opts.yes;
  const categories =
    askable && opts.backlog === undefined && opts.review === undefined
      ? await askCategories(io.ask!, INIT_DEFAULTS.categories)
      : categoriesFromFlags(opts);
  if (opts.yes) {
    skill ??= INIT_DEFAULTS.skill;
    allow ??= INIT_DEFAULTS.allow;
  }
  const gitAnswer = async (): Promise<boolean | null> => {
    if (!io.gitRepo) return null;
    if (opts.git !== undefined) return opts.git;
    return askable ? askYesNo(io.ask!, GIT_QUESTION, INIT_DEFAULTS.git) : INIT_DEFAULTS.git;
  };
  if (skill !== undefined && allow !== undefined) return { categories, skill, allow, git: await gitAnswer() };

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
  return { categories, skill, allow, git: await gitAnswer() };
}

interface Preflight {
  /** The config with the default categories. The answers change the categories. */
  config: ProjectConfig;
  /** True if the project is already in the global config. */
  listed: boolean;
  /** The git repository of the project folder, or null. */
  repo: GitRepo | null;
}

/** The checks before the questions (codes 1, 3, 7). Writes nothing. */
function preflight(root: string, opts: InitCommandOptions, homeDir: string): Preflight {
  const config = prepareInit(root, { name: opts.name, id: opts.id });
  const listed = readGlobalConfig(homeDir).projects.includes(projectPaths(root).root); // code 7
  return { config, listed, repo: findGitRepo(projectPaths(root).root) };
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
 * search up). It never runs git: for "no" to the git question it writes .git/info/exclude.
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
  { config: defaults, listed, repo }: Preflight,
  interactive: boolean,
  ask: Ask | undefined,
): Promise<InitRunResult> {
  const paths = projectPaths(ctx.startDir);
  const root = paths.root;

  // 2-3. Answers.
  const answers = await resolveInitAnswers(opts, { interactive, ask, gitRepo: repo !== null });
  const config: ProjectConfig = { ...defaults, categories: categoriesWith(answers.categories) };

  // Find what each step will do. A skill conflict or invalid settings JSON stops here (no writes).
  const skillScope = answers.skill === "none" ? null : answers.skill;
  const skillBase = answers.skill === "user" ? ctx.homeDir : root;
  const skillText = skillScope ? packagedSkill() : "";
  const skillPlan = skillScope ? planSkillInstall(skillFile(skillBase), skillText) : null;
  if (skillPlan?.status === "conflict") {
    throw skillConflictError(skillPlan, `${skillInstallCommand(skillScope!, { force: true, root })}\nOr run tracker init with --skill none.`);
  }
  // The permission rule always goes into <project>/.claude/settings.json.
  const settings = settingsFile(root);
  const rulePresent = answers.allow ? hasPermissionRule(readSettings(settings)) : false; // code 7
  // "no" to git: .tracker/ and the project skill folder go into .git/info/exclude.
  const excludes =
    repo && answers.git === false
      ? [paths.trackerDir, ...(skillScope === "project" ? [dirname(skillFile(root))] : [])].map((p) => excludePattern(repo, p))
      : [];

  // 4. Summary and confirmation.
  const show = (file: string): string => {
    const rel = relative(root, file);
    return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? file : rel;
  };
  if (!ctx.json) {
    const lines = [`tracker init will make these changes in ${root}:`];
    lines.push(
      `  - make ${TRACKER_DIR}/ with config.json (project_id: ${config.project_id}, project_name: ${config.project_name}) and tasks/`,
      `  - categories: ${config.categories.join(", ")}`,
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
    if (!repo) lines.push("  - not in a git repository: no git changes");
    else if (answers.git) lines.push("  - keep the tracker files in git (git is not run: commit them yourself)");
    else lines.push(`  - add ${excludes.join(", ")} to ${show(repo.excludeFile)}`);
    process.stdout.write(`${lines.join("\n")}\n`);
  }
  if (interactive && ask && !opts.yes && !(await askYesNo(ask, CONFIRM_QUESTION, false))) {
    throw new TrackerError(EXIT_GENERAL, "cancelled. Nothing was written.");
  }

  // 5-7. The writes.
  const done: {
    registered: boolean;
    skill: SkillInstallResult | null;
    permission: PermissionResult | null;
    gitExcludes: string[];
  } = { registered: false, skill: null, permission: null, gitExcludes: [] };
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
  if (repo && excludes.length > 0) {
    steps.push({
      done: "added the git exclude patterns",
      fix: `add ${excludes.join(" and ")} to ${repo.excludeFile}`,
      run: () => {
        done.gitExcludes = addGitExcludes(repo, excludes);
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
  const { registered, skill, permission, gitExcludes } = done;
  const result: InitRunResult = {
    project: { root, config, configFile: paths.configFile },
    registered,
    answers,
    skill,
    permission,
    gitExcludes,
  };
  ctx.out.result(result, () => {
    const lines = [
      `Initialized ${paths.trackerDir}`,
      `project_id: ${config.project_id}, project_name: ${config.project_name}`,
      `categories: ${config.categories.join(", ")}`,
      registered ? "Added the project to the global config." : "The project is already in the global config.",
      skill ? describeSkillResult(skill, show) : "No agent skill installed (--skill none).",
    ];
    if (permission) lines.push(describePermissionResult(permission, show));
    if (repo && answers.git === false) {
      lines.push(
        gitExcludes.length > 0
          ? `Added ${gitExcludes.join(", ")} to ${show(repo.excludeFile)}.`
          : `The tracker files are already in ${show(repo.excludeFile)}.`,
      );
    }
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
        "and the permission rule. Without a terminal, give --skill and --allow/--no-allow, or --yes " +
        "(the categories and git questions use their defaults)",
    )
    .option("--name <name>", "project name (default: the folder name)")
    .option("--id <id>", "project id (default: from the folder name)")
    .addOption(
      new Option("--skill <where>", "install the agent skill: project, user (~/.claude) or none").choices([...SKILL_CHOICES]),
    )
    .option("--allow", `add "${PERMISSION_RULE}" to <project>/.claude/settings.json`)
    .option("--no-allow", "do not add the permission rule")
    .option("--backlog", "add the backlog category (default)")
    .option("--no-backlog", "no backlog category")
    .option("--review", "add the review category: the agent's finished tasks wait for your check")
    .option("--no-review", "no review category (default)")
    .option("--git", "keep the tracker files in git (default; git is not run)")
    .option("--no-git", "add .tracker/ (and the project skill) to .git/info/exclude")
    .option(
      "--yes",
      "use the default for each question without a flag (--backlog, --no-review, --skill project, --no-allow, --git); no confirmation",
    )
    .action(async (opts: InitCommandOptions, cmd: Command) => {
      await runInit(contextOf(cmd), opts);
    });
}
