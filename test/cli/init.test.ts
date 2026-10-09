import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sandbox, type Sandbox } from "./run.js";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

const projectSkill = () => join(sb.dir, ".claude", "skills", "pikaban", "SKILL.md");
const userSkill = () => join(sb.home, ".claude", "skills", "pikaban", "SKILL.md");
const projectSettings = () => join(sb.dir, ".claude", "settings.json");
const globalConfig = () => join(sb.home, ".pikaban_config.json");

/** All files under `dir` (relative paths). */
function files(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

function expectNothingWritten(): void {
  expect(files(sb.dir)).toEqual([]);
  expect(files(sb.home)).toEqual([]);
}

describe("pikaban init: flags", () => {
  it("all flags given: no questions, the correct files are made", () => {
    const r = sb.run(["init", "--skill", "project", "--allow"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("pikaban init will make these changes");
    expect(r.stdout).not.toMatch(/\?/); // no question was asked
    expect(r.stdout).toContain('Next: pikaban add "<title>"');
    expect(files(sb.dir).sort()).toEqual(
      [".claude/settings.json", ".claude/skills/pikaban/SKILL.md", ".pikaban/config.json"].sort(),
    );
    expect(existsSync(join(sb.dir, ".pikaban", "tasks"))).toBe(true);
    expect(JSON.parse(readFileSync(projectSettings(), "utf8"))).toEqual({ permissions: { allow: ["Bash(pikaban:*)"] } });
    expect(JSON.parse(readFileSync(globalConfig(), "utf8")).projects).toEqual([sb.dir]);
    expect(existsSync(userSkill())).toBe(false);
  });

  it("--json gives a structured result", () => {
    const out = sb.json(["init", "--skill", "user", "--no-allow", "--name", "Demo"]);
    expect(out).toMatchObject({
      project: { root: sb.dir, config: { project_name: "Demo" } },
      registered: true,
      answers: { skill: "user", allow: false },
      skill: { status: "installed", file: userSkill() },
      permission: null,
    });
    expect(existsSync(userSkill())).toBe(true);
    expect(existsSync(join(sb.dir, ".claude"))).toBe(false);
  });

  it("--skill user --allow: the permission rule still goes into the project .claude/settings.json", () => {
    const out = sb.json(["init", "--skill", "user", "--allow"]);
    expect(out.permission).toEqual({ file: projectSettings(), status: "added", backup: null });
    expect(existsSync(join(sb.home, ".claude", "settings.json"))).toBe(false);
  });

  it("--allow keeps the other keys of an existing project settings.json", () => {
    mkdirSync(join(sb.dir, ".claude"));
    writeFileSync(projectSettings(), JSON.stringify({ env: { X: "1" }, permissions: { allow: ["Read"] } }, null, 2));
    expect(sb.json(["init", "--skill", "none", "--allow"]).permission.status).toBe("added");
    expect(JSON.parse(readFileSync(projectSettings(), "utf8"))).toEqual({
      env: { X: "1" },
      permissions: { allow: ["Read", "Bash(pikaban:*)"] },
    });
    expect(existsSync(`${projectSettings()}.bak`)).toBe(true);
  });

  it("--yes: the defaults (project skill, no permission rule)", () => {
    const out = sb.json(["init", "--yes"]);
    expect(out.answers).toEqual({ categories: ["backlog"], skill: "project", allow: false, git: null });
    expect(existsSync(projectSkill())).toBe(true);
    expect(existsSync(projectSettings())).toBe(false);
    // A flag wins over --yes.
    const other = join(sb.dir, "other");
    mkdirSync(other);
    expect(sb.json(["init", "-C", other, "--yes", "--allow", "--skill", "none"]).answers).toEqual({
      categories: ["backlog"],
      skill: "none",
      git: null,
      allow: true,
    });
  });
});

describe("pikaban init: errors write nothing", () => {
  it.each([
    [[], ["--skill <project|user|none>", "--allow or --no-allow"]],
    [["--skill", "project"], ["--allow or --no-allow"]],
    [["--no-allow"], ["--skill <project|user|none>"]],
  ])("without a TTY, flags %j: exit code 2 and the missing flags", (flags, missing) => {
    const r = sb.run(["init", ...flags]);
    expect(r.code).toBe(2);
    for (const m of missing) expect(r.stderr).toContain(m);
    const json = sb.run(["init", ...flags, "--json"]);
    expect(json.code).toBe(2);
    expect(json.stdout).toBe("");
    expect(JSON.parse(json.stderr).error.message).toContain("missing answers");
    expectNothingWritten();
  });

  it("an invalid --skill value gives code 2", () => {
    expect(sb.run(["init", "--skill", "global", "--no-allow"]).code).toBe(2);
    expectNothingWritten();
  });

  it("--allow with invalid project settings JSON: code 7, nothing written", () => {
    mkdirSync(join(sb.dir, ".claude"));
    writeFileSync(projectSettings(), "{ nope");
    const r = sb.run(["init", "--skill", "project", "--allow"]);
    expect(r.code).toBe(7);
    expect(existsSync(join(sb.dir, ".pikaban"))).toBe(false);
    expect(existsSync(projectSkill())).toBe(false);
    expect(files(sb.dir)).toEqual([".claude/settings.json"]);
    expect(readFileSync(projectSettings(), "utf8")).toBe("{ nope");
  });

  it("an edited project skill: code 5 with a diff, nothing written", () => {
    mkdirSync(join(projectSkill(), ".."), { recursive: true });
    writeFileSync(projectSkill(), "my own skill\n");
    const r = sb.run(["init", "--skill", "project", "--no-allow"]);
    expect(r.code).toBe(5);
    expect(r.stderr).toContain("-my own skill");
    expect(r.stderr).toContain("--skill none");
    expect(existsSync(join(sb.dir, ".pikaban"))).toBe(false);
    expect(readFileSync(projectSkill(), "utf8")).toBe("my own skill\n");
  });

  it("a step after .pikaban/ fails: .pikaban/ stays, the message tells what is done and what to run", () => {
    // A file where the .claude folder must be: the skill install fails after .pikaban/ is made.
    writeFileSync(join(sb.dir, ".claude"), "not a folder");
    const r = sb.run(["init", "--skill", "project", "--no-allow"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("pikaban init stopped");
    expect(r.stderr).toContain("Done: made");
    expect(r.stderr).toContain("added the project to the global config");
    expect(r.stderr).toContain(`pikaban -C ${JSON.stringify(sb.dir)} skill install --project`);
    expect(existsSync(join(sb.dir, ".pikaban", "config.json"))).toBe(true);
    expect(JSON.parse(readFileSync(globalConfig(), "utf8")).projects).toEqual([sb.dir]);
  });

  it("only the permission rule fails after the project skill: the message gives the command once", () => {
    // A folder where the settings backup must be: the skill installs, then the permission rule fails.
    mkdirSync(join(sb.dir, ".claude", "settings.json.bak"), { recursive: true });
    writeFileSync(projectSettings(), "{}\n");
    const r = sb.run(["init", "--skill", "project", "--allow"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("installed the project skill");
    const command = `pikaban -C ${JSON.stringify(sb.dir)} skill install --project --allow`;
    expect(r.stderr.split(command)).toHaveLength(2);
  });
});

describe("pikaban init: git", () => {
  /** A hash of each file in .git/ (path, size, content). */
  function gitSnapshot(dir: string): string[] {
    return files(join(dir, ".git")).map((f) => {
      const p = join(dir, ".git", f);
      return `${f} ${statSync(p).size} ${createHash("sha256").update(readFileSync(p)).digest("hex")}`;
    });
  }

  it("does not change any git file and does not stage files", () => {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: sb.dir });
    writeFileSync(join(sb.dir, "README.md"), "x\n");
    const before = gitSnapshot(sb.dir);
    const r = sb.run(["init", "--skill", "project", "--allow"]);
    expect(r.code, r.stderr).toBe(0);
    expect(gitSnapshot(sb.dir)).toEqual(before);
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: sb.dir, encoding: "utf8" });
    // Only untracked files: nothing is staged, nothing is excluded.
    expect(status.split("\n").filter(Boolean).sort()).toEqual(["?? .claude/", "?? .pikaban/", "?? README.md"]);
  });
});
