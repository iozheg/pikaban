import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { sandbox, CLI, type Sandbox } from "./run.js";

let sb: Sandbox;
beforeEach(() => {
  sb = sandbox();
});
afterEach(() => sb.cleanup());

const userSkill = () => join(sb.home, ".claude", "skills", "tracker", "SKILL.md");
const projectSkill = () => join(sb.dir, ".claude", "skills", "tracker", "SKILL.md");
const userSettings = () => join(sb.home, ".claude", "settings.json");
const projectSettings = () => join(sb.dir, ".claude", "settings.json");

/** The packaged text from dist/, with the version of package.json. */
function packaged(version = pkg.version): string {
  const template = readFileSync(join(CLI, "..", "skill", "SKILL.md"), "utf8");
  return template.replaceAll("{{version}}", version);
}

function initProject(): void {
  const r = sb.run(["init", "--skill", "none", "--no-allow"]);
  expect(r.code, r.stderr).toBe(0);
}

describe("tracker skill install", () => {
  it("the build copies SKILL.md to dist/skill/", () => {
    expect(readFileSync(join(CLI, "..", "skill", "SKILL.md"), "utf8")).toBe(
      readFileSync(join(import.meta.dirname, "..", "..", "src", "skill", "SKILL.md"), "utf8"),
    );
  });

  it("user scope: installs into TRACKER_HOME/.claude, a second install does nothing", () => {
    const r = sb.run(["skill", "install"]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("Installed the skill");
    expect(readFileSync(userSkill(), "utf8")).toBe(packaged());
    expect(readFileSync(userSkill(), "utf8")).toContain(`<!-- tracker-skill-version: ${pkg.version} -->`);

    const again = sb.json(["skill", "install"]);
    expect(again).toEqual({
      skill: { status: "unchanged", file: userSkill(), version: pkg.version, previousVersion: pkg.version },
      permission: null,
    });
    expect(existsSync(projectSkill())).toBe(false);
  });

  it("--project: installs into the project found from the current folder; code 3 without a project", () => {
    expect(sb.run(["skill", "install", "--project"]).code).toBe(3);
    initProject();
    const sub = join(sb.dir, "src");
    mkdirSync(sub);
    expect(sb.json(["skill", "install", "--project"], { cwd: sub }).skill).toMatchObject({
      status: "installed",
      file: projectSkill(),
    });
    expect(readFileSync(projectSkill(), "utf8")).toBe(packaged());
    expect(existsSync(userSkill())).toBe(false);
  });

  it("an edited skill: exit code 5 with a diff, the file stays; --force replaces it", () => {
    sb.run(["skill", "install"]);
    const edited = packaged().replace("## Exit codes", "## Exit codes (my notes)");
    writeFileSync(userSkill(), edited);

    const human = sb.run(["skill", "install"]);
    expect(human.code).toBe(5);
    expect(human.stderr).toContain("-## Exit codes (my notes)");
    expect(human.stderr).toContain("+## Exit codes");
    expect(human.stderr).toContain("tracker skill install --force");
    const json = sb.run(["skill", "install", "--json"]);
    expect(json.code).toBe(5);
    expect(JSON.parse(json.stdout).skill).toMatchObject({ status: "conflict", diff: expect.stringContaining("my notes") });
    expect(JSON.parse(json.stderr).error.code).toBe(5);
    expect(readFileSync(userSkill(), "utf8")).toBe(edited);

    expect(sb.json(["skill", "install", "--force"]).skill.status).toBe("replaced");
    expect(readFileSync(userSkill(), "utf8")).toBe(packaged());
  });

  it("an older version line only: updated without --force", () => {
    mkdirSync(join(userSkill(), ".."), { recursive: true });
    writeFileSync(userSkill(), packaged("0.0.1"));
    expect(sb.json(["skill", "install"]).skill).toMatchObject({ status: "updated", previousVersion: "0.0.1" });
    expect(readFileSync(userSkill(), "utf8")).toBe(packaged());
  });

  it("--allow: user scope writes TRACKER_HOME/.claude/settings.json, --project the project settings", () => {
    mkdirSync(join(sb.home, ".claude"), { recursive: true });
    writeFileSync(userSettings(), JSON.stringify({ theme: "dark", permissions: { allow: ["Read"] } }));
    const out = sb.json(["skill", "install", "--allow"]);
    expect(out.permission).toEqual({ file: userSettings(), status: "added", backup: `${userSettings()}.bak` });
    expect(JSON.parse(readFileSync(userSettings(), "utf8"))).toEqual({
      theme: "dark",
      permissions: { allow: ["Read", "Bash(tracker:*)"] },
    });
    expect(sb.json(["skill", "install", "--allow"]).permission.status).toBe("present");

    initProject();
    expect(sb.json(["skill", "install", "--project", "--allow"]).permission).toEqual({
      file: projectSettings(),
      status: "added",
      backup: null,
    });
    expect(JSON.parse(readFileSync(projectSettings(), "utf8"))).toEqual({ permissions: { allow: ["Bash(tracker:*)"] } });
  });

  it("--allow with invalid settings JSON: code 7, nothing is written", () => {
    mkdirSync(join(sb.home, ".claude"), { recursive: true });
    writeFileSync(userSettings(), "{ broken");
    const r = sb.run(["skill", "install", "--allow"]);
    expect(r.code).toBe(7);
    expect(readFileSync(userSettings(), "utf8")).toBe("{ broken");
    expect(existsSync(`${userSettings()}.bak`)).toBe(false);
    expect(existsSync(userSkill())).toBe(false);
  });
});

describe("tracker check: skill version", () => {
  it("no warning without a skill or with a current skill; a warning for an old skill", () => {
    initProject();
    expect(sb.json(["check"])).toEqual({ ok: true, issues: [] });
    sb.run(["skill", "install", "--project"]);
    sb.run(["skill", "install"]);
    expect(sb.json(["check"])).toEqual({ ok: true, issues: [] });

    writeFileSync(projectSkill(), packaged("0.0.1"));
    writeFileSync(userSkill(), packaged("0.0.2"));
    const r = sb.run(["check"]);
    expect(r.code, r.stderr).toBe(0); // warnings only
    expect(r.stdout).toContain(`warning: .claude/skills/tracker/SKILL.md: the project skill version 0.0.1 is older`);
    expect(r.stdout).toContain(`warning: ${userSkill()}: the user skill version 0.0.2 is older`);
    expect(r.stdout).toContain("OK: 0 error(s), 2 warning(s)");
    expect(sb.json(["check"]).issues).toMatchObject([
      { kind: "skill_version", severity: "warning", file: projectSkill() },
      { kind: "skill_version", severity: "warning", file: userSkill() },
    ]);
  });
});
