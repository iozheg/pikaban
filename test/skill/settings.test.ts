import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_VALIDATION } from "../../src/core/errors.js";
import { addPermissionRule, PERMISSION_RULE, readSettings } from "../../src/skill/settings.js";
import { removeDir, tempDir, pikabanError } from "../helpers.js";

let base: string;
let file: string;
beforeEach(() => {
  base = tempDir("settings");
  file = join(base, ".claude", "settings.json");
});
afterEach(() => removeDir(base));

function write(text: string): void {
  mkdirSync(join(base, ".claude"), { recursive: true });
  writeFileSync(file, text);
}

describe("addPermissionRule", () => {
  it("makes the folder and the file if they do not exist, without a backup", () => {
    expect(addPermissionRule(file)).toEqual({ file, status: "added", backup: null });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ permissions: { allow: [PERMISSION_RULE] } });
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it("keeps all other keys and their sequence, and writes a backup", () => {
    const old = JSON.stringify(
      {
        model: "opus",
        permissions: { deny: ["Bash(rm:*)"], allow: ["Bash(npm test)"], defaultMode: "default" },
        env: { A: "1" },
        hooks: {},
      },
      null,
      2,
    );
    write(old);
    expect(addPermissionRule(file)).toEqual({ file, status: "added", backup: `${file}.bak` });
    const data = JSON.parse(readFileSync(file, "utf8"));
    expect(Object.keys(data)).toEqual(["model", "permissions", "env", "hooks"]);
    expect(Object.keys(data.permissions)).toEqual(["deny", "allow", "defaultMode"]);
    expect(data.permissions.allow).toEqual(["Bash(npm test)", PERMISSION_RULE]);
    expect(data.env).toEqual({ A: "1" });
    expect(readFileSync(`${file}.bak`, "utf8")).toBe(old);
  });

  it("adds permissions and allow at the end if they are missing, and keeps the indentation", () => {
    write('{\n    "model": "opus"\n}\n');
    addPermissionRule(file);
    expect(readFileSync(file, "utf8")).toBe(
      '{\n    "model": "opus",\n    "permissions": {\n        "allow": [\n            "Bash(pikaban:*)"\n        ]\n    }\n}\n',
    );
    write('{"permissions": {"deny": []}}');
    addPermissionRule(file);
    expect(JSON.parse(readFileSync(file, "utf8")).permissions).toEqual({ deny: [], allow: [PERMISSION_RULE] });
  });

  it("does not add the rule two times and does not write if it is present", () => {
    addPermissionRule(file);
    const text = readFileSync(file, "utf8");
    expect(addPermissionRule(file)).toEqual({ file, status: "present", backup: null });
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(JSON.parse(text).permissions.allow).toEqual([PERMISSION_RULE]);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["an empty file", ""],
    ["an array", "[]"],
    ["permissions not an object", '{"permissions": true}'],
    ["allow not an array", '{"permissions": {"allow": "Bash(pikaban:*)"}}'],
  ])("%s: code 7, the file is not changed, no backup", (_name, text) => {
    write(text);
    const err = pikabanError(EXIT_VALIDATION, () => addPermissionRule(file));
    expect(err.message).toContain(file);
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(existsSync(`${file}.bak`)).toBe(false);
  });

  it("readSettings gives {} for a missing file", () => {
    expect(readSettings(file)).toEqual({ data: {}, text: null });
  });
});
