import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli/index.ts",
    server: "src/server/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  // Clean dist/ but keep dist/ui/: Vite builds the UI there (`npm run build` is "tsup && vite build"),
  // and the test setup runs tsup again. tsup adds these patterns after "**/*" (negated: not removed).
  clean: ["!ui/**"],
  // The skill text is part of the package (plan step 7). The installer finds it at
  // dist/skill/SKILL.md, relative to dist/cli.js.
  onSuccess: async () => {
    mkdirSync("dist/skill", { recursive: true });
    copyFileSync("src/skill/SKILL.md", "dist/skill/SKILL.md");
  },
});
