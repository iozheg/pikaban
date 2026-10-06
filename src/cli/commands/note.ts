import type { Command } from "commander";
import { appendNote } from "../../core/index.js";
import { contextOf, textOrFile, usageError } from "../context.js";

export function register(program: Command): void {
  program
    .command("note")
    .description("add text to the end of the body")
    .argument("<ref>", "task-0042, 0042, 42 or a ULID")
    .argument("[text]", "the note text")
    .option("--file <path>", "read the note from a file (- for stdin)")
    .action((ref: string, text: string | undefined, opts: { file?: string }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const note = textOrFile(text, opts.file, { text: "<text>", file: "--file" });
      if (note === undefined) throw usageError("give the note <text> or --file <path>");
      const task = appendNote(ctx.project({ write: true }), ref, note);
      ctx.out.result(task, `note added to ${task.short}`);
    });
}
