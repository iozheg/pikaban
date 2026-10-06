import { isAbsolute } from "node:path";
import { z } from "zod";
import { EXIT_VALIDATION, TrackerError } from "./errors.js";

export const SCHEMA_VERSION = 1;

// Crockford base32, 26 characters. The first character is 0-7 (128-bit value).
export const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const SHORT_RE = /^task-\d{4}$/;

// Categories that the agent protocol uses (design 2.2).
export const REQUIRED_CATEGORIES = ["todo", "in_progress", "done"] as const;

// Field order in a task file (design 2.3).
export const TASK_FIELDS = [
  "id",
  "short",
  "title",
  "category",
  "assignee",
  "needs_input",
  "created_at",
  "updated_at",
] as const;

const nonBlank = (what: string) =>
  z.string().refine((s) => s.trim().length > 0, `${what} must not be empty`);

const timestamp = z.iso.datetime({ error: "must be an ISO 8601 UTC timestamp" });

export const ProjectConfigSchema = z.strictObject({
  schema_version: z.int().nonnegative(),
  project_id: nonBlank("project_id"),
  project_name: nonBlank("project_name"),
  categories: z
    .array(nonBlank("category"))
    .min(1)
    .refine((c) => new Set(c).size === c.length, "categories must be unique")
    .refine(
      (c) => REQUIRED_CATEGORIES.every((r) => c.includes(r)),
      `categories must contain ${REQUIRED_CATEGORIES.map((r) => `"${r}"`).join(", ")}`,
    ),
});

export const AssigneeSchema = z
  .enum(["agent", "user"], { error: 'must be "agent", "user" or null' })
  .nullable();

export const TaskFrontmatterSchema = z.strictObject({
  id: z.string().regex(ULID_RE, "must be a 26-character ULID"),
  short: z.string().regex(SHORT_RE, 'must be "task-" plus 4 digits'),
  title: nonBlank("title"),
  category: nonBlank("category"),
  assignee: AssigneeSchema,
  needs_input: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});

// The fields that `update` can change. `id`, `short` and the timestamps are not here.
export const TaskPatchSchema = z.strictObject({
  title: nonBlank("title").optional(),
  category: nonBlank("category").optional(),
  assignee: AssigneeSchema.optional(),
  needs_input: z.boolean().optional(),
  body: z.string().optional(),
});

// Unknown keys are kept, so that other CLI versions do not lose data.
export const GlobalConfigSchema = z.looseObject({
  projects: z.array(z.string().refine(isAbsolute, "project path must be absolute")),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type Assignee = z.infer<typeof AssigneeSchema>;
export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;
export type TaskPatch = z.infer<typeof TaskPatchSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;

/** The first category is the default for new tasks (design 2.2). */
export function defaultCategory(config: ProjectConfig): string {
  return config.categories[0]!;
}

/** Task frontmatter schema that also requires `category` to be in `categories`. */
export function taskFrontmatterSchemaFor(categories: readonly string[]) {
  return TaskFrontmatterSchema.extend({
    category: z
      .string()
      .refine(
        (c) => categories.includes(c),
        `category must be one of: ${categories.join(", ")}`,
      ),
  });
}

/** Parses `data` with `schema`. On failure, throws TrackerError code 7. */
export function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
  source: string,
): z.output<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => {
    if (i.path.length === 0) return `  ${i.message}`;
    const missing = valueAt(data, i.path) === undefined;
    return `  ${i.path.join(".")}: ${missing ? "required field is missing" : i.message}`;
  });
  throw new TrackerError(EXIT_VALIDATION, `${source}: validation failed\n${lines.join("\n")}`);
}

function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let v: unknown = data;
  for (const key of path) {
    if (v === null || typeof v !== "object") return undefined;
    v = (v as Record<PropertyKey, unknown>)[key];
  }
  return v;
}
