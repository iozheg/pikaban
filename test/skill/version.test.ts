import { describe, expect, it } from "vitest";
import { lineDiff } from "../../src/skill/diff.js";
import { compareVersions, isVersion } from "../../src/skill/version.js";

describe("compareVersions", () => {
  it.each([
    ["0.1.0", "0.1.0", 0],
    ["0.1.0", "0.2.0", -1],
    ["1.10.0", "1.9.0", 1], // numeric, not text
    ["2.0.0", "10.0.0", -1],
    ["1.0.0-beta", "1.0.0", -1],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["1.0.0+build", "1.0.0", 0],
  ] as const)("%s vs %s gives %i", (a, b, r) => {
    expect(compareVersions(a, b)).toBe(r);
    expect(compareVersions(b, a)).toBe(r === 0 ? 0 : -r);
  });

  it("gives null for a value that is not a version", () => {
    expect(compareVersions("abc", "1.0.0")).toBeNull();
    expect(compareVersions("1.0", "1.0.0")).toBeNull();
    expect(isVersion("{{version}}")).toBe(false);
    expect(isVersion("0.1.0")).toBe(true);
  });
});

describe("lineDiff", () => {
  it("gives an empty text for the same lines", () => {
    expect(lineDiff("a\nb\n", "a\nb\n", { old: "x", new: "y" })).toBe("");
  });

  it("shows changed lines with context and hunk headers", () => {
    const old = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].join("\n");
    const neu = ["1", "2", "3", "4", "five", "6", "7", "8", "9", "10", "11"].join("\n");
    expect(lineDiff(old, neu, { old: "old", new: "new" }, 1)).toBe(
      ["--- old", "+++ new", "@@ -4,3 +4,3 @@", " 4", "-5", "+five", " 6", "@@ -10,1 +10,2 @@", " 10", "+11", ""].join("\n"),
    );
  });
});
