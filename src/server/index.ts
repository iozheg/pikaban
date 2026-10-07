import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EXIT_GENERAL, EXIT_USAGE, PikabanError } from "../core/index.js";
import { failRequest } from "./http.js";
import { handleApi } from "./routes.js";
import { checkRequest } from "./security.js";
import { defaultUiDir, serveStatic } from "./static.js";
import { EventHub, PikabanWatcher, type PikabanEvent } from "./watcher.js";

export type { PikabanEvent } from "./watcher.js";
export { pidOf } from "./projects.js";

export const DEFAULT_PORT = 4477;
export const DEFAULT_HOST = "127.0.0.1";
/** Without `strictPort`, the server tries this number of ports, from `port` up. */
export const PORT_TRIES = 20;
/** Environment variable for dev mode (the Vite dev server origin is accepted). */
export const UI_DEV_ENV = "PIKABAN_UI_DEV";

export interface ServerOptions {
  /** The folder of `.pikaban_config.json` (the same as the CLI: PIKABAN_HOME or the home folder). */
  homeDir: string;
  /** Default: DEFAULT_PORT. 0 lets the system select a free port. */
  port?: number;
  /** If true, a port in use is an error. If false, the server tries the next ports. Default: false. */
  strictPort?: boolean;
  /** Default: 127.0.0.1. Do not bind to other interfaces (design 7.4). */
  host?: string;
  /** The built UI. Default: `dist/ui/` next to the running module. */
  uiDir?: string;
  /** Accept the Vite dev server origin (http://localhost:5173). Default: false. */
  dev?: boolean;
  /** For tests. Default: 30 s. */
  heartbeatMs?: number;
  /** For tests. Default: 100 ms. */
  debounceMs?: number;
  /** Watcher errors. Default: ignored. */
  onError?: (err: unknown) => void;
}

export interface RunningServer {
  /** For example `http://127.0.0.1:4477/`. */
  url: string;
  port: number;
  host: string;
  uiDir: string;
  /** Ends the SSE streams, stops the watchers and closes the server. */
  close(): Promise<void>;
}

/** Starts the UI server (design 7, plan step 10). */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const host = opts.host ?? DEFAULT_HOST;
  const uiDir = opts.uiDir ?? defaultUiDir();
  const dev = opts.dev ?? false;
  const events = new EventHub(opts.heartbeatMs);
  let port = 0;

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const rawUrl = req.url ?? "/";
    const q = rawUrl.indexOf("?");
    const rawPath = q === -1 ? rawUrl : rawUrl.slice(0, q);
    try {
      checkRequest(req, { port, dev });
      if (!rawPath.startsWith("/")) throw new PikabanError(EXIT_USAGE, "invalid request target");
      if (rawPath === "/api" || rawPath.startsWith("/api/")) {
        void handleApi(req, res, rawPath, { homeDir: opts.homeDir, events });
        return;
      }
      serveStatic(req, res, rawPath, uiDir);
    } catch (err) {
      void failRequest(req, res, err);
    }
  };

  const server = createServer(handler);
  const first = opts.port ?? DEFAULT_PORT;
  const tries = opts.strictPort || first === 0 ? 1 : PORT_TRIES;
  port = await listen(server, host, first, tries);

  const watcher = new PikabanWatcher(opts.homeDir, (e: PikabanEvent) => events.broadcast(e), {
    debounceMs: opts.debounceMs,
    onError: opts.onError,
  });
  try {
    await watcher.start();
  } catch (err) {
    events.close();
    await watcher.close();
    await closeServer(server);
    throw err;
  }

  let closing: Promise<void> | undefined;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  return {
    url: `http://${urlHost}:${port}/`,
    port,
    host,
    uiDir,
    close: () => {
      closing ??= (async () => {
        events.close();
        await watcher.close();
        await closeServer(server);
      })();
      return closing;
    },
  };
}

/** Listens on `port`, or on the next ports if it is in use (`tries` ports in total). Returns the port. */
async function listen(server: Server, host: string, port: number, tries: number): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const p = port + i;
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(p, host);
      });
      return (server.address() as AddressInfo).port;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || p > 65535) {
        throw new PikabanError(EXIT_GENERAL, `cannot start the server on ${host}:${p}: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
  }
  const range = tries === 1 ? `Port ${port} is` : `Ports ${port} to ${port + tries - 1} are`;
  throw new PikabanError(EXIT_GENERAL, `${range} in use. Use --port <n> with a free port.`);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
