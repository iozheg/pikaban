#!/usr/bin/env node
import { Command, Option } from "commander";
import pkg from "../../package.json" with { type: "json" };
import * as add from "./commands/add.js";
import * as categories from "./commands/categories.js";
import * as check from "./commands/check.js";
import * as del from "./commands/delete.js";
import * as init from "./commands/init.js";
import * as list from "./commands/list.js";
import * as migrate from "./commands/migrate.js";
import * as move from "./commands/move.js";
import * as note from "./commands/note.js";
import * as projects from "./commands/projects.js";
import * as set from "./commands/set.js";
import * as show from "./commands/show.js";
import * as skill from "./commands/skill.js";
import * as ui from "./commands/ui.js";
import { argvHasJson, PIKABAN_HOME_ENV } from "./context.js";
import { Output } from "./output.js";

/**
 * The program. `-C` and `--json` are options of the root command. Commander reads root options
 * before and after the subcommand name, so `pikaban --json list` and `pikaban list --json` both work.
 * Commands read them with `cmd.optsWithGlobals()` (see `contextOf`).
 */
export function buildProgram(json: boolean): Command {
  const program = new Command()
    .name("pikaban")
    .description(pkg.description)
    .version(pkg.version)
    .addOption(new Option("-C <path>", "project folder (default: search up from the current folder for .pikaban/)"))
    .option("--json", "JSON output: stdout has only JSON, errors go to stderr as JSON")
    // Set before the subcommands are added, so that they inherit it.
    .exitOverride()
    .configureHelp({ showGlobalOptions: true })
    .configureOutput({
      // In --json mode, the error is written as JSON in `Output.error`.
      outputError: (str, write) => {
        if (!json) write(str);
      },
    })
    .addHelpText(
      "after",
      `\nEnvironment:\n  ${PIKABAN_HOME_ENV}  the home folder for pikaban: the folder of .pikaban_config.json, and of\n` +
        "                .claude/ for the user skill and the user settings.json (default: the home folder)\n\n" +
        "Exit codes: 0 success, 1 general error, 2 incorrect usage, 3 not found, 4 short name has more\n" +
        "than one task, 5 conflict (a file changed, or the skill file has local changes), 6 schema version\n" +
        "is different, 7 validation error.",
    );

  for (const cmd of [init, add, list, show, move, set, note, del, categories, check, migrate, skill, projects, ui]) {
    cmd.register(program);
  }
  return program;
}

async function main(argv: string[]): Promise<void> {
  const json = argvHasJson(argv.slice(2));
  const program = buildProgram(json);
  try {
    await program.parseAsync(argv);
  } catch (err) {
    new Output(json).error(err);
  }
}

await main(process.argv);
