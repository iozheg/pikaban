import type { Command } from "commander";
import { contextOf, usageError } from "../context.js";

interface UiOptions {
  port?: string;
  open: boolean;
}

function parsePort(text: string): number {
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw usageError(`invalid port "${text}". Use a number from 1 to 65535.`);
  return n;
}

export function register(program: Command): void {
  program
    .command("ui")
    .description(
      "start the UI server on 127.0.0.1 and open the Kanban board in the browser. " +
        "Without --port, the server uses port 4477 or the next free port. Stop it with Ctrl+C",
    )
    .option("--port <n>", "use this port. If it is in use, the command stops")
    .option("--no-open", "do not open the browser")
    .action(async (opts: UiOptions, cmd: Command) => {
      const ctx = contextOf(cmd);
      const port = opts.port === undefined ? undefined : parsePort(opts.port);
      // Load the server only for this command: the other commands start faster without chokidar.
      const { startServer, UI_DEV_ENV } = await import("../../server/index.js");
      const server = await startServer({
        homeDir: ctx.homeDir,
        port,
        strictPort: port !== undefined,
        dev: process.env[UI_DEV_ENV] === "1",
      });

      let stopping = false;
      const stop = (signal: NodeJS.Signals) => {
        if (stopping) return;
        stopping = true;
        // A second signal stops at once.
        process.once(signal, () => process.exit(1));
        const force = setTimeout(() => process.exit(0), 3000);
        force.unref();
        void server.close().then(() => {
          if (!ctx.json) process.stderr.write("Tracker UI stopped.\n");
          process.exit(0);
        });
      };
      process.once("SIGINT", () => stop("SIGINT"));
      process.once("SIGTERM", () => stop("SIGTERM"));

      ctx.out.result(
        { url: server.url, port: server.port },
        `Tracker UI: ${server.url}\nPress Ctrl+C to stop.`,
      );
      if (opts.open) {
        try {
          const { default: open } = await import("open");
          await open(server.url);
        } catch (err) {
          ctx.out.warn(`cannot open the browser: ${(err as Error).message}. Open ${server.url} by hand.`);
        }
      }
    });
}
