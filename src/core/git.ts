import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { atomicWrite } from "./fs.js";

export interface GitRepo {
  /** The work tree folder (the folder with `.git`). */
  root: string;
  /** `info/exclude` of the repository (in the common git folder for a linked worktree). */
  excludeFile: string;
}

/**
 * Searches up from `dir` for `.git` (a folder, or a file with `gitdir:` for a worktree or submodule).
 * Reads files only, does not run git. Null if `dir` is not in a git work tree.
 */
export function findGitRepo(dir: string): GitRepo | null {
  let cur = resolve(dir);
  for (;;) {
    const dotGit = join(cur, ".git");
    if (existsSync(dotGit)) {
      const gitDir = statSync(dotGit).isDirectory() ? dotGit : gitDirFromFile(dotGit);
      if (gitDir === null) return null;
      return { root: cur, excludeFile: join(commonDir(gitDir), "info", "exclude") };
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function gitDirFromFile(file: string): string | null {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(file, "utf8"));
  return m ? resolve(dirname(file), m[1]!) : null;
}

/** A linked worktree has a `commondir` file; `info/exclude` is in that folder. */
function commonDir(gitDir: string): string {
  const file = join(gitDir, "commondir");
  if (!existsSync(file)) return gitDir;
  const rel = readFileSync(file, "utf8").trim();
  return isAbsolute(rel) ? rel : resolve(gitDir, rel);
}

/** An exclude pattern for the folder `path` (absolute, in the work tree): `/sub/dir/`. */
export function excludePattern(repo: GitRepo, path: string): string {
  return `/${relative(repo.root, path).split(sep).join("/")}/`;
}

/** Adds the patterns that are not in `info/exclude` yet. Returns the added patterns. */
export function addGitExcludes(repo: GitRepo, patterns: readonly string[]): string[] {
  const text = existsSync(repo.excludeFile) ? readFileSync(repo.excludeFile, "utf8") : "";
  const present = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const added = patterns.filter((p) => !present.has(p));
  if (added.length === 0) return [];
  mkdirSync(dirname(repo.excludeFile), { recursive: true });
  const sepLine = text === "" || text.endsWith("\n") ? "" : "\n";
  atomicWrite(repo.excludeFile, `${text}${sepLine}${added.join("\n")}\n`);
  return added;
}
