import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Default configuration: only the tests that do not talk to any model.
 *
 * The tests that really do generate responses live in `*.live.test.ts` and
 * cost between 5 and 50 seconds each with the free models. Splitting them out
 * serves a single purpose: keeping `npm test` a check that always runs, instead
 * of turning it into a four-minute command that sooner or later gets skipped.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@rpwb/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "!packages/*/test/**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    env: { RPWB_LIVE: "" },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // "forks" avoids trouble with native modules on Windows
    pool: "forks",
  },
});
