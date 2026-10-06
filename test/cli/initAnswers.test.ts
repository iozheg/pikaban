import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALLOW_QUESTION,
  CATEGORIES_QUESTION,
  CONFIRM_QUESTION,
  GIT_QUESTION,
  resolveInitAnswers,
  runInit,
  SKILL_QUESTION,
  type InitCommandOptions,
} from "../../src/cli/commands/init.js";
import type { Context } from "../../src/cli/context.js";
import { Output } from "../../src/cli/output.js";
import type { Ask } from "../../src/cli/prompt.js";
import { EXIT_GENERAL, EXIT_USAGE, TrackerError } from "../../src/core/errors.js";
import { removeDir, tempDir } from "../helpers.js";

let base: string;
let stdout: string;
beforeEach(() => {
  base = realpathSync(tempDir("init-answers"));
  stdout = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  removeDir(base);
});

/** A project folder and a home folder, and a Context for them (human output). */
function setup(name: string): { ctx: Context; dir: string; home: string } {
  const dir = join(base, name, "proj");
  const home = join(base, name, "home");
  mkdirSync(dir, { recursive: true });
  mkdirSync(home, { recursive: true });
  const ctx: Context = {
    startDir: dir,
    json: false,
    homeDir: home,
    out: new Output(false),
    project: () => {
      throw new Error("not used");
    },
    projectRoot: () => dir,
  };
  return { ctx, dir, home };
}

/** Answers by question; records the questions. */
function scripted(answers: { categories?: string; skill?: string; allow?: string; git?: string; confirm?: string }): {
  ask: Ask;
  asked: string[];
} {
  const asked: string[] = [];
  const ask: Ask = async (q) => {
    asked.push(q);
    if (q.startsWith(CATEGORIES_QUESTION)) return answers.categories ?? "";
    if (q.startsWith(GIT_QUESTION)) return answers.git ?? "";
    if (q.startsWith(SKILL_QUESTION)) return answers.skill ?? "";
    if (q.startsWith(ALLOW_QUESTION)) return answers.allow ?? "";
    if (q.startsWith(CONFIRM_QUESTION)) return answers.confirm ?? "";
    throw new Error(`unexpected question: ${q}`);
  };
  return { ask, asked };
}

/** All files under `dir` with their content, without the global config (it has absolute paths). */
function snapshot(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, snapshot(p, `${prefix}${e.name}/`));
    else if (e.name !== ".tracker_config.json") out[`${prefix}${e.name}`] = readFileSync(p, "utf8");
  }
  return out;
}

describe("resolveInitAnswers", () => {
  it("flags only: no questions", async () => {
    const { ask, asked } = scripted({});
    expect(await resolveInitAnswers({ skill: "user", allow: true, review: true }, { interactive: true, ask })).toEqual({
      categories: ["backlog", "review"],
      skill: "user",
      allow: true,
      git: null,
    });
    expect(asked).toEqual([]);
  });

  it("--yes gives the defaults for missing answers, with or without a TTY", async () => {
    expect(await resolveInitAnswers({ yes: true }, { interactive: false })).toEqual({
      categories: ["backlog"],
      skill: "project",
      allow: false,
      git: null,
    });
    expect(await resolveInitAnswers({ yes: true, allow: true }, { interactive: false, gitRepo: true })).toEqual({
      categories: ["backlog"],
      skill: "project",
      allow: true,
      git: true,
    });
  });

  it("without a TTY, a missing answer gives code 2 with the missing flags", async () => {
    const err = await resolveInitAnswers({ skill: "none" }, { interactive: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as TrackerError).code).toBe(EXIT_USAGE);
    expect((err as TrackerError).message).toContain("--allow or --no-allow");
    expect((err as TrackerError).message).not.toContain("--skill <");
  });

  it("in a TTY, asks only the questions without a flag; empty answers give the defaults", async () => {
    const s = scripted({});
    expect(await resolveInitAnswers({}, { interactive: true, ask: s.ask })).toEqual({
      categories: ["backlog"],
      skill: "project",
      allow: false,
      git: null,
    });
    expect(s.asked).toHaveLength(3);
    const t = scripted({ allow: "yes" });
    expect(await resolveInitAnswers({ skill: "none", backlog: false }, { interactive: true, ask: t.ask })).toEqual({
      categories: [],
      skill: "none",
      allow: true,
      git: null,
    });
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0]).toContain(ALLOW_QUESTION);
  });

  it("asks again after an invalid answer; accepts a first letter", async () => {
    const answers = ["global", "u"];
    const asked: string[] = [];
    const ask: Ask = async (q) => {
      asked.push(q);
      if (q.startsWith(CATEGORIES_QUESTION)) return "";
      return q.startsWith(SKILL_QUESTION) ? answers.shift()! : "n";
    };
    expect(await resolveInitAnswers({}, { interactive: true, ask })).toMatchObject({ skill: "user", allow: false });
    expect(asked).toHaveLength(4);
  });

  it("shows the two optional categories and reads names, prefixes or none", async () => {
    const flags = { skill: "none", allow: false } as const;
    const s = scripted({ categories: "r, b" });
    expect((await resolveInitAnswers(flags, { interactive: true, ask: s.ask })).categories).toEqual(["backlog", "review"]);
    expect(s.asked[0]).toContain("[x] backlog");
    expect(s.asked[0]).toContain("[ ] review");
    expect(s.asked[0]).not.toContain("todo  ");
    const none = scripted({ categories: "none" });
    expect((await resolveInitAnswers(flags, { interactive: true, ask: none.ask })).categories).toEqual([]);
    const bad = scripted({ categories: "verify" });
    await expect(resolveInitAnswers(flags, { interactive: true, ask: bad.ask })).rejects.toMatchObject({ code: EXIT_USAGE });
    expect(bad.asked).toHaveLength(3);
  });

  it("asks the git question only in a git repository", async () => {
    const flags = { skill: "none", allow: false, backlog: true } as const;
    const s = scripted({ git: "n" });
    expect((await resolveInitAnswers(flags, { interactive: true, ask: s.ask, gitRepo: true })).git).toBe(false);
    expect(s.asked).toEqual([expect.stringContaining(GIT_QUESTION)]);
    const t = scripted({});
    expect((await resolveInitAnswers(flags, { interactive: true, ask: t.ask, gitRepo: false })).git).toBeNull();
    expect(t.asked).toEqual([]);
    expect((await resolveInitAnswers({ ...flags, git: false }, { interactive: false, gitRepo: true })).git).toBe(false);
  });

  it("an invalid --skill value gives code 2", async () => {
    await expect(resolveInitAnswers({ skill: "all", allow: false }, { interactive: false })).rejects.toMatchObject({
      code: EXIT_USAGE,
    });
  });
});

