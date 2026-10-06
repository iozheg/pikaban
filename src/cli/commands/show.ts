import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { get } from "../../core/index.js";
import { contextOf } from "../context.js";

export function register(program: Command): void {
  program
    .command("show")
    .description("show one task with its body (the full file)")
    .argument("<ref>", "task-0042, 0042, 42 or a ULID")
    .action((ref: string, _opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const task = get(ctx.project({ write: false }), ref);
      ctx.out.result(task, () => readFileSync(task.file, "utf8"));
    });
}
