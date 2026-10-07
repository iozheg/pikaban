import { CommanderError } from "commander";
import { EXIT_GENERAL, EXIT_USAGE, PikabanError, type Task } from "../core/index.js";

/**
 * Output for one command run.
 * - `--json`: stdout gets only JSON. Errors go to stderr as `{"error":{"code":N,"message":"..."}}`.
 * - Human mode: short text on stdout, warnings and errors on stderr.
 */
export class Output {
  constructor(readonly json: boolean) {}

  /** Writes `data` as JSON in `--json` mode, otherwise the human text (a string or a function that makes it). */
  result(data: unknown, human: string | (() => string)): void {
    if (this.json) {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    const text = typeof human === "function" ? human() : human;
    if (text !== "") process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  /** A warning on stderr. Not shown in `--json` mode: the JSON result contains the data. */
  warn(message: string): void {
    if (!this.json) process.stderr.write(`warning: ${message}\n`);
  }

  /** Writes the error and sets `process.exitCode`. */
  error(err: unknown): void {
    const { code, message, printed } = describeError(err);
    process.exitCode = code;
    if (code === 0) return;
    if (this.json) {
      process.stderr.write(`${JSON.stringify({ error: { code, message } })}\n`);
    } else if (!printed) {
      process.stderr.write(`error: ${message}\n`);
    }
  }
}

/** Exit code and message: PikabanError gives its code, commander usage errors 2, other errors 1. */
function describeError(err: unknown): { code: number; message: string; printed: boolean } {
  if (err instanceof PikabanError) return { code: err.code, message: err.message, printed: false };
  if (err instanceof CommanderError) {
    // Help and version give exit code 0. Commander already wrote its own text in human mode.
    const code = err.exitCode === 0 ? 0 : EXIT_USAGE;
    return { code, message: err.message.replace(/^error: /, ""), printed: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: EXIT_GENERAL, message, printed: false };
}

/** `task-0042  Title` */
export function taskLine(t: Pick<Task, "short" | "title">): string {
  return `${t.short}  ${t.title}`;
}

/** An aligned table for `list`: short, category, assignee, needs_input flag, title. */
export function taskTable(tasks: readonly Task[]): string {
  if (tasks.length === 0) return "No tasks.";
  const rows = [
    ["SHORT", "CATEGORY", "ASSIGNEE", "INPUT", "TITLE"],
    ...tasks.map((t) => [t.short, t.category, t.assignee ?? "-", t.needs_input ? "yes" : "-", t.title]),
  ];
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows
    .map((r) =>
      r
        .map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!)))
        .join("  "),
    )
    .join("\n");
}
