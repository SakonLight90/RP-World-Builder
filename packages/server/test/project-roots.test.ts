import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRoots } from "../src/config/paths.js";
import { validateCorpus } from "../src/corpus/load.js";

/**
 * Project roots are found from any folder.
 *
 * The defect this file covers is silent: the server started from a folder other
 * than the repo root can't find corpus and libraries, and instead of saying "the
 * path is wrong" it says "the library is missing". Reading the message, you look
 * at content rather than at where the command started.
 *
 * Here the proof is backwards from the usual one: no fake root is built, real
 * code runs while the process start folder is a **trap**. The trap holds a
 * `corpus/`, a `lore/` and a `package.json` with `workspaces`: if resolution
 * watched `process.cwd()`, it would take them for the real ones, and the test
 * would pass with the wrong library.
 */

/** This package's folder, derived from this file not the start folder. */
const PACKAGE_DIR = join(import.meta.dirname, "..");

/** Where server code lives: derived from here, not `process.cwd()`. */
const SRC = join(PACKAGE_DIR, "src");

/** A folder looking like a repo that isn't. */
function trap(): string {
  const dir = mkdtempSync(join(tmpdir(), "rpwb-altra-cartella-"));
  mkdirSync(join(dir, "corpus"));
  mkdirSync(join(dir, "lore"));
  writeFileSync(join(dir, "corpus", "mondo-falso.yaml"), "nome: falso\n", "utf8");
  writeFileSync(join(dir, "lore", "falso.yaml"), "id: falso\n", "utf8");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "non-e-il-progetto", workspaces: ["*"] }, null, 2)}\n`,
    "utf8",
  );
  return dir;
}

/** Runs the body with a moved start folder, then restores it. */
function fromOtherFolder<Outcome>(dir: string, body: () => Outcome): Outcome {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return body();
  } finally {
    process.chdir(before);
  }
}

/** As above, for an async body: restores when the body finishes. */
async function fromOtherFolderAsync<Outcome>(
  dir: string,
  body: () => Promise<Outcome>,
): Promise<Outcome> {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return await body();
  } finally {
    process.chdir(before);
  }
}

describe("project roots", () => {
  it("are found with the process started from a repo-looking folder", () => {
    const other = trap();
    try {
      fromOtherFolder(other, () => {
        const roots = resolveRoots();

        // The process start folder isn't the repo, and roots don't even look at
        // it: that's the test's point.
        expect(resolve(process.cwd())).toBe(resolve(other));
        expect(roots.repo).not.toBe(resolve(other));
        expect(roots.corpus).not.toBe(join(resolve(other), "corpus"));
        expect(roots.lore).not.toBe(join(resolve(other), "lore"));
      });
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("really find corpus, libraries and prompts with no config", () => {
    const roots = resolveRoots();

    for (const root of [roots.repo, roots.corpus, roots.lore, roots.prompts, roots.data]) {
      expect(isAbsolute(root)).toBe(true);
    }

    // The repo root carries along the sentinel used to find it: a random folder
    // isn't enough, it must be the right one.
    const manifest: unknown = JSON.parse(readFileSync(join(roots.repo, "package.json"), "utf8"));
    expect(Array.isArray((manifest as { workspaces?: unknown }).workspaces)).toBe(true);

    expect(roots.corpus).toBe(join(roots.repo, "corpus"));
    expect(roots.lore).toBe(join(roots.repo, "lore"));
    expect(roots.worlds).toBe(join(roots.data, "worlds"));

    // And above all: contents exist. A "resolved" root holding nothing is the
    // defect disguised as success.
    expect(readdirSync(roots.corpus).length).toBeGreaterThan(0);
    expect(readdirSync(roots.lore).length).toBeGreaterThan(0);
    expect(readFileSync(join(roots.prompts, "gm.md"), "utf8")).toContain("__BIBLE__");
  });

  it("validate the real corpus even with the process outside the root", async () => {
    const other = trap();
    try {
      await fromOtherFolderAsync(other, async () => {
        const roots = resolveRoots();
        // The path `npm run corpus:validate` follows, the one practically
        // failing: no error, and no library found.
        const problems = await validateCorpus(roots.corpus, roots.lore);
        const errors = problems.filter((problem) => problem.severity === "error");
        expect(errors).toEqual([]);
      });
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("RPWB_REPO_ROOT also moves corpus and libraries", () => {
    const outside = mkdtempSync(join(tmpdir(), "rpwb-repo-esterno-"));
    try {
      withEnv({ RPWB_REPO_ROOT: outside }, () => {
        const roots = resolveRoots();
        expect(roots.repo).toBe(resolve(outside));
        expect(roots.corpus).toBe(join(resolve(outside), "corpus"));
        expect(roots.lore).toBe(join(resolve(outside), "lore"));
        // Prompts stay beside the package: RPWB_REPO_ROOT moves repo contents,
        // not the code reading them.
        expect(roots.prompts).toBe(join(PACKAGE_DIR, "prompts"));
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("each root has its own override winning over the found root", () => {
    const outside = mkdtempSync(join(tmpdir(), "rpwb-override-"));
    try {
      withEnv(
        {
          RPWB_REPO_ROOT: join(outside, "repo"),
          RPWB_CORPUS_ROOT: join(outside, "corpus"),
          RPWB_LORE_DIR: join(outside, "lore"),
          RPWB_PROMPTS_DIR: join(outside, "prompts"),
          RPWB_DATA_DIR: join(outside, "dati"),
        },
        () => {
          const roots = resolveRoots();
          expect(roots.repo).toBe(resolve(join(outside, "repo")));
          expect(roots.corpus).toBe(resolve(join(outside, "corpus")));
          expect(roots.lore).toBe(resolve(join(outside, "lore")));
          expect(roots.prompts).toBe(resolve(join(outside, "prompts")));
          expect(roots.data).toBe(resolve(join(outside, "dati")));
          // Worlds follow data: two overrides for two different folders would
          // produce a world outside its containing folder.
          expect(roots.worlds).toBe(resolve(join(outside, "dati", "worlds")));
        },
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("an empty override doesn't count as override", () => {
    withEnv({ RPWB_CORPUS_ROOT: "   " }, () => {
      const roots = resolveRoots();
      expect(roots.corpus).toBe(join(roots.repo, "corpus"));
    });
  });
});

/**
 * No module derives a root from the process.
 *
 * The test closing the door on whoever puts `process.cwd()` back: it doesn't
 * prove today works, it proves the defect won't return unnoticed. The search
 * looks at code, not comments, because the name appears in explanations on
 * purpose.
 */
describe("no module derives the root from the process", () => {
  it("in the whole server there's no process.cwd() call", () => {
    const culprits: string[] = [];
    for (const file of sources(SRC)) {
      const rows = readFileSync(file, "utf8").split("\n");
      if (codeWithoutComments(rows).includes("process.cwd(")) culprits.push(relative(SRC, file));
    }
    expect(culprits).toEqual([]);
  });
});

/** All TypeScript sources under a folder, recursively. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(join(entry.parentPath, entry.name));
    }
  }
  return found;
}

/**
 * A file's code, stripped of comments.
 *
 * Not a parser: it just avoids mistaking a defect's explanation for the defect.
 * A line with `://` isn't cut, so an address inside a string doesn't eat the
 * rest of the line.
 */
function codeWithoutComments(rows: string[]): string {
  const outside: string[] = [];
  let inBlock = false;
  for (const row of rows) {
    if (inBlock) {
      const end = row.indexOf("*/");
      if (end < 0) continue;
      inBlock = false;
      outside.push(row.slice(end + 2));
      continue;
    }
    const opens = row.indexOf("/*");
    if (opens >= 0 && row.indexOf("*/", opens + 2) < 0) {
      inBlock = true;
      outside.push(row.slice(0, opens));
      continue;
    }
    outside.push(row);
  }
  return outside.join("\n").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Applies env vars only for the body's duration. */
function withEnv<Outcome>(variables: Record<string, string>, body: () => Outcome): Outcome {
  const before = new Map<string, string | undefined>();
  for (const [nameOf, value] of Object.entries(variables)) {
    before.set(nameOf, process.env[nameOf]);
    process.env[nameOf] = value;
  }
  try {
    return body();
  } finally {
    for (const [nameOf, value] of before) {
      if (value === undefined) delete process.env[nameOf];
      else process.env[nameOf] = value;
    }
  }
}
