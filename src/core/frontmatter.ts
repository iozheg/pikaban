import { Document, Scalar, isMap, parseDocument } from "yaml";
import { EXIT_VALIDATION, PikabanError } from "./errors.js";
import {
  TASK_FIELDS,
  TaskFrontmatterSchema,
  taskFrontmatterSchemaFor,
  validate,
  type TaskFrontmatter,
} from "./schema.js";

export interface TaskFile {
  frontmatter: TaskFrontmatter;
  body: string;
}

export interface FrontmatterOptions {
  /** If given, `category` must be in this list. */
  categories?: readonly string[];
  /** File name or path for error messages. */
  source?: string;
}

// YAML 1.2 core schema: `yes`/`no` stay strings, timestamps are not converted to Date.
const YAML_OPTIONS = { version: "1.2", schema: "core" } as const;

const OPEN_RE = /^---\r?\n/;
const CLOSE_RE = /^---[ \t]*(?:\r?\n|$)/m;

/** Splits a file into the raw YAML text and the body. */
export function splitFrontmatter(text: string, source = "task file"): { yaml: string; body: string } {
  const open = OPEN_RE.exec(text);
  if (!open) {
    throw new PikabanError(EXIT_VALIDATION, `${source}: the file must start with a "---" line`);
  }
  const rest = text.slice(open[0].length);
  const close = CLOSE_RE.exec(rest);
  if (!close) {
    throw new PikabanError(EXIT_VALIDATION, `${source}: no closing "---" line after the frontmatter`);
  }
  return { yaml: rest.slice(0, close.index), body: rest.slice(close.index + close[0].length) };
}

export function parseTaskFile(text: string, opts: FrontmatterOptions = {}): TaskFile {
  const source = opts.source ?? "task file";
  const { yaml, body } = splitFrontmatter(text, source);

  // The leading "\n" stands for the opening "---" line, so that error line numbers match the file.
  const doc = parseDocument(`\n${yaml}`, YAML_OPTIONS);
  if (doc.errors.length > 0) {
    const e = doc.errors[0]!;
    throw new PikabanError(EXIT_VALIDATION, `${source}: invalid YAML in frontmatter: ${e.message.trimEnd()}`, {
      cause: e,
    });
  }
  if (!isMap(doc.contents)) {
    throw new PikabanError(EXIT_VALIDATION, `${source}: the frontmatter must be a YAML mapping`);
  }

  const schema = opts.categories ? taskFrontmatterSchemaFor(opts.categories) : TaskFrontmatterSchema;
  const frontmatter = validate(schema, doc.toJS(), source);
  return { frontmatter, body };
}

/** Makes the file text. Fields are in the order of design 2.3, timestamps in double quotes. */
export function serializeTaskFile(file: TaskFile, opts: FrontmatterOptions = {}): string {
  const source = opts.source ?? "task file";
  const schema = opts.categories ? taskFrontmatterSchemaFor(opts.categories) : TaskFrontmatterSchema;
  const fm = validate(schema, file.frontmatter, source);

  const ordered: Record<string, unknown> = {};
  for (const key of TASK_FIELDS) ordered[key] = fm[key];

  const doc = new Document(ordered, YAML_OPTIONS);
  for (const key of ["created_at", "updated_at"] as const) {
    (doc.get(key, true) as Scalar).type = Scalar.QUOTE_DOUBLE;
  }
  const yaml = doc.toString({ lineWidth: 0 });
  return `---\n${yaml}---\n${file.body}`;
}
