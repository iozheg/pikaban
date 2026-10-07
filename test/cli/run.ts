import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { removeDir, tempDir } from "../helpers.js";

export const CLI = join(import.meta.dirname, "..", "..", "dist", "cli.js");

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Sandbox {
  /** The project folder (empty at the start). */
  dir: string;
  /** PIKABAN_HOME: the folder of .pikaban_config.json. */
  home: string;
  /** Runs the built CLI in `dir` (or `opts.cwd`) with PIKABAN_HOME = `home`. */
  run(args: string[], opts?: { cwd?: string; input?: string }): RunResult;
  /** Runs with `--json`, expects exit code 0 and returns the parsed stdout. */
  json<T = any>(args: string[], opts?: { cwd?: string; input?: string }): T;
  cleanup(): void;
}

export function sandbox(): Sandbox {
  // realpath: on macOS, tmpdir() is a symlink, and the CLI sees the real path as its cwd.
  const base = realpathSync(tempDir("cli"));
  const dir = join(base, "My Project");
  const home = join(base, "home");
  mkdirSync(dir);
  mkdirSync(home);
  const run: Sandbox["run"] = (args, opts = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      cwd: opts.cwd ?? dir,
      input: opts.input ?? "",
      encoding: "utf8",
      env: { ...process.env, PIKABAN_HOME: home },
    });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return {
    dir,
    home,
    run,
    json(args, opts) {
      const r = run([...args, "--json"], opts);
      if (r.code !== 0) throw new Error(`exit ${r.code}: ${r.stderr}`);
      return JSON.parse(r.stdout);
    },
    cleanup: () => removeDir(base),
  };
}
