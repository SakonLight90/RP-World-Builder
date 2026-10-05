import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { isSafeRelative, type LoreDescriptor, readDescriptor } from "./layout.js";

/**
 * Lore libraries: read-only files that worlds **require**.
 *
 * The rule holding the whole mechanism together is a single one: the library is
 * never written at runtime. The generator produces it from external sources and
 * then is done; from that moment it is a reference, like a manual on a shelf. A
 * world does not copy it and does not modify it: it names it in `libraries` and
 * reads inside it.
 *
 * The reason is practical before it is aesthetic: the same story (New Vegas's
 * factions, the Vaults, the Enclave) is useful to a 2287 world and to a 2241 one.
 * If the lore lived inside the world, every world would have its own copy and the
 * copies would diverge. If it is a library, a new world rewrites nothing.
 *
 * The hash is what makes the requirement verifiable. A world declaring
 * `fallout@1.0.0` with a hash legitimately means that version; if the library on
 * disk has changed, validation says so, instead of letting the campaign derive
 * from sources other than the ones declared when it was written.
 *
 * There is no knowledge of any library here: the registry resolves the
 * requirement, reads the manifest and brings in the `layout` the manifest
 * declares. Whoever knows that a `layout` is a certain format is an adapter, and
 * it lives in `adapters/`.
 */

export interface LibraryRequirement {
  id: string;
  version: string;
  hash: string;
}

export interface LibraryManifest {
  id: string;
  version: string;
  title: string;
  generatedAt: string;
  summary: string;
  /**
   * How the library describes itself, if it does.
   *
   * `null` means the manifest does not declare it: the library is read with the
   * historical format, and a new library should declare it.
   */
  layout: LoreDescriptor | null;
}

export interface ResolvedLibrary {
  requirement: LibraryRequirement;
  manifest: LibraryManifest | null;
  /** Absolute path of the library's folder. */
  dir: string;
  /** Hash of the content actually present on disk, formatted as `sha256:...`. */
  actualHash: string;
  /** `missing` = absent, `unreadable` = present but the manifest does not read. */
  state: "ok" | "missing" | "unreadable";
  /** Divergence between required hash and real hash, if any. */
  drifted: boolean;
  /** Number of content files present. */
  fileCount: number;
  /** Layout declared by the manifest, repeated here so it is not reread on every use. */
  layout: LoreDescriptor | null;
}

const MANIFEST_FILE = "library.yaml";
const IGNORED = new Set([".git", "node_modules", ".DS_Store", "Thumbs.db"]);

/**
 * A library's path, with a path-traversal check.
 *
 * The id comes from a hand-written YAML file or from a form: without this check,
 * `libraries: [{id: "../../Windows"}]` would point outside the library and the
 * permissions generated for the agent would end up opening that folder. The
 * permission we grant is built from this string, so the string has to be validated
 * as if it were hostile input.
 *
 * `root` comes from outside and comes from `config/paths.ts`, the only place that
 * knows where the repository is and how the roots are changed. There is no `lore/`
 * written anywhere in here: if this module derived the root on its own, there
 * would be two places answering the same question, and the second would start
 * giving a different answer than the first the day somebody moves a library.
 */
export function libraryDir(root: string, id: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`Invalid library id: ${JSON.stringify(id)}`);
  }
  const dir = resolve(root, id);
  const rootWithSep = resolve(root) + sep;
  if (!dir.startsWith(rootWithSep)) {
    throw new Error(`Library id outside the root: ${JSON.stringify(id)}`);
  }
  return dir;
}

/**
 * An entry's path inside the library, with the same check as `libraryDir`.
 *
 * The same danger, one step deeper: the id comes from a world, the entry's path
 * comes from the library's descriptor or from the record that lists it, and it
 * ends up in `readFile` and in the permissions the narrator carries with it. A
 * `../../` in that string would open a file outside the required library, so
 * here a relative path made of normal segments is required and the result is
 * checked again once resolved.
 */
export function libraryPath(root: string, relative: string): string {
  if (!isSafeRelative(relative)) {
    throw new Error(`Invalid entry path: ${JSON.stringify(relative)}`);
  }
  const rootAbs = resolve(root);
  const path = resolve(rootAbs, ...relative.split(/[\\/]+/));
  if (path === rootAbs || !path.startsWith(rootAbs + sep)) {
    throw new Error(`Entry path outside the library: ${JSON.stringify(relative)}`);
  }
  return path;
}