describe("runInit with scripted answers", () => {
  it("no to git: .tracker/ and the project skill go into .git/info/exclude", async () => {
    const a = setup("git-no");
    mkdirSync(join(a.dir, ".git"));
    const s = scripted({ categories: "review", git: "n", confirm: "y" });
    const r = await runInit(a.ctx, { skill: "project", allow: false }, { interactive: true, ask: s.ask });
    expect(r.answers).toEqual({ categories: ["review"], skill: "project", allow: false, git: false });
    expect(r.project.config.categories).toEqual(["todo", "in_progress", "review", "done"]);
    expect(readFileSync(join(a.dir, ".git", "info", "exclude"), "utf8")).toBe("/.tracker/\n/.claude/skills/tracker/\n");
    expect(stdout).toContain("categories: todo, in_progress, review, done");
  });

  const cases: [string, { skill: string; allow: string }, InitCommandOptions][] = [
    ["project skill, allow", { skill: "project", allow: "y" }, { skill: "project", allow: true }],
    ["user skill, no allow", { skill: "user", allow: "n" }, { skill: "user", allow: false }],
    ["no skill, allow", { skill: "none", allow: "yes" }, { skill: "none", allow: true }],
    ["defaults", { skill: "", allow: "" }, { yes: true }],
  ];

  it.each(cases)("%s: the same result as the flags", async (name, answers, flags) => {
    const a = setup(`${name}-asked`);
    const s = scripted({ ...answers, confirm: "y" });
    const asked = await runInit(a.ctx, {}, { interactive: true, ask: s.ask });
    expect(s.asked).toHaveLength(4); // categories, skill, allow, confirmation
    expect(stdout).toContain("tracker init will make these changes");

    const b = setup(`${name}-flags`);
    const flagged = await runInit(b.ctx, flags, { interactive: false });

    expect(asked.answers).toEqual(flagged.answers);
    expect(asked.skill?.status).toBe(flagged.skill?.status);
    expect(asked.permission?.status).toBe(flagged.permission?.status);
    expect(snapshot(a.dir)).toEqual(snapshot(b.dir));
    expect(snapshot(a.home)).toEqual(snapshot(b.home));
    expect(snapshot(a.dir)).toHaveProperty([".tracker/config.json"]);
  });

  it("a confirmation answer of no (or empty) writes nothing", async () => {
    for (const confirm of ["n", ""]) {
      const a = setup(`cancel-${confirm || "empty"}`);
      const s = scripted({ skill: "project", allow: "y", confirm });
      await expect(runInit(a.ctx, {}, { interactive: true, ask: s.ask })).rejects.toMatchObject({ code: EXIT_GENERAL });
      expect(readdirSync(a.dir)).toEqual([]);
      expect(readdirSync(a.home)).toEqual([]);
    }
  });

  it("all flags in a TTY: only the confirmation; --yes: no question", async () => {
    const a = setup("tty-flags");
    const s = scripted({ confirm: "y" });
    await runInit(a.ctx, { skill: "none", allow: false, backlog: true }, { interactive: true, ask: s.ask });
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]).toContain(CONFIRM_QUESTION);

    const b = setup("tty-yes");
    const t = scripted({});
    await runInit(b.ctx, { yes: true }, { interactive: true, ask: t.ask });
    expect(t.asked).toEqual([]);
    expect(existsSync(join(b.dir, ".claude", "skills", "tracker", "SKILL.md"))).toBe(true);
  });
});
