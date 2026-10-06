import pkg from "../../package.json" with { type: "json" };

/** The version of this CLI package. The skill version line gets this value. */
export const CLI_VERSION: string = pkg.version;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface Parsed {
  core: [number, number, number];
  pre: string[];
}

function parse(v: string): Parsed | null {
  const m = SEMVER.exec(v.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

export function isVersion(v: string): boolean {
  return parse(v) !== null;
}

/**
 * Compares two semantic versions numerically (1.10.0 > 1.9.0). A pre-release is lower than its
 * release (1.0.0-beta < 1.0.0). Returns -1, 0 or 1, or null if a value is not a version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i]! !== pb.core[i]!) return pa.core[i]! < pb.core[i]! ? -1 : 1;
  }
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    if (pa.pre.length === pb.pre.length) return 0;
    return pa.pre.length === 0 ? 1 : -1;
  }
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1; // numeric identifiers are lower
    return x < y ? -1 : 1;
  }
  return 0;
}
