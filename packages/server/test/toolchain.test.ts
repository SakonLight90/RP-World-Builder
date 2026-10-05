import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPATIBLE_TYPESCRIPT,
  findNodeModules,
  inspectToolchain,
  probeNativeCompiler,
  RECOMMENDED_NEXT,
  toolchainSummary,
} from "../src/toolchain.js";

/**
 * Here the UI compiler is decided, so nothing is guessed.
 *
 * The probe is tested with `node_modules` built in a temp directory: tests
 * must not depend on the running machine, otherwise they'd pass on one
 * workstation and fail on the user's, the opposite of what's needed.
 */

/** A native binary loading without trouble. */
const fakeModule = (name: string): string => {
  const scope = join(name, "..", "..", "node_modules", "@next", name);
  mkdirSync(scope, { recursive: true });
  const file = join(scope, "fake.node");
  writeFileSync(file, "");
  return file;
};

function workspace(versions: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "rpwb-toolchain-"));
  mkdirSync(join(root, "node_modules", "@next"), { recursive: true });
  for (const version of versions) fakeModule(version);
  return join(root, "node_modules");
}

describe("machine requirements", () => {
  it("if the binary loads the native compiler is used", () => {
    const toolchain = inspectToolchain({ outcome: "ok", binary: "swc-win32-x64-msvc" });

    expect(toolchain.compiler).toBe("native");
    expect(toolchain.fix).toBeNull();
    expect(toolchain.consequence).toBe("");
  });

  it("if the binary doesn't load it switches to WASM and explains why", () => {
    const toolchain = inspectToolchain({
      outcome: "failed",
      binary: "swc-win32-x64-msvc",
      problem: "swc-win32-x64-msvc: A dynamic link library (DLL) initialization routine failed.",
    });

    expect(toolchain.compiler).toBe("wasm");

    // the message holds the real error, not a generic version
    expect(toolchain.consequence).toContain("swc-win32-x64-msvc");
    expect(toolchain.consequence).toContain("initialization routine failed");

    // and the remedy is a copyable command
    expect(toolchain.fix).toContain("@next/swc-wasm-nodejs");
  });

  it("if the native binary isn't installed WASM is used without inventing an error", () => {
    const toolchain = inspectToolchain({ outcome: "missing" });

    expect(toolchain.compiler).toBe("wasm");
    expect(toolchain.consequence).toContain("WebAssembly");
    expect(toolchain.consequence).not.toContain("DLL");
  });

  it("declared versions are the ones agreeing with each other", () => {
    const toolchain = inspectToolchain({ outcome: "missing" });

    expect(toolchain.next).toBe(RECOMMENDED_NEXT);
    // Next 15 can't handle TypeScript 7, so the declared version must be 6
    expect(COMPATIBLE_TYPESCRIPT).toMatch(/^6\./);
  });

  it("the server summary tells which compiler is in use", () => {
    const native = toolchainSummary(
      inspectToolchain({ outcome: "ok", binary: "swc-linux-x64-gnu" }),
    );
    expect(native).toContain("native");

    const wasm = toolchainSummary(inspectToolchain({ outcome: "missing" }));
    expect(wasm).toContain("WASM");
  });
});

describe("native binary probe", () => {
  it("on this machine the native binary either loads or not, and the project must say", () => {
    // looks at this project's real `node_modules`: there's no "right" result,
    // the only thing that must not happen is staying in doubt
    const probe = probeNativeCompiler(...findNodeModules(import.meta.dirname));

    expect(["ok", "failed"]).toContain(probe.outcome);

    if (probe.outcome === "ok") {
      // on a recent machine native is fine: WASM must not be needed
      expect(inspectToolchain(probe).compiler).toBe("native");
    } else {
      expect(inspectToolchain(probe).compiler).toBe("wasm");
    }
  });

  it("without installed binaries the probe says so instead of guessing", () => {
    const empty = workspace([]);
    expect(probeNativeCompiler(empty).outcome).toBe("missing");
  });

  it("ignores WASM packages: they're the answer, not the attempt", () => {
    const onlyWasm = workspace(["swc-wasm-nodejs"]);
    expect(probeNativeCompiler(onlyWasm).outcome).toBe("missing");
  });

  it("a missing folder doesn't crash the probe", () => {
    expect(probeNativeCompiler(join(tmpdir(), "rpwb-non-esiste-12345")).outcome).toBe("missing");
  });
});
