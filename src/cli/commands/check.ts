import { isAbsolute, relative } from "node:path";
import type { Command } from "commander";
import { check, EXIT_VALIDATION, type CheckIssue, type CheckReport, type Project } from "../../core/index.js";
import { checkSkillVersions } from "../../skill/install.js";
import { contextOf, type Context } from "../context.js";

export type ExtraCheck = (p: Project, ctx: Context) => CheckIssue[];

/** Skill version (plan step 8): the project skill and the user skill, if installed. */
export const skillVersionCheck: ExtraCheck = (p, ctx) =>
  checkSkillVersions({ projectRoot: p.root, homeDir: ctx.homeDir });

/** Checks that `tracker check` runs after the core checks. */
export const EXTRA_CHECKS: ExtraCheck[] = [skillVersionCheck];

/** The path relative to the project, or the absolute path for a file outside the project. */
function displayPath(root: string, file: string): string {
  const rel = relative(root, file);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? file : rel;
}

function formatReport(p: Project, report: CheckReport): string {
  const lines = report.issues.map((i) => {
    const fixed = i.fixed ? " (fixed)" : "";
    return `${i.severity}: ${displayPath(p.root, i.file)}: ${i.message}${fixed}`;
  });
  const errors = report.issues.filter((i) => i.severity === "error" && !i.fixed).length;
  const warnings = report.issues.filter((i) => i.severity === "warning").length;
  const fixed = report.issues.filter((i) => i.fixed).length;
  const parts = [`${errors} error(s)`, `${warnings} warning(s)`];
  if (fixed > 0) parts.push(`${fixed} fixed`);
  lines.push(report.ok ? `OK: ${parts.join(", ")}` : `FAILED: ${parts.join(", ")}`);
  return lines.join("\n");
}

export function register(program: Command, deps: { extraChecks?: readonly ExtraCheck[] } = {}): void {
  program
    .command("check")
    .description("validate the config, all task files and the skill version (exit code 7 on errors)")
    .option("--fix", "give a new short name to the newer task of each duplicate pair")
    .action((opts: { fix?: boolean }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const p = ctx.project({ write: opts.fix ?? false });
      const extraChecks = (deps.extraChecks ?? EXTRA_CHECKS).map((c) => (proj: Project) => c(proj, ctx));
      const report = check(p, { fix: opts.fix ?? false, extraChecks });
      ctx.out.result(report, () => formatReport(p, report));
      if (!report.ok) process.exitCode = EXIT_VALIDATION;
    });
}
