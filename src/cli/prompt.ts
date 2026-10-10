import { createInterface, emitKeypressEvents } from "node:readline";
import { EXIT_GENERAL, EXIT_USAGE, PikabanError } from "../core/index.js";

/** Asks one question and gives the answer text. Tests give their own function. */
export type Ask = (question: string) => Promise<string>;

/** One line of a multi-select list. */
export interface SelectItem<T extends string> {
  value: T;
  label: string;
  /** Extra text after the label, dimmed. */
  note?: string;
}

/** Asks for a set of items: a checkbox list (arrows, space, enter). Gives the selected values in list order. */
export type Select = <T extends string>(
  question: string,
  items: readonly SelectItem<T>[],
  selected: readonly T[],
  note?: string,
) => Promise<T[]>;

/** The terminal questions: text answers, and a checkbox list. */
export interface Terminal {
  ask: Ask;
  select: Select;
}

/** True only if stdin and stdout are both a TTY. Without a TTY, the CLI never asks. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Dims extra information (explanations in the questions). Plain text without a color terminal or with NO_COLOR. */
export function dim(text: string): string {
  return process.stdout.isTTY && !process.env.NO_COLOR ? `\x1b[2m${text}\x1b[22m` : text;
}

const MAX_TRIES = 3;

const cancelledError = (): PikabanError => new PikabanError(EXIT_GENERAL, "cancelled. Nothing was written.");

/**
 * Runs `fn` with questions on the terminal. Each text question has its own `node:readline` interface,
 * so that a checkbox list can read the keys between them.
 * Ctrl+C or the end of the input stops with code 1: the questions come before all writes.
 */
export async function withTerminal<T>(fn: (term: Terminal) => Promise<T>): Promise<T> {
  const ask: Ask = (question) =>
    new Promise((resolve, reject) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let answered = false;
      rl.on("SIGINT", () => rl.close());
      rl.once("close", () => {
        if (answered) return;
        process.stdout.write("\n"); // the error message starts on a new line
        reject(cancelledError());
      });
      rl.question(question, (answer) => {
        answered = true;
        rl.close();
        resolve(answer);
      });
    });
  return fn({ ask, select: terminalSelect });
}

/** Asks until the answer is one of `choices` (or the first letter of one). Empty gives `def`. */
export async function askChoice<T extends string>(
  ask: Ask,
  question: string,
  choices: readonly T[],
  def: T,
  note?: string,
): Promise<T> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = (await ask(`${withNote(question, note)} (${choices.join("/")}) [${def}]: `)).trim().toLowerCase();
    if (a === "") return def;
    const exact = choices.find((c) => c === a);
    if (exact !== undefined) return exact;
    const prefix = choices.filter((c) => c.startsWith(a));
    if (prefix.length === 1) return prefix[0]!;
  }
  throw new PikabanError(EXIT_USAGE, `no valid answer. Use one of: ${choices.join(", ")}.`);
}

/** Asks a yes/no question. Empty gives `def`. */
export async function askYesNo(ask: Ask, question: string, def: boolean, note?: string): Promise<boolean> {
  for (let i = 0; i < MAX_TRIES; i++) {
    const a = (await ask(`${withNote(question, note)} [${def ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (a === "") return def;
    if (a === "y" || a === "yes") return true;
    if (a === "n" || a === "no") return false;
  }
  throw new PikabanError(EXIT_USAGE, "no valid answer. Use yes or no.");
}

function withNote(question: string, note: string | undefined): string {
  return note === undefined ? question : `${question} ${dim(note)}`;
}

/** The cursor line and the checked items of a checkbox list. */
export interface SelectState {
  cursor: number;
  on: boolean[];
}

/** A key from `emitKeypressEvents`. */
export interface Key {
  name?: string;
  ctrl?: boolean;
}

/** The next state of a checkbox list after a key: arrows (or j/k) move, space toggles, enter ends, Ctrl+C and Esc cancel. */
export function selectStep(state: SelectState, key: Key): SelectState | "done" | "cancel" {
  const n = state.on.length;
  if (key.ctrl && (key.name === "c" || key.name === "d")) return "cancel";
  switch (key.name) {
    case "escape":
      return "cancel";
    case "return":
    case "enter":
      return "done";
    case "up":
    case "k":
      return { ...state, cursor: (state.cursor - 1 + n) % n };
    case "down":
    case "j":
      return { ...state, cursor: (state.cursor + 1) % n };
    case "space":
      return { ...state, on: state.on.map((v, i) => (i === state.cursor ? !v : v)) };
    default:
      return state;
  }
}

/** The lines of a checkbox list. */
export function renderSelect(
  question: string,
  items: readonly SelectItem<string>[],
  state: SelectState,
  note?: string,
): string[] {
  const width = Math.max(...items.map((it) => it.label.length));
  const lines = items.map((it, i) => {
    const line = `${i === state.cursor ? ">" : " "} [${state.on[i] ? "x" : " "}] ${it.label.padEnd(width)}`;
    return it.note === undefined ? line : `${line}  ${dim(it.note)}`;
  });
  return [withNote(question, note), ...lines, dim("  up/down move, space select, enter confirm")];
}

/** The checkbox list on the terminal (raw mode). After enter, one line with the answer stays. */
const terminalSelect: Select = (question, items, selected, note) =>
  new Promise((resolve, reject) => {
    const { stdin: input, stdout: output } = process;
    let state: SelectState = { cursor: 0, on: items.map((it) => selected.includes(it.value)) };
    let shown = 0;
    const draw = (lines: string[]) => {
      // Back to the first line of the list, clear to the end of the screen, then the new lines.
      output.write(`${shown > 0 ? `\x1b[${shown}A` : ""}\r\x1b[J${lines.map((l) => `${l}\n`).join("")}`);
      shown = lines.length;
    };
    const finish = () => {
      input.off("keypress", onKey);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h"); // show the cursor
    };
    const onKey = (_text: string | undefined, key: Key | undefined) => {
      const next = selectStep(state, key ?? {});
      if (next === "cancel") {
        draw([]);
        finish();
        reject(cancelledError());
      } else if (next === "done") {
        const picked = items.filter((_, i) => state.on[i]).map((it) => it.value);
        draw([`${question}: ${picked.length === 0 ? "none" : picked.join(", ")}`]);
        finish();
        resolve(picked);
      } else {
        state = next;
        draw(renderSelect(question, items, state, note));
      }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write("\x1b[?25l"); // hide the cursor
    draw(renderSelect(question, items, state, note));
    input.on("keypress", onKey);
  });
