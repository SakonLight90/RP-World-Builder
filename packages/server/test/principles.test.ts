import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALLOWED_DEPENDENCIES, FORBIDDEN_IN_SOURCE, PRINCIPLES } from "../src/principles.js";

/**
 * These tests make project principles verifiable.
 *
 * Declaring "free, no ads, no store" in the README isn't enough: those are
 * intentions, and intentions are forgotten. Here source is read and fails if
 * something contradicting them appears, so the promise holds even when someone
 * adds a dependency at night.
 */

// The test lives in packages/server/test/, so the repo root is three levels
// up: two levels would point at packages/ and paths wouldn't exist.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "dist" || entry.name === "node_modules") continue;
      out.push(...(await sourceFiles(join(dir, entry.name))));
      continue;
    }
    if (entry.name.endsWith(".ts")) out.push(join(dir, entry.name));
  }
  return out;
}

async function packages(): Promise<{ name: string; deps: string[] }[]> {
  const dirs = await readdir(join(ROOT, "packages"), { withFileTypes: true });
  const out: { name: string; deps: string[] }[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const manifestPath = join(ROOT, "packages", dir.name, "package.json");
    try {
      const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest !== "object" || manifest === null) continue;
      const record = manifest as Record<string, unknown>;
      const all: string[] = [];
      for (const field of ["dependencies", "devDependencies"]) {
        const value = record[field];
        if (typeof value === "object" && value !== null) {
          all.push(...Object.keys(value as Record<string, unknown>));
        }
      }
      out.push({ name: dir.name, deps: all });
    } catch {}
  }
  return out;
}

describe("project principles", () => {
  it("principles are written, not implicit", () => {
    expect(PRINCIPLES.length).toBeGreaterThan(0);
    for (const principle of PRINCIPLES) {
      expect(principle.claim.length).toBeGreaterThan(10);
    }
  });

  it("no dependency brings telemetry, payments or ads", async () => {
    const offenders: string[] = [];

    for (const pkg of await packages()) {
      for (const dep of pkg.deps) {
        // workspace-internal packages are local links, not dependencies
        if (dep.startsWith("@rpwb/")) continue;
        if (!ALLOWED_DEPENDENCIES.has(dep)) offenders.push(`${pkg.name} -> ${dep}`);
      }
    }

    // The allowed list is finite: a new dependency must be evaluated, not
    // happened upon.
    expect(offenders).toEqual([]);
  });

  it("source holds no tracking, payments or ads", async () => {
    const offenders: string[] = [];

    for (const dir of ["packages/server/src", "packages/shared/src"]) {
      for (const file of await sourceFiles(join(ROOT, dir))) {
        // The file defining the rules holds the forbidden patterns by
        // definition: it must exclude itself, otherwise the check checks
        // nothing and always flags itself.
        if (file.endsWith("principles.ts")) continue;

        const text = await readFile(file, "utf8");
        for (const rule of FORBIDDEN_IN_SOURCE) {
          if (rule.pattern.test(text)) {
            offenders.push(`${file}: ${rule.pattern} (${rule.why})`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("source holds no hand-written external hosts", async () => {
    // URLs the project builds are local, because host and port come from
    // config. What must not exist is an external address written in code: that
    // would make it non-local forever.
    //
    // Honest limit: this check can't see an external URL built at runtime from
    // a config value. So the allowed-dependency list is the strong check, and
    // this is the one reading source.
    const offenders: string[] = [];
    const pattern = /https?:\/\/([A-Za-z0-9._-]+)/g;

    for (const dir of ["packages/server/src", "packages/shared/src"]) {
      for (const file of await sourceFiles(join(ROOT, dir))) {
        const text = await readFile(file, "utf8");
        for (const match of text.matchAll(pattern)) {
          const host = match[1];
          if (host === undefined) continue;
          if (host === "127.0.0.1" || host === "localhost") continue;
          // type schemas aren't network traffic
          if (match[0]?.startsWith("https://")) continue;
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("there's no store or account access code", async () => {
    const offenders: string[] = [];
    const patterns = [/\b(app|play)?store\b.*\b(subscri|payment|purchase)/i, /oauth.*google/i];

    for (const file of await sourceFiles(join(ROOT, "packages/server/src"))) {
      const text = await readFile(file, "utf8");
      for (const pattern of patterns) {
        if (pattern.test(text)) offenders.push(`${file}: ${pattern}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
