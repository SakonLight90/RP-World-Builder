import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Only the tests that really do talk to a model.
 *
 * The unit tests do not belong here: they do not open a server, they do not
 * generate anything, and re-running them only costs worker startup time. The
 * `npm test` command already covers them, in thirteen seconds.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@rpwb/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    env: { RPWB_LIVE: "1" },
    // a slow generation is not a failed test
    testTimeout: 300_000,
    hookTimeout: 180_000,
    pool: "forks",
    // The free models are queued: in parallel the requests slow down and the
    // results become random. Slower and stable beats fast and noisy.
    fileParallelism: false,
  },
});
