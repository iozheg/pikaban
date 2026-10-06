import { EXIT_GENERAL, EXIT_USAGE, TrackerError } from "./errors.js";
import { atomicWrite } from "./fs.js";
import { assertWritable, type Project } from "./project.js";
import { ProjectConfigSchema, REQUIRED_CATEGORIES, validate, type ProjectConfig } from "./schema.js";
import { list } from "./tasks.js";

/** All categories that the CLI can turn on, in board order. */
export const KNOWN_CATEGORIES = ["backlog", "todo", "in_progress", "review", "done"] as const;

/** The categories that `init` asks about and `tracker categories` can turn on and off. */
export const OPTIONAL_CATEGORIES = ["backlog", "review"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export const CATEGORY_DESCRIPTIONS: Record<OptionalCategory, string> = {
  backlog: "tasks for later, before todo",
  review: "the agent's finished work waits for your check before done",
};

/** The optional categories that a new project has. */
export const DEFAULT_OPTIONAL_CATEGORIES: readonly OptionalCategory[] = ["backlog"];

export function isOptionalCategory(name: string): name is OptionalCategory {
  return (OPTIONAL_CATEGORIES as readonly string[]).includes(name);
}

/** The required categories and the selected optional ones, in board order. */
export function categoriesWith(optional: readonly OptionalCategory[]): string[] {
  return KNOWN_CATEGORIES.filter(
    (c) => (REQUIRED_CATEGORIES as readonly string[]).includes(c) || (optional as readonly string[]).includes(c),
  );
}

export interface CategoryChange {
  category: OptionalCategory;
  enabled: boolean;
  /** False if the category was already on (or off). */
  changed: boolean;
  categories: string[];
}

/** Code 2 for a name that is not `backlog` or `review`. */
export function parseOptionalCategory(name: string): OptionalCategory {
  if (isOptionalCategory(name)) return name;
  if ((REQUIRED_CATEGORIES as readonly string[]).includes(name)) {
    throw new TrackerError(EXIT_USAGE, `"${name}" is required and is always on.`);
  }
  throw new TrackerError(EXIT_USAGE, `unknown category "${name}". Use ${OPTIONAL_CATEGORIES.join(" or ")}.`);
}

/**
 * Turns an optional category on or off in `config.json`. On: it goes into its board position (before the
 * next known category in the config). Off: code 1 if tasks are still in the category.
 */
export function setCategoryEnabled(p: Project, category: OptionalCategory, enabled: boolean): CategoryChange {
  assertWritable(p);
  const current = p.config.categories;
  if (current.includes(category) === enabled) return { category, enabled, changed: false, categories: [...current] };

  let categories: string[];
  if (enabled) {
    const after = KNOWN_CATEGORIES.slice(KNOWN_CATEGORIES.indexOf(category) + 1);
    const next = current.findIndex((c) => (after as readonly string[]).includes(c));
    categories = [...current];
    categories.splice(next === -1 ? categories.length : next, 0, category);
  } else {
    const left = list(p, { category }).tasks;
    if (left.length > 0) {
      throw new TrackerError(
        EXIT_GENERAL,
        `${left.length} task(s) are in ${category}: ${left.map((t) => t.short).join(", ")}. ` +
          `Move them to another category first (tracker move <ref> <category>).`,
      );
    }
    categories = current.filter((c) => c !== category);
  }
  const config: ProjectConfig = validate(ProjectConfigSchema, { ...p.config, categories }, p.configFile);
  atomicWrite(p.configFile, `${JSON.stringify(config, null, 2)}\n`);
  return { category, enabled, changed: true, categories };
}
