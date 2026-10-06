import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  addProject,
  EXIT_NOT_FOUND,
  listProjects,
  projectPaths,
  removeProject,
  TrackerError,
} from "../../core/index.js";
import { contextOf, type Context } from "../context.js";

/** `<path>` relative to the current folder, or the project found from `-C` / the current folder. */
function targetPath(ctx: Context, path: string | undefined): string {
  return path !== undefined ? resolve(path) : ctx.projectRoot();
}

export function register(program: Command): void {
  const projects = program.command("projects").description("change or show the global project list");

  projects
    .command("add")
    .description("add a project folder (default: the current project)")
    .argument("[path]", "project folder that contains .tracker/")
    .action((path: string | undefined, _opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const target = targetPath(ctx, path);
      if (!existsSync(projectPaths(target).configFile)) {
        throw new TrackerError(EXIT_NOT_FOUND, `no .tracker/config.json in ${target}`);
      }
      const added = addProject(target, ctx.homeDir);
      ctx.out.result({ path: target, added }, added ? `added ${target}` : `${target} is already in the list`);
    });

  projects
    .command("remove")
    .description("remove a project folder from the list (default: the current project)")
    .argument("[path]", "project folder")
    .action((path: string | undefined, _opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const target = targetPath(ctx, path);
      if (!removeProject(target, ctx.homeDir)) {
        throw new TrackerError(EXIT_NOT_FOUND, `${target} is not in the project list`);
      }
      ctx.out.result({ path: target, removed: true }, `removed ${target}`);
    });

  projects
    .command("list")
    .description("show the project folders")
    .action((_opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const list = listProjects(ctx.homeDir);
      ctx.out.result({ projects: list }, list.length === 0 ? "No projects." : list.join("\n"));
    });
}
