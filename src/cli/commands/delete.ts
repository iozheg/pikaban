import type { Command } from "commander";
import { get, remove } from "../../core/index.js";
import { contextOf } from "../context.js";

export function register(program: Command): void {
  program
    .command("delete")
    .description("delete the task file")
    .argument("<ref>", "task-0042, 0042, 42 or a ULID")
    .action((ref: string, _opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const p = ctx.project({ write: true });
      const task = get(p, ref);
      // The ULID and the hash make sure that we delete the file that we read.
      remove(p, task.id, { ifMatch: task.etag });
      ctx.out.result({ deleted: task }, `${task.short} deleted`);
    });
}
