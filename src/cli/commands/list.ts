import { relative } from "node:path";
import type { Command } from "commander";
import { list, type TaskFilter } from "../../core/index.js";
import { contextOf, parseAssignee, usageError } from "../context.js";
import { taskTable } from "../output.js";

export function register(program: Command): void {
  program
    .command("list")
    .description("show tasks")
    .option("--category <c>", "only tasks in this category")
    .option("--assignee <a>", "only tasks with this assignee: agent, user or none")
    .option("--needs-input", "only tasks with needs_input: true")
    .action((opts: { category?: string; assignee?: string; needsInput?: boolean }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const p = ctx.project({ write: false });
      const filter: TaskFilter = {};
      if (opts.category !== undefined) {
        if (!p.config.categories.includes(opts.category)) {
          throw usageError(`unknown category "${opts.category}". Categories: ${p.config.categories.join(", ")}`);
        }
        filter.category = opts.category;
      }
      if (opts.assignee !== undefined) filter.assignee = parseAssignee(opts.assignee);
      if (opts.needsInput) filter.needs_input = true;

      const { tasks, invalid } = list(p, filter);
      for (const f of invalid) ctx.out.warn(`${relative(p.root, f.file)} is not valid: ${f.error}`);
      ctx.out.result({ tasks, invalid }, () => taskTable(tasks));
    });
}
