import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: vitest carries its own copy of
// vite, and mixing the two config types in one file makes the plugin types
// irreconcilable. Nothing here needs the app's plugins — vitest transforms
// TSX through esbuild using the project's tsconfig.
export default defineConfig({
  test: {
    // Engine tests are pure and fastest in node; components need a DOM, and
    // opt in by living under src/components/__tests__.
    environmentMatchGlobs: [["src/components/__tests__/**", "jsdom"]],
    setupFiles: ["./src/components/__tests__/setup.ts"],
  },
});
