/** Above this size (old lines x new lines) the diff does not search for common lines. */
const MAX_CELLS = 4_000_000;

type Op = { t: " " | "-" | "+"; line: string };

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** The edit script from `a` to `b` (longest common subsequence of lines). */
function ops(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return [...a.map((line) => ({ t: "-" as const, line })), ...b.map((line) => ({ t: "+" as const, line }))];
  // lcs[i][j]: length of the LCS of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: " ", line: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ t: "-", line: a[i++]! });
    } else {
      out.push({ t: "+", line: b[j++]! });
    }
  }
  while (i < n) out.push({ t: "-", line: a[i++]! });
  while (j < m) out.push({ t: "+", line: b[j++]! });
  return out;
}

/**
 * A unified line diff from `oldText` to `newText`, with `context` lines around each change.
 * Returns "" if the texts have the same lines.
 */
export function lineDiff(
  oldText: string,
  newText: string,
  labels: { old: string; new: string },
  context = 3,
): string {
  const all = ops(splitLines(oldText), splitLines(newText));
  const changed = all.flatMap((o, k) => (o.t === " " ? [] : [k]));
  if (changed.length === 0) return "";

  // Group the changes into hunks: two changes with less than 2 * context same lines between them
  // go into one hunk.
  const hunks: [number, number][] = [];
  for (const k of changed) {
    const last = hunks[hunks.length - 1];
    if (last && k - last[1] <= 2 * context + 1) last[1] = k;
    else hunks.push([k, k]);
  }

  const lines = [`--- ${labels.old}`, `+++ ${labels.new}`];
  for (const [first, lastChange] of hunks) {
    const start = Math.max(0, first - context);
    const end = Math.min(all.length, lastChange + context + 1);
    const before = all.slice(0, start);
    const body = all.slice(start, end);
    const oldStart = before.filter((o) => o.t !== "+").length + 1;
    const newStart = before.filter((o) => o.t !== "-").length + 1;
    const oldCount = body.filter((o) => o.t !== "+").length;
    const newCount = body.filter((o) => o.t !== "-").length;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const o of body) lines.push(`${o.t}${o.line}`);
  }
  return `${lines.join("\n")}\n`;
}
