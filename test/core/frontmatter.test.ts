import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_VALIDATION, PikabanError } from "../../src/core/errors.js";
import { parseTaskFile, serializeTaskFile, splitFrontmatter } from "../../src/core/frontmatter.js";
import { ProjectConfigSchema } from "../../src/core/schema.js";

const fixtures = join(import.meta.dirname, "../fixtures");
const validDir = join(fixtures, "tasks/valid");
const invalidDir = join(fixtures, "tasks/invalid");
const config = ProjectConfigSchema.parse(
  JSON.parse(readFileSync(join(fixtures, "config.valid.json"), "utf8")),
);
const opts = { categories: config.categories };

function validationError(fn: () => unknown): PikabanError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PikabanError);
    expect((err as PikabanError).code).toBe(EXIT_VALIDATION);
    return err as PikabanError;
  }
  throw new Error("expected a validation error");
}

describe("valid fixtures", () => {
  const files = readdirSync(validDir).filter((f) => f.endsWith(".md"));

  it("has fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)("%s round-trips byte for byte", (name) => {
    const text = readFileSync(join(validDir, name), "utf8");
    const parsed = parseTaskFile(text, { ...opts, source: name });
    expect(serializeTaskFile(parsed, opts)).toBe(text);
  });

  it("keeps timestamps as strings and values as written", () => {
    const text = readFileSync(join(validDir, "task-0042-01JA2B3C4D5E6F7G8H9J0KMNPQ.md"), "utf8");
    const { frontmatter, body } = parseTaskFile(text, opts);
    expect(frontmatter).toEqual({
      id: "01JA2B3C4D5E6F7G8H9J0KMNPQ",
      short: "task-0042",
      title: "Implement OAuth2 authentication",
      category: "backlog",
      assignee: null,
      needs_input: false,
      created_at: "2026-10-05T10:00:00.000Z",
      updated_at: "2026-10-05T10:30:00.000Z",
    });
    expect(body.startsWith("\n## Description\n")).toBe(true);
  });

  it("reads `no` and `123` titles as strings (YAML 1.2 core)", () => {
    const no = parseTaskFile(readFileSync(join(validDir, "task-0044-01JA2BAB4D5E6F7G8H9J0KMNPS.md"), "utf8"));
    expect(no.frontmatter.title).toBe("no");
    expect(no.body).toBe("");
    const num = parseTaskFile(readFileSync(join(validDir, "task-0045-01JA2BAC4D5E6F7G8H9J0KMNPT.md"), "utf8"));
    expect(num.frontmatter.title).toBe("123");
  });
});

describe("invalid fixtures give code 7", () => {
  const cases: [string, RegExp][] = [
    ["empty-title.md", /title: title must not be empty/],
    ["unknown-category.md", /category: category must be one of: backlog, todo, in_progress, done/],
    ["broken-yaml.md", /invalid YAML/],
    ["missing-field.md", /assignee: required field is missing/],
    [
      "bad-values.md",
      /id:[\s\S]*short:[\s\S]*assignee: must be "agent", "user" or null[\s\S]*needs_input:[\s\S]*created_at:[\s\S]*updated_at:/,
    ],
    ["unknown-field.md", /priority/],
    ["duplicate-key.md", /invalid YAML in frontmatter: Map keys must be unique at line 5,/],
    ["no-frontmatter.md", /must start with a "---" line/],
    ["unclosed-frontmatter.md", /no closing "---"/],
    ["not-a-mapping.md", /must be a YAML mapping/],
  ];

  it("covers every invalid fixture", () => {
    expect(readdirSync(invalidDir).sort()).toEqual(cases.map(([n]) => n).sort());
  });

  it.each(cases)("%s", (name, message) => {
    const text = readFileSync(join(invalidDir, name), "utf8");
    const err = validationError(() => parseTaskFile(text, { ...opts, source: name }));
    expect(err.message).toMatch(message);
    expect(err.message.startsWith(name)).toBe(true);
  });
});

describe("parseTaskFile", () => {
  const handWritten = [
    "---",
    "updated_at: 2026-10-05T10:30:00Z",
    "created_at: 2026-10-05T10:00:00Z",
    "title: yes",
    "needs_input: false",
    "assignee: ~",
    "category: anything",
    "short: task-0007",
    "id: 01JA2B3C4D5E6F7G8H9J0KMNPQ",
    "---",
    "body",
    "",
  ].join("\n");

  it("keeps unquoted timestamps as strings, never Date", () => {
    const { frontmatter } = parseTaskFile(handWritten);
    expect(typeof frontmatter.created_at).toBe("string");
    expect(frontmatter.created_at).toBe("2026-10-05T10:00:00Z");
    expect(frontmatter.title).toBe("yes");
    expect(frontmatter.assignee).toBeNull();
  });

  it("checks the category only when categories are given", () => {
    expect(parseTaskFile(handWritten).frontmatter.category).toBe("anything");
    validationError(() => parseTaskFile(handWritten, opts));
  });

  it("writes hand-written files in the fixed field order with quoted timestamps", () => {
    const out = serializeTaskFile(parseTaskFile(handWritten));
    expect(out).toBe(
      [
        "---",
        "id: 01JA2B3C4D5E6F7G8H9J0KMNPQ",
        "short: task-0007",
        "title: yes",
        "category: anything",
        "assignee: null",
        "needs_input: false",
        'created_at: "2026-10-05T10:00:00Z"',
        'updated_at: "2026-10-05T10:30:00Z"',
        "---",
        "body",
        "",
      ].join("\n"),
    );
  });

  it("accepts CRLF delimiters", () => {
    const { frontmatter, body } = parseTaskFile(handWritten.replaceAll("\n", "\r\n"));
    expect(frontmatter.short).toBe("task-0007");
    expect(body).toBe("body\r\n");
  });

  it("does not take a `---` inside the body as a delimiter", () => {
    const text = handWritten + "\n---\nmore\n";
    expect(parseTaskFile(text).body).toBe("body\n\n---\nmore\n");
  });
});

describe("serializeTaskFile", () => {
  const frontmatter = {
    id: "01JA2B3C4D5E6F7G8H9J0KMNPQ",
    short: "task-0001",
    title: "A very long title ".repeat(10).trim(),
    category: "todo",
    assignee: null,
    needs_input: false,
    created_at: "2026-10-05T10:00:00.000Z",
    updated_at: "2026-10-05T10:00:00.000Z",
  };

  it("does not fold long titles", () => {
    const out = serializeTaskFile({ frontmatter, body: "" });
    expect(out).toContain(`title: ${frontmatter.title}\n`);
  });

  it("does not write invalid frontmatter", () => {
    validationError(() => serializeTaskFile({ frontmatter: { ...frontmatter, title: "" }, body: "" }));
    validationError(() => serializeTaskFile({ frontmatter, body: "" }, { categories: ["in_progress", "done"] }));
  });

  it("round-trips titles that need quotes", () => {
    for (const title of ["null", "true", "- dash", "a: b", "#hash", "'single'", '"double"', "ünïcödé ✓"]) {
      const text = serializeTaskFile({ frontmatter: { ...frontmatter, title }, body: "x\n" });
      const parsed = parseTaskFile(text);
      expect(parsed.frontmatter.title).toBe(title);
      expect(serializeTaskFile(parsed)).toBe(text);
    }
  });
});

describe("splitFrontmatter", () => {
  it("allows an empty body", () => {
    expect(splitFrontmatter("---\na: 1\n---")).toEqual({ yaml: "a: 1\n", body: "" });
  });
});
