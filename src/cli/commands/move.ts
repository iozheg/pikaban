import type { Command } from "commander";
import { update, type TaskPatch } from "../../core/index.js";
import { contextOf, parseAssignee } from "../context.js";

export function register(program: Command): void {
  program
    .command("move")
    .description("change the category (and the assignee) in one write")
    .argument("<ref>", "task-0042, 0042, 42 or a ULID")
    .argument("<category>", "new category")
    .option("--assignee <a>", "agent, user or none")
    .action((ref: string, category: string, opts: { assignee?: string }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const patch: TaskPatch = { category };
      if (opts.assignee !== undefined) patch.assignee = parseAssignee(opts.assignee);
      const task = update(ctx.project({ write: true }), ref, patch);
      const who = patch.assignee !== undefined ? `, assignee ${task.assignee ?? "none"}` : "";
      ctx.out.result(task, `${task.short} moved to ${task.category}${who}`);
    });
}