async function walkFiles(dir: string, base = dir): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, base)));
    } else if (entry.isFile()) {
      files.push(full.slice(base.length + 1));
    }
  }
  return files;
}

/**
 * Hash of the library's content.
 *
 * It covers the path and the bytes of every file, in a stable order: change a
 * file and the hash changes, but moving a line changes nothing, so the hash
 * signals a content change and not formatting noise.
 */
export async function hashLibrary(dir: string): Promise<{ hash: string; fileCount: number }> {
  const files = await walkFiles(dir);
  const digest = createHash("sha256");
  for (const rel of files) {
    digest.update(rel.replace(/\\/g, "/"));
    digest.update("\0");
    digest.update(await readFile(join(dir, rel)));
    digest.update("\0");
  }
  return { hash: `sha256:${digest.digest("hex")}`, fileCount: files.length };
}

async function readManifest(dir: string): Promise<LibraryManifest | null> {
  try {
    const raw = await parseYaml(await readFile(join(dir, MANIFEST_FILE), "utf8"));
    if (raw === null || typeof raw !== "object") return null;
    const m = raw as Record<string, unknown>;
    return {
      id: String(m.id ?? ""),
      version: String(m.version ?? ""),
      title: String(m.title ?? m.id ?? ""),
      generatedAt: String(m.generatedAt ?? ""),
      summary: String(m.summary ?? ""),
      // A library that knows how to describe itself does it in the manifest: the
      // registry does not guess the format, it takes it. If the block is missing
      // or broken it stays `null` and the library is read with the historical
      // format.
      layout: readDescriptor(m.layout),
    };
  } catch {
    return null;
  }
}

/**
 * Resolves a world's requirements against the disk.
 *
 * It does not throw: a world with a missing library must still be loadable, and
 * the diagnosis arrives as a validation problem, where the user reads it.
 * Failing here would make the world unreachable exactly when the problem is the
 * library itself.
 */
export async function resolveLibraries(
  root: string,
  requirements: LibraryRequirement[],
): Promise<ResolvedLibrary[]> {
  const resolved: ResolvedLibrary[] = [];
  for (const requirement of requirements) {
    let dir: string;
    try {
      dir = libraryDir(root, requirement.id);
    } catch {
      resolved.push({
        requirement,
        manifest: null,
        dir: "",
        actualHash: "",
        state: "missing",
        drifted: true,
        fileCount: 0,
        layout: null,
      });
      continue;
    }

    const manifest = await readManifest(dir);
    if (manifest === null) {
      resolved.push({
        requirement,
        manifest: null,
        dir,
        actualHash: "",
        state: "missing",
        drifted: requirement.hash !== "",
        fileCount: 0,
        layout: null,
      });
      continue;
    }

    const { hash, fileCount } = await hashLibrary(dir);
    resolved.push({
      requirement,
      manifest,
      dir,
      actualHash: hash,
      state: "ok",
      drifted: requirement.hash !== "" && requirement.hash !== hash,
      fileCount,
      layout: manifest.layout,
    });
  }
  return resolved;
}

/**
 * Paths to open for reading to the agent.
 *
 * Only libraries really present and intact: opening the permission for a missing
 * library is pointless, and in the case of an unresolved path it would return an
 * empty string which, translated into a pattern, becomes `*`.
 */
export function readableRoots(libraries: ResolvedLibrary[]): string[] {
  return libraries
    .filter((lib) => lib.state === "ok" && isAbsolute(lib.dir))
    .map((lib) => lib.dir)
    .sort();
}

/**
 * Index text to put in the prompt.
 *
 * It goes in the prompt and not in the turn's context for two reasons: it holds
 * the names of the files, not their content, and it is in the system prompt so it
 * survives the session's compaction. The model knows the files exist before the
 * player names them, and can open them at the right moment.
 */
export function libraryIndex(libraries: ResolvedLibrary[]): string {
  const ok = libraries.filter((lib) => lib.state === "ok");
  if (ok.length === 0) return "";

  const blocks = ok.map((lib) => {
    const m = lib.manifest;
    const lines = [
      `### ${m?.title ?? lib.requirement.id} (${lib.requirement.id}@${lib.requirement.version})`,
      "",
      m?.summary ?? "",
      "",
      `Folder: ${lib.dir}`,
    ];
    return lines.filter((line) => line !== "").join("\n");
  });

  return ["## AVAILABLE LORE LIBRARIES", "", ...blocks].join("\n\n");
}
