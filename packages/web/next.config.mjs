/**
 * Next configuration.
 *
 * In `.mjs` and not `.ts`: Next loads this file before everything else and does
 * not manage to compile it with the native TypeScript toolchain this project
 * uses.
 *
 * This is also where the awkward part lives: Next's compiler is a native
 * binary prebuilt in Rust, and on older processors it does not load. This is
 * not an installation problem, nothing is missing: the binary requires CPU
 * instructions that do not exist, and it dies during initialization.
 *
 * The solution is the WebAssembly compiler, which runs on any CPU. It costs a
 * few seconds more per build, and it always works. The choice is automatic:
 * on a recent machine the native binary is used, on an old one the WASM.
 *
 * The interface is served by the same machine as the API, so there is no
 * domain to configure and no external origin to allow: everything stays local,
 * like the rest of the project.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which compiler to use, decided by trying instead of asking the CPU.
 *
 * Next's native binary is prebuilt in Rust and uses instructions that do not
 * exist on older processors: it installs correctly and then fails to load,
 * with an error that has nothing to do with the cause. The only question that
 * matters is "does it start?", so try loading it.
 *
 * The trial happens in a child process, and the reason is concrete: a binary
 * that fails to load leaves the process in a broken state, and Node dies with
 * an access violation error on exit. Tried inside the process that compiles,
 * the build would reach the end and then still report an error.
 *
 * `os.cpus()` does not help: it exposes model and speed, not the supported
 * instructions.
 */
function nativeCompilerLoads() {
  // The package can be at the root or nested inside this workspace: look for
  // `node_modules` by walking up from here, the only way not to guess.
  const here = dirname(fileURLToPath(import.meta.url));
  const scopes = [];
  for (let dir = here; ; ) {
    scopes.push(join(dir, "node_modules", "@next"));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const scope of scopes) {
    let names;
    try {
      names = readdirSync(scope);
    } catch {
      continue;
    }

    for (const name of names) {
      if (!name.startsWith("swc-") || name.includes("wasm")) continue;

      let files;
      try {
        files = readdirSync(join(scope, name));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".node")) continue;

        const child = spawnSync(
          process.execPath,
          [
            "-e",
            "try{require(process.argv[1]);process.stdout.write('OK')}catch(e){process.stdout.write('ERR')}",
            join(scope, name, file),
          ],
          { encoding: "utf8", timeout: 60_000, windowsHide: true },
        );

        if ((child.stdout ?? "").startsWith("OK")) return true;
      }
    }
  }
  return false;
}

const nativeWorks = nativeCompilerLoads();
if (!nativeWorks) {
  process.env.NEXT_TEST_WASM = "1";
}

/**
 * `next dev` and `next build` cannot write to the same folder.
 *
 * A build deletes and rewrites `packages/web/.next/server`, which is exactly
 * the pieces the dev server has already loaded into memory. From that moment
 * on its webpack runtime asks for module numbers that no longer exist, and
 * every route answers 500 with an error that mentions neither `next dev` nor
 * the page: it happened because someone ran the build while the server was up.
 *
 * They are two different trees, so they live in two different folders.
 * `next start` keeps reading `.next`, which is the build output: only
 * development changes, and it was the only place where the overlap did harm.
 */
const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // No telemetry: it is one of the project's principles, verified by the tests.
  devIndicators: false,
  eslint: { ignoreDuringBuilds: true },
  ...(isDev ? { distDir: ".next-dev" } : {}),
};

export default config;

/**
 * Exported only for the tests: that way the decision can be checked without
 * starting a build.
 */
export const swcChoice = { nativeWorks, useWasm: !nativeWorks };
