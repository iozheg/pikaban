import type { Command } from "commander";
import {
  KNOWN_CATEGORIES,
  parseOptionalCategory,
  REQUIRED_CATEGORIES,
  setCategoryEnabled,
  type CategoryChange,
} from "../../core/index.js";
import { contextOf, type Context } from "../context.js";

interface CategoryRow {
  name: string;
  enabled: boolean;
  required: boolean;
  /** A category in config.json that the CLI does not know (a hand edit). */
  custom: boolean;
}

function rows(categories: readonly string[]): CategoryRow[] {
  const required = REQUIRED_CATEGORIES as readonly string[];
  const known = KNOWN_CATEGORIES as readonly string[];
  return [
    ...known.map((name) => ({ name, enabled: categories.includes(name), required: required.includes(name), custom: false })),
    ...categories.filter((c) => !known.includes(c)).map((name) => ({ name, enabled: true, required: false, custom: true })),
  ];
}

function change(ctx: Context, name: string, enabled: boolean): void {
  const r: CategoryChange = setCategoryEnabled(ctx.project({ write: true }), parseOptionalCategory(name), enabled);
  const state = enabled ? "on" : "off";
  ctx.out.result(
    r,
    `${r.changed ? `${r.category} is now ${state}` : `${r.category} is already ${state}`}. Categories: ${r.categories.join(", ")}`,
  );
}

export function register(program: Command): void {
  const categories = program
    .command("categories")
    .description("show the categories; turn backlog or review on or off")
    .action((_opts: unknown, cmd: Command) => {
      const ctx = contextOf(cmd);
      const config = ctx.project({ write: false }).config;
      const list = rows(config.categories);
      const width = Math.max(...list.map((r) => r.name.length));
      ctx.out.result({ categories: config.categories, all: list }, () =>
        list
          .map((r) => {
            const notes = [r.enabled ? "on" : "off"];
            if (r.required) notes.push("required");
            if (r.custom) notes.push("custom");
            return `${r.name.padEnd(width)}  ${notes.join(", ")}`;
          })
          .join("\n"),
      );
    });

  categories
    .command("enable")
    .description("turn on backlog or review (it goes into its place on the board)")
    .argument("<category>", "backlog or review")
    .action((name: string, _opts: unknown, cmd: Command) => change(contextOf(cmd), name, true));

  categories
    .command("disable")
    .description("turn off backlog or review (no tasks may be in it)")
    .argument("<category>", "backlog or review")
    .action((name: string, _opts: unknown, cmd: Command) => change(contextOf(cmd), name, false));
}
