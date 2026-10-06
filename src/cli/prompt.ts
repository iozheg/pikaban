import { createInterface } from "node:readline/promises";
import { EXIT_GENERAL, EXIT_USAGE, TrackerError } from "../core/index.js";

/** Asks one question and gives the answer text. Tests give their own function. */
export type Ask = (question: string) => Promise<string>;

/** True only if stdin and stdout are both a TTY. Without a TTY, the CLI never asks. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

const MAX_TRIES = 3;

/**
 * Runs `fn` with an `Ask` on the terminal (`node:readline/promises`). Closes the interface after.
 * Ctrl+C or the end of the input stops with code 1: the questions come before all writes.
 */
export async function withTerminal<T>(fn: (ask: Ask) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  let waiting = false;
  const cancelled = new Promise<never>((_, reject) => {
    rl.once("close", () => {
      closed = true;
      if (waiting) process.stdout.write("\n"); // the error message starts on a new line
      reject(new TrackerError(EXIT_GENERAL, "cancelled. Nothing was written."));
    });
  });
  cancelled.catch(() => {}); // Only an error if a question waits for it.
  rl.on("SIGINT", () => rl.close());
  const ask: Ask = (question) => {
    if (closed) return cancelled;
    waiting = true;
    return Promise.race([rl.question(question), cancelled]).finally(() => {
      waiting = false;
    });
  };
  try {
    return await fn(ask);
  } finally {
    rl.close();
  }
}

/** Asks until the answer is one of `choices` (or the first letter of one). Empty gives `def`. */
export async function askChoice<T extends string>(
  ask: Ask,
  question: string,
  choices: readonly T[],
  def: T,
): Promise<T> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = (await ask(`${question} (${choices.join("/")}) [${def}]: `)).trim().toLowerCase();
    if (a === "") return def;
    const exact = choices.find((c) => c === a);
    if (exact !== undefined) return exact;
    const prefix = choices.filter((c) => c.startsWith(a));
    if (prefix.length === 1) return prefix[0]!;
  }
  throw new TrackerError(EXIT_USAGE, `no valid answer. Use one of: ${choices.join(", ")}.`);
}

/** Asks a yes/no question. Empty gives `def`. */
export async function askYesNo(ask: Ask, question: string, def: boolean): Promise<boolean> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = (await ask(`${question} [${def ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (a === "") return def;
    if (a === "y" || a === "yes") return true;
    if (a === "n" || a === "no") return false;
  }
  throw new TrackerError(EXIT_USAGE, "no valid answer. Use yes or no.");
}
