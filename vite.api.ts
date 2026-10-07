import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { RunningServer } from "./src/server/index.js";

type ServerModule = typeof import("./src/server/index.js");

const serverEntry = fileURLToPath(new URL("src/server/index.ts", import.meta.url));
/** A change in these folders restarts the API server. */
const serverDirs = ["src/core/", "src/server/"].map((d) => fileURLToPath(new URL(d, import.meta.url)));

/**
 * `npm run dev`: runs the API server from the TypeScript source inside the Vite dev server
 * (one command, no build). Vite sends `/api/...` to it. A change in src/core/ or src/server/
 * restarts it; the board reconnects by itself.
 */
export function pikabanApi(): Plugin {
  return {
    name: "pikaban-api",
    apply: "serve",
    configureServer(vite) {
      // The same folder as the CLI (design: PIKABAN_HOME or the home folder).
      const homeDir = process.env.PIKABAN_HOME ? resolve(process.env.PIKABAN_HOME) : homedir();
      const log = vite.config.logger;
      let api: Promise<RunningServer> | undefined;

      const start = () => {
        api = vite
          .ssrLoadModule(serverEntry)
          .then((m) =>
            (m as ServerModule).startServer({
              homeDir,
              port: 0,
              dev: true,
              onError: (err) => log.error(`[pikaban-api] ${String(err)}`),
            }),
          );
        api.then(
          (s) => log.info(`[pikaban-api] ${s.url} (data: ${homeDir})`, { timestamp: true }),
          (err) => log.error(`[pikaban-api] cannot start: ${(err as Error).stack ?? err}`),
        );
      };
      const stop = async () => {
        const old = api;
        api = undefined;
        await old?.then((s) => s.close()).catch(() => {});
      };

      let timer: NodeJS.Timeout | undefined;
      const onFile = (file: string) => {
        if (!serverDirs.some((d) => file.startsWith(d))) return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          log.info(`[pikaban-api] restart (${file.slice(file.lastIndexOf(sep) + 1)})`, { timestamp: true });
          await stop();
          vite.environments.ssr.moduleGraph.invalidateAll();
          start();
        }, 100);
      };
      vite.watcher.add(serverDirs);
      vite.watcher.on("change", onFile).on("add", onFile).on("unlink", onFile);
      vite.httpServer?.once("close", () => void stop());

      start();
      vite.middlewares.use((req, res, next) => forward(() => api, req, res, next));
    },
  };
}

/** Sends `/api/...` to the API server. The Host header stays `localhost:5173` (accepted in dev mode). */
function forward(
  current: () => Promise<RunningServer> | undefined,
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  if (!req.url?.startsWith("/api/")) return next();
  const fail = (msg: string) => {
    if (res.headersSent) return void res.destroy();
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: 1, message: `dev API server: ${msg}` } }));
  };
  const api = current();
  if (!api) return fail("restarting");
  api.then(
    (s) => {
      const up = request(
        { host: s.host, port: s.port, method: req.method, path: req.url, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", (err) => fail(err.message));
      // SSE: the browser closes /api/events; close the upstream request too.
      res.on("close", () => up.destroy());
      req.pipe(up);
    },
    (err) => fail(`not running (${(err as Error).message}). See the Vite terminal.`),
  );
}
