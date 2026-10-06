import type { Command } from "commander";
import { remove } from "../../core/index.js";
import { contextOf } from "../context.js";

export function register(program: Command): void {
  program
    .command("delete")
    .description("delete the task file")
    .argument("<ref>", "task-0042, 0042, 42 or a ULID")
    .action((ref: string, _opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const task = remove(ctx.project({ write: true }), ref);
      ctx.out.result({ deleted: task }, `${task.short} deleted`);
    });
}
