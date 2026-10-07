/*
 * Which compiler can run here, and how to find out.
 *
 * Next compiles the interface with a native Rust binary that asks the CPU for instructions
 * not every machine has; on an old processor it does not load, and Windows reports it as
 * something unrelated to the real cause.
 *
 * So it must not be guessed: no CPU name lists, and `os.cpus()` does not expose the supported
 * instructions. Only whether the binary starts counts, so it is tried and the answer used.
 *
 * The probe is injected, so the tests do not depend on the machine running them.
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
 * Searches for `node_modules` walking up from `start`, until it finds the one holding the
 * native binaries: packages can be installed at the root or nested in a workspace.
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
 * A binary that does not load leaves the process broken: Node has been seen dying with an
 * access violation on exit, which would finish the build and still return an error.
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

  // No output: the process died, which has to be said as such.
  return {
    ok: false,
    problem: `the process died while loading (code ${String(child.status)})`,
  };
}

/**
 * Finds the installed native SWC binaries and tries to load them.
 *
 * Not chosen from a list of platforms: what is there is looked at and tried, since a package
 * for the wrong platform simply does not exist.
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
      // `swc-wasm` is the answer, not the attempt.
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
