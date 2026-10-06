import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Builds dist/ once before all tests, so that test/cli runs the real binary and test/ui examines the
 * real UI build. The same steps as `npm run build` (tsup keeps dist/ui/, refer to tsup.config.ts).
 */
export default function setup(): void {
  const root = join(import.meta.dirname, "..");
  const bin = (name: string) => join(root, "node_modules", ".bin", name);
  execFileSync(bin("tsup"), { cwd: root, stdio: "pipe" });
  // vitest sets NODE_ENV=test. Vite and the Preact preset then add debug code. Build as `npm run build` does.
  const env = { ...process.env, NODE_ENV: "production" };
  execFileSync(bin("vite"), ["build", "--logLevel", "error"], { cwd: root, stdio: "pipe", env });
}
