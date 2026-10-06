import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLI } from "../cli/run.js";
import { freePort, makeEnv, request, type Env } from "./helpers.js";

let env: Env;
let child: ChildProcess | undefined;
let blocker: Server | undefined;

beforeEach(() => {
  env = makeEnv();
});
afterEach(async () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  child = undefined;
  await new Promise<void>((r) => (blocker ? blocker.close(() => r()) : r()));
  blocker = undefined;
  env.cleanup();
});

function runUi(args: string[]): { proc: ChildProcess; output: () => { stdout: string; stderr: string }; exited: Promise<number | null> } {
  const proc = spawn(process.execPath, [CLI, "ui", ...args], {
    cwd: env.base,
    env: { ...process.env, TRACKER_HOME: env.home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  let stdout = "";
  let stderr = "";
  proc.stdout!.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  proc.stderr!.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const exited = new Promise<number | null>((r) => proc.on("exit", (code) => r(code)));
  return { proc, output: () => ({ stdout, stderr }), exited };
}

/** Waits until stdout has the URL line. */
async function waitForUrl(output: () => { stdout: string; stderr: string }, exited: Promise<unknown>): Promise<string> {
  const deadline = Date.now() + 10_000;
  let done = false;
  void exited.then(() => (done = true));
  while (Date.now() < deadline) {
    const m = /Tracker UI: (http:\/\/\S+)/.exec(output().stdout);
    if (m) return m[1]!;
    if (done) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no URL. stdout: ${output().stdout} stderr: ${output().stderr}`);
}

describe("tracker ui", () => {
  it("--no-open --port <n> starts the server, answers GET /api/projects, and stops on SIGINT", async () => {
    const { pid } = env.project("alpha");
    const port = await freePort();
    const { proc, output, exited } = runUi(["--no-open", "--port", String(port)]);
    const url = await waitForUrl(output, exited);
    expect(url).toBe(`http://127.0.0.1:${port}/`);

    const r = await request(port, "GET", "/api/projects");
    expect(r.status).toBe(200);
    expect(r.json).toEqual([expect.objectContaining({ pid, name: "alpha", status: "ok" })]);

    proc.kill("SIGINT");
    expect(await exited).toBe(0);
    expect(output().stderr).toContain("stopped");
    await expect(request(port, "GET", "/api/projects")).rejects.toThrow();
  });

  it("--port with a port in use stops with an error", async () => {
    const port = await freePort();
    blocker = createServer();
    await new Promise<void>((r) => blocker!.listen(port, "127.0.0.1", () => r()));
    const { output, exited } = runUi(["--no-open", "--port", String(port)]);
    expect(await exited).toBe(1);
    expect(output().stderr).toContain(`Port ${port} is in use`);
  });

  it("an invalid --port gives exit code 2", async () => {
    const { output, exited } = runUi(["--no-open", "--port", "abc"]);
    expect(await exited).toBe(2);
    expect(output().stderr).toContain("invalid port");
  });

  it("--json writes the URL as JSON", async () => {
    const port = await freePort();
    const { proc, output, exited } = runUi(["--no-open", "--port", String(port), "--json"]);
    const deadline = Date.now() + 10_000;
    while (!output().stdout.includes("}") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(JSON.parse(output().stdout)).toEqual({ url: `http://127.0.0.1:${port}/`, port });
    proc.kill("SIGTERM");
    expect(await exited).toBe(0);
  });
});
