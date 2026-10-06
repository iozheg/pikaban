import type { Command } from "commander";
import { update, type TaskPatch } from "../../core/index.js";
import { contextOf, parseAssignee, parseBool, usageError } from "../context.js";

export function register(program: Command): void {
  program
    .command("set")
    .description("change frontmatter fields")
    .argument("<ref>", "task-0042, 0042, 42 or a ULID")
    .option("--title <t>", "new title")
    .option("--assignee <a>", "agent, user or none")
    .option("--needs-input <bool>", "true or false")
    .action((ref: string, opts: { title?: string; assignee?: string; needsInput?: string }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const patch: TaskPatch = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.assignee !== undefined) patch.assignee = parseAssignee(opts.assignee);
      if (opts.needsInput !== undefined) patch.needs_input = parseBool(opts.needsInput, "--needs-input");
      if (Object.keys(patch).length === 0) {
        throw usageError("nothing to change. Give --title, --assignee or --needs-input.");
      }
      const task = update(ctx.project({ write: true }), ref, patch);
      ctx.out.result(task, `${task.short} updated: ${Object.keys(patch).join(", ")}`);
    });
}
