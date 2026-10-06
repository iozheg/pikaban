import { ulid } from "ulidx";
import { EXIT_AMBIGUOUS, EXIT_GENERAL, EXIT_NOT_FOUND, EXIT_USAGE, TrackerError } from "./errors.js";
import { ULID_RE } from "./schema.js";

export const SHORT_MAX = 9999;

export type TaskRef = { kind: "id"; id: string } | { kind: "short"; short: string };

/** A new ULID, uppercase. */
export function newUlid(): string {
  return ulid().toUpperCase();
}

export function formatShort(n: number): string {
  return `task-${String(n).padStart(4, "0")}`;
}

/** The number of a short name, for example 42 for `task-0042`. */
export function shortNumber(short: string): number {
  return Number(short.slice("task-".length));
}

/**
 * Short name for a new task (design 2.4): the number of the newest live task (highest ULID) plus 1.
 * After 9999, continue at 0001. Skip numbers that live tasks already have.
 */
export function nextShort(liveTasks: readonly { id: string; short: string }[]): string {
  if (liveTasks.length === 0) return formatShort(1);
  let newest = liveTasks[0]!;
  for (const t of liveTasks) if (t.id > newest.id) newest = t;
  const used = new Set(liveTasks.map((t) => shortNumber(t.short)));
  let n = shortNumber(newest.short);
  for (let i = 0; i < SHORT_MAX; i++) {
    n = (n % SHORT_MAX) + 1;
    if (!used.has(n)) return formatShort(n);
  }
  throw new TrackerError(
    EXIT_GENERAL,
    `all ${SHORT_MAX} short names are in use. Delete tasks that you do not need.`,
  );
}

/** Accepts `task-0042`, `0042`, `42` or a 26-character ULID. Other text gives code 2. */
export function parseRef(text: string): TaskRef {
  const s = text.trim();
  if (ULID_RE.test(s.toUpperCase())) return { kind: "id", id: s.toUpperCase() };
  const m = /^(?:task-)?(\d{1,4})$/i.exec(s);
  const n = m ? Number(m[1]) : 0;
  if (n < 1) {
    throw new TrackerError(
      EXIT_USAGE,
      `"${text}" is not a task reference. Use a short name (task-0042, 0042, 42) or a full ULID.`,
    );
  }
  return { kind: "short", short: formatShort(n) };
}

/** `task-XXXX-<ULID>.md` */
export function fileName(short: string, id: string): string {
  return `${short}-${id}.md`;
}

/**
 * Finds the one item for `ref`. Uses the frontmatter values, not the file names.
 * Not found gives code 3. A short name with more than one task gives code 4.
 */
export function resolveRef<T extends { id: string; short: string }>(
  items: readonly T[],
  ref: string,
  notFoundHint = "",
): T {
  const r = parseRef(ref);
  const found = r.kind === "id" ? items.filter((t) => t.id === r.id) : items.filter((t) => t.short === r.short);
  if (found.length === 1) return found[0]!;
  const what = r.kind === "id" ? r.id : r.short;
  if (found.length === 0) throw new TrackerError(EXIT_NOT_FOUND, `task not found: ${what}${notFoundHint}`);
  const ids = found.map((t) => t.id).sort();
  throw new TrackerError(
    EXIT_AMBIGUOUS,
    `${what} has more than one task: ${ids.join(", ")}. Use the full ULID, or run "tracker check --fix".`,
  );
}
