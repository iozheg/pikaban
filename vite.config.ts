import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { pikabanApi } from "./vite.api.js";

const root = fileURLToPath(new URL("src/ui/", import.meta.url));
const outDir = fileURLToPath(new URL("dist/ui/", import.meta.url));

/** Build of the browser UI to dist/ui/ (plan step 11). The UI server serves it from `./ui` next to dist/cli.js. */
export default defineConfig({
  root,
  base: "/",
  plugins: [preact(), pikabanApi()],
  build: {
    outDir,
    // outDir is outside `root`: Vite cleans it only with this option. It cleans only dist/ui/.
    emptyOutDir: true,
    // The server CSP allows scripts only from 'self'. The polyfill is not necessary in current browsers.
    modulePreload: { polyfill: false },
    target: "es2022",
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
