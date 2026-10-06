import type { Command } from "commander";
import { create } from "../../core/index.js";
import { contextOf, textOrFile } from "../context.js";
import { taskLine } from "../output.js";

export function register(program: Command): void {
  program
    .command("add")
    .description("make a new task")
    .argument("<title>", "task title")
    .option("--body <text>", "body text")
    .option("--body-file <path>", "read the body from a file (- for stdin)")
    .option("--category <c>", "category (default: the first category)")
    .action((title: string, opts: { body?: string; bodyFile?: string; category?: string }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const body = textOrFile(opts.body, opts.bodyFile, { text: "--body", file: "--body-file" });
      const task = create(ctx.project({ write: true }), { title, body, category: opts.category });
      ctx.out.result(task, `${taskLine(task)}  (added to ${task.category})`);
    });
}
