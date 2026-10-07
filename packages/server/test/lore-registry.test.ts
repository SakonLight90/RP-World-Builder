import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_LIBRARIES, renderAgent } from "../src/canon/gm-agent.js";
import { hashLibrary, libraryDir, resolveLibraries } from "../src/lore/registry.js";
import { makeWorld } from "./helpers/fixtures.js";

const TEMPLATE = `__FRONTMATTER__

Corpo del prompt.

__BIBLE__

__LIBRERIE__
`;

/** The hash the code must produce for the given files in the given order. */
function shuffledHash(dir: string, order: string[]): string {
  const digest = createHash("sha256");
  for (const rel of order) {
    digest.update(rel);
    digest.update("\0");
    digest.update(readFileSync(join(dir, rel)).toString("binary").replace(/\r\n/g, "\n"), "binary");
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

async function makeLibrary(root: string, id: string, files: Record<string, string>) {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "library.yaml"),
    `id: ${id}\nversion: "1.0.0"\ntitle: "Prova"\ngeneratedAt: "2026-09-30"\nsummary: "Libreria di prova."\n`,
    "utf8",
  );
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  const { hash } = await hashLibrary(dir);
  return { dir, hash };
}

describe("library registry", () => {
  it("rejects an id pointing outside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-"));
    // An id comes from hand-written YAML and ends up inside a permission
    // pattern: if it passed, we'd open any folder.
    expect(() => libraryDir(root, "../Windows")).toThrow(
      /Invalid library id|Library id outside the root/,
    );
    expect(() => libraryDir(root, "..\\Windows")).toThrow();
    expect(() => libraryDir(root, "/etc")).toThrow();
    expect(libraryDir(root, "fallout")).toBe(join(root, "fallout"));
  });

  it("hash changes when content changes and stays stable otherwise", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-"));
    const a = await makeLibrary(root, "fallout", { "a.md": "uno\n" });
    const same = await hashLibrary(a.dir);
    expect(same.hash).toBe(a.hash);

    await writeFile(join(a.dir, "a.md"), "due\n", "utf8");
    const changed = await hashLibrary(a.dir);
    expect(changed.hash).not.toBe(a.hash);
  });

  it("the hash does not depend on line endings", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-"));
    const lf = await makeLibrary(root, "fallout", { "a.md": "uno\ndue\n" });
    const crlfRoot = await mkdtemp(join(tmpdir(), "lore-"));
    const crlf = await makeLibrary(crlfRoot, "fallout", { "a.md": "uno\r\ndue\r\n" });

    expect(crlf.hash).toBe(lf.hash);
  });

  it("the hash does not depend on how names are compared", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-"));
    // Names that code point and locale order differently: an accent, a case and a digit.
    const lib = await makeLibrary(root, "fallout", {
      "Zeta.md": "uno\n",
      "alpha.md": "uno\n",
      "Åre.md": "uno\n",
      "2due.md": "uno\n",
    });

    const byCodePoint = ["2due.md", "Zeta.md", "alpha.md", "library.yaml", "Åre.md"];
    const { hash, fileCount } = await hashLibrary(lib.dir);
    expect(fileCount).toBe(5);
    expect(hash).toBe(shuffledHash(lib.dir, byCodePoint));
  });

  it("reports a missing library without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-"));
    const resolved = await resolveLibraries(root, [{ id: "fallout", version: "1.0.0", hash: "" }]);
    expect(resolved[0]?.state).toBe("missing");
  });

  it("reports drift when the requested hash is no longer the one", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-"));
    const lib = await makeLibrary(root, "fallout", { "a.md": "uno\n" });

    const ok = await resolveLibraries(root, [{ id: "fallout", version: "1.0.0", hash: lib.hash }]);
    expect(ok[0]?.drifted).toBe(false);

    const drifted = await resolveLibraries(root, [
      { id: "fallout", version: "1.0.0", hash: "sha256:vecchio" },
    ]);
    expect(drifted[0]?.drifted).toBe(true);
  });
});

describe("narrator permissions", () => {
  const world = makeWorld();

  it("without libraries opens nothing", () => {
    const agent = renderAgent(world, {}, TEMPLATE, NO_LIBRARIES);
    expect(agent).toContain('"*": deny');
    expect(agent).not.toMatch(/\*\*\/\*\*": allow/);
  });

  it("opens reading only inside the library and writing stays denied everywhere", () => {
    const root = "C:\\progetti\\rpwb\\lore\\fallout";
    const agent = renderAgent(world, {}, TEMPLATE, {
      readableRoots: [root],
      index: "## LIBRERIE\n\nProva",
    });

    // The library path must appear under `external_directory`, the real gate
    // on paths: `grep` and `glob` aren't path-scopable, because opencode
    // compares them with the searched string and pattern, not a path.
    expect(agent).toContain('"C:/progetti/rpwb/lore/fallout/**": allow');
    const extBlock = agent.slice(agent.indexOf("\n  external_directory:"));
    expect(extBlock).toContain('"C:/progetti/rpwb/lore/fallout/**": allow');
    expect(extBlock.indexOf('"*": deny')).toBeLessThan(extBlock.indexOf(": allow"));

    // Reading and search must start, or the narrator never reaches the file:
    // permissions decide whether the call starts, not what's reachable.
    expect(agent).toContain("read: allow");
    expect(agent).toContain("grep: allow");
    expect(agent).toContain("glob: allow");

    // Writing stays denied even inside the library: it's a hashed requirement,
    // and an allowed external_directory inherits workspace defaults, where
    // writes would be allowed.
    const editBlock = agent.slice(agent.indexOf("\n  edit:"), agent.indexOf("\n  bash:"));
    expect(editBlock).toContain('"*": deny');
    expect(editBlock).not.toContain("allow");
    expect(agent).toContain("bash: deny");
    expect(agent).toContain("webfetch: deny");
    expect(agent).toContain("websearch: deny");
  });

  it("passes the library index to the prompt", () => {
    const agent = renderAgent(world, {}, TEMPLATE, {
      readableRoots: ["C:/lore/fallout"],
      index: "## AVAILABLE LORE LIBRARIES",
    });
    expect(agent).toContain("## AVAILABLE LORE LIBRARIES");
    expect(agent).not.toContain("__LIBRARIES__");
  });

  it("doesn't lose the index if the template lacks the placeholder", () => {
    const legacy = `__FRONTMATTER__\n\nCorpo.\n\n__BIBLE__\n`;
    const agent = renderAgent(world, {}, legacy, {
      readableRoots: ["C:/lore/fallout"],
      index: "## AVAILABLE LORE LIBRARIES",
    });
    expect(agent).toContain("## AVAILABLE LORE LIBRARIES");
  });
});
