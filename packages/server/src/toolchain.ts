/**
 * Which compiler can run here, and how to find out.
 *
 * The starting point is an uncomfortable observation: the interface is compiled
 * by Next with a native binary prebuilt in Rust, and that binary asks the CPU for
 * instructions not every machine has. On a 2011 processor it simply does not
 * load: it is not a broken install, no file is missing, it is the compiler's own
 * code using instructions that do not exist, and Windows says so with an error
 * that has nothing to do with the real cause.
 *
 * The lesson is that **it must not be guessed**. No lists of CPU names, no
 * `os.cpus()` that does not expose the supported instructions: the only thing
 * that counts is whether the binary starts. So it is tried to be loaded, and the
 * answer is used.
 *
 * The probe is injected so it can be tested without depending on the machine
 * running the test.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Version of Next declared in the project. */
export const RECOMMENDED_NEXT = "15.5.26";

/** TypeScript: Next 15 does not support TypeScript 7, which is the native compiler. */
export const COMPATIBLE_TYPESCRIPT = "6.0.3";

export type Probe =
  /** The binary loaded: the native compiler is fine. */
  | { outcome: "ok"; binary: string }
  /** The binary is there but does not load: it is almost always the CPU. */
  | { outcome: "failed"; binary: string; problem: string }
  /** The native binary is not installed on this platform. */
  | { outcome: "missing" };

export interface Toolchain {
  /** Version of Next declared in the project. */
  next: string;
  /** The compiler to use for the interface. */
  compiler: "native" | "wasm";
  /** Outcome of the attempt to load the native binary. */
  probe: Probe;
  /** TypeScript version compatible with Next. */
  typescript: string;
  /** Command to run to fix things, when needed. */
  fix: string | null;
  /** What happens if nothing is done, in plain words. */
  consequence: string;
}

/**
 * Searches for `node_modules` walking up from the given directory, until it finds
 * the one containing the native binaries.
 *
 * It is needed because packages can be installed at the project root or nested
 * in a workspace, and the two places cannot be known in advance.
 */
export function findNodeModules(start: string): string[] {
  const found: string[] = [];
  let current = resolve(start);

  while (true) {
    const candidate = join(current, "node_modules");
    if (existsSync(candidate)) found.push(candidate);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return found;
}

/**
 * Tries to load a binary in a child process, not in this one.
 *
 * It is not fussiness. A binary that does not load leaves the process in a broken
 * state: it has been seen here that after the error Node dies with an access
 * violation as soon as it exits. If the test happened inside the process that is
 * compiling, the build would finish and then the command would still return an
 * error. In a child process the failure is a normal exit code.
 */
function tryLoadIsolated(file: string): { ok: boolean; problem: string } {
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "try{require(process.argv[1]);process.stdout.write('OK')}catch(e){process.stdout.write('ERR:'+(e&&e.message||String(e)))}",
      file,
    ],
    { encoding: "utf8", timeout: 60_000, windowsHide: true },
  );

  if (child.error) return { ok: false, problem: child.error.message };

  const stdout = child.stdout ?? "";
  if (stdout.startsWith("OK")) return { ok: true, problem: "" };

  if (stdout.startsWith("ERR:")) {
    return { ok: false, problem: stdout.slice(4).split("\n")[0] ?? "load refused" };
  }

  // no output: the process died. That is the worst case, and it has to be said.
  return {
    ok: false,
    problem: `the process died while loading (code ${String(child.status)})`,
  };
}

/**
 * Finds the installed native SWC binaries and tries to load them.
 *
 * A package is not chosen from a list of platforms: what is really there is
 * looked at and tried. A package for the wrong platform simply does not exist, so
 * there is nothing to guess.
 */
export function probeNativeCompiler(...nodeModulesPaths: string[]): Probe {
  const failures: string[] = [];

  for (const nodeModules of nodeModulesPaths) {
    const scope = join(nodeModules, "@next");

    let names: string[];
    try {
      names = readdirSync(scope);
    } catch {
      continue;
    }

    for (const name of names) {
      // `swc-wasm` is the compiler in WebAssembly: it is the answer, not the attempt.
      if (!name.startsWith("swc-") || name.includes("wasm")) continue;

      let files: string[];
      try {
        files = readdirSync(join(scope, name));
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".node")) continue;
        const attempt = tryLoadIsolated(join(scope, name, file));
        if (attempt.ok) return { outcome: "ok", binary: name };
        failures.push(`${name}: ${attempt.problem}`);
      }
    }
  }

  const first = failures[0] ?? "";
  if (first !== "") {
    return { outcome: "failed", binary: first.split(":")[0] ?? "unknown", problem: first };
  }
  return { outcome: "missing" };
}

export function inspectToolchain(probe: Probe): Toolchain {
  const native = probe.outcome === "ok";

  return {
    next: RECOMMENDED_NEXT,
    compiler: native ? "native" : "wasm",
    probe,
    typescript: COMPATIBLE_TYPESCRIPT,
    fix: native
      ? null
      : "npm install --save-dev --workspace @rpwb/web @next/swc-wasm-nodejs@^15.5.0",
    consequence: native
      ? ""
      : probe.outcome === "failed"
        ? `Next's native compiler (${probe.binary}) is installed but does not load: ${probe.problem}. Almost always it is the processor, which lacks the required instructions. The project therefore falls back to the WebAssembly compiler, which runs everywhere.`
        : "There is no native compiler for this platform. The project uses the WebAssembly one, which runs everywhere.",
  };
}

/** One line for the server log. */
export function toolchainSummary(toolchain: Toolchain): string {
  if (toolchain.probe.outcome === "ok") {
    return `interface: Next ${toolchain.next}, native compiler (${toolchain.probe.binary})`;
  }
  return `interface: Next ${toolchain.next}, WASM compiler (the native binary does not load: ${toolchain.probe.outcome})`;
}
