import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { EXIT_GENERAL } from "../../src/core/errors.js";
import {
  checkSkillVersions,
  installSkill,
  packagedSkill,
  readSkillTemplate,
  renderSkill,
  skillFile,
  skillVersionOf,
} from "../../src/skill/install.js";
import { CLI_VERSION } from "../../src/skill/version.js";
import { removeDir, tempDir, pikabanError } from "../helpers.js";

let base: string;
let home: string;
let project: string;
beforeEach(() => {
  base = tempDir("skill");
  home = join(base, "home");
  project = join(base, "project");
  mkdirSync(home);
  mkdirSync(project);
});
afterEach(() => removeDir(base));

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe("the skill text", () => {
  it("has name: pikaban, a description and the version placeholder", () => {
    const template = readSkillTemplate();
    const m = /^---\n([\s\S]*?)\n---\n/.exec(template);
    expect(m).not.toBeNull();
    const fm = parseYaml(m![1]!) as { name: string; description: string };
    expect(fm.name).toBe("pikaban");
    for (const word of [".pikaban/", "backlog", "Kanban", "todo"]) expect(fm.description).toContain(word);
    expect(template).toContain("<!-- pikaban-skill-version: {{version}} -->");
  });

  it("gets the package version in the version line", () => {
    const text = packagedSkill();
    expect(skillVersionOf(text)).toBe(CLI_VERSION);
    expect(text).not.toContain("{{version}}");
    expect(skillVersionOf(renderSkill("x <!-- pikaban-skill-version: {{version}} --> y", "9.8.7"))).toBe("9.8.7");
    pikabanError(EXIT_GENERAL, () => renderSkill("no placeholder", "1.0.0"));
  });

  it("names a command for each skill and each protocol rule, and the init flags", () => {
    const text = packagedSkill();
    for (const s of ["add_task", "do_task", "update_task", "elaborate_task", "remove_task"]) expect(text).toContain(s);
    for (const cmd of ["pikaban add", "pikaban move", "pikaban set", "pikaban note", "pikaban delete", "pikaban show"]) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain("--skill <project|user|none>");
    expect(text).toContain("--no-allow");
    expect(text).toMatch(/`pikaban` command is not found, stop/);
    // Rules 1 to 9 and the exit code table 0 to 7.
    for (let i = 1; i <= 9; i++) expect(text).toMatch(new RegExp(`^${i}\\. `, "m"));
    for (let i = 0; i <= 7; i++) expect(text).toMatch(new RegExp(`^\\| ${i} \\|`, "m"));
  });
});

describe("installSkill", () => {
  const text = () => packagedSkill();

  it("installs into a temporary home folder and a temporary project folder", () => {
    for (const root of [home, project]) {
      const file = skillFile(root);
      expect(installSkill(file, text())).toMatchObject({ status: "installed", file, version: CLI_VERSION, previousVersion: null });
      expect(readFileSync(file, "utf8")).toBe(text());
    }
    expect(skillFile(project)).toBe(join(project, ".claude", "skills", "pikaban", "SKILL.md"));
  });

  it("a second install does nothing", () => {
    const file = skillFile(home);
    installSkill(file, text());
    const r = installSkill(file, text());
    expect(r).toMatchObject({ status: "unchanged", previousVersion: CLI_VERSION });
    expect(r.diff).toBeUndefined();
  });

  it("an edited skill stops with a diff without --force, and --force replaces it", () => {
    const file = skillFile(project);
    const edited = `${text()}\nMy own rule.\n`;
    write(file, edited);
    const r = installSkill(file, text());
    expect(r.status).toBe("conflict");
    expect(r.diff).toContain("-My own rule.");
    expect(readFileSync(file, "utf8")).toBe(edited);

    expect(installSkill(file, text(), { force: true }).status).toBe("replaced");
    expect(readFileSync(file, "utf8")).toBe(text());
  });

  it("replaces a skill with only an older version line", () => {
    const file = skillFile(home);
    write(file, packagedSkill("0.0.1"));
    expect(installSkill(file, text())).toMatchObject({ status: "updated", previousVersion: "0.0.1", version: CLI_VERSION });
    expect(readFileSync(file, "utf8")).toBe(text());
  });

  it("does not replace an older skill with other changes, or a newer skill", () => {
    const file = skillFile(home);
    const olderEdited = packagedSkill("0.0.1").replace("## Read tasks", "## Read the tasks");
    write(file, olderEdited);
    expect(installSkill(file, text()).status).toBe("conflict");
    expect(readFileSync(file, "utf8")).toBe(olderEdited);

    write(file, packagedSkill("99.0.0"));
    expect(installSkill(file, text()).status).toBe("conflict");
  });
});

describe("checkSkillVersions", () => {
  it("gives no issue if no skill is installed, or the skills are current", () => {
    expect(checkSkillVersions({ projectRoot: project, homeDir: home })).toEqual([]);
    installSkill(skillFile(project), packagedSkill());
    installSkill(skillFile(home), packagedSkill());
    expect(checkSkillVersions({ projectRoot: project, homeDir: home })).toEqual([]);
  });

  it("warns for an older, a missing or an invalid version line, in each scope", () => {
    write(skillFile(project), packagedSkill("0.0.9"));
    write(skillFile(home), "no version line");
    const issues = checkSkillVersions({ projectRoot: project, homeDir: home, version: "0.1.0" });
    expect(issues).toMatchObject([
      { kind: "skill_version", severity: "warning", file: skillFile(project) },
      { kind: "skill_version", severity: "warning", file: skillFile(home) },
    ]);
    expect(issues[0]!.message).toContain("0.0.9 is older than the CLI (0.1.0)");
    expect(issues[0]!.message).toContain("pikaban skill install --project");
    expect(issues[1]!.message).toContain("no pikaban-skill-version line");

    write(skillFile(home), packagedSkill("x.y"));
    expect(checkSkillVersions({ projectRoot: project, homeDir: home, version: "0.0.9" })).toMatchObject([
      { file: skillFile(home), message: expect.stringContaining("invalid version") },
    ]);
  });

  it("compares numerically and checks a file only one time", () => {
    write(skillFile(home), packagedSkill("0.10.0"));
    expect(checkSkillVersions({ projectRoot: home, homeDir: home, version: "0.9.0" })).toEqual([]);
    expect(checkSkillVersions({ projectRoot: home, homeDir: home, version: "0.11.0" })).toHaveLength(1);
    expect(existsSync(skillFile(project))).toBe(false);
  });
});
