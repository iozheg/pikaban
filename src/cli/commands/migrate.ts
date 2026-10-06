import type { Command } from "commander";
import { migrate } from "../../core/index.js";
import { contextOf } from "../context.js";

export function register(program: Command): void {
  program
    .command("migrate")
    .description("change all files to the schema version of the CLI")
    .option("--dry-run", "show the changes, write nothing")
    .action((opts: { dryRun?: boolean }, cmd: Command) => {
      const ctx = contextOf(cmd);
      const result = migrate(ctx.projectRoot(), { dryRun: opts.dryRun ?? false });
      ctx.out.result(result, () => {
        if (result.applied.length === 0) return `Schema version ${result.to} is current. Nothing to do.`;
        const verb = result.dryRun ? "would change" : "changed";
        return [
          `Schema version ${result.from} -> ${result.to}${result.dryRun ? " (dry run)" : ""}`,
          `${result.changedFiles.length} file(s) ${verb}:`,
          ...result.changedFiles.map((f) => `  ${f}`),
        ].join("\n");
      });
    });
}
