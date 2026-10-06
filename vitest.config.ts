import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Builds dist/cli.js once. The CLI tests (test/cli) run the built binary.
    globalSetup: ["test/globalSetup.ts"],
  },
});
