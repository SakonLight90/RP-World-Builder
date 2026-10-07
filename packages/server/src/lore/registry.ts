import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { isSafeRelative, type LoreDescriptor, readDescriptor } from "./layout.js";

/**
 * Lore libraries: read-only files that worlds **require**.
 *
 * The library is never written at runtime. The generator produces it and is done;
 * from that moment it is a reference, and a world names it in `libraries` and reads
 * inside it. Two worlds of different eras share one library instead of keeping copies
 * that diverge.
 *
 * The hash makes the requirement verifiable: declaring `id@1.0.0` with a hash means
 * that version, and validation says so when the library on disk has changed.
 *
 * No knowledge of any library lives here. Knowing that a `layout` is a certain format
 * is an adapter's job, in `adapters/`.
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
   * `null` when the manifest declares nothing: the library is read with the built-in
   * format.
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
 * A library's path, with a traversal check.
 *
 * The id comes from a hand-written file or a form, and the permission granted to the
 * agent is built from this string, so it is validated as hostile input: without the
 * check `libraries: [{id: "../../Windows"}]` would open that folder.
 *
 * The root comes from `config/paths.ts` and from nowhere else: a second place
 * answering where the library is would eventually answer differently.
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
 * An entry's path inside the library.
 *
 * Checked like the library id and for the same reason: it reaches a `readFile` and
 * the permissions, so a `../../` would open a file outside the library. Only normal
 * segments are accepted and the resolved result is checked again.
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

/** Names compared by code point, so the order is the same on every machine. */
function byCodepoint(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

async function walkFiles(dir: string, base = dir): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of [...entries].sort(byCodepoint)) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, base)));
    } else if (entry.isFile()) {
      files.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
  return files;
}

/** CRLF folded to LF, so the fingerprint does not depend on the checkout. */
function normalizeNewlines(content: Buffer): Buffer {
  if (!content.includes(13)) return content;
  return Buffer.from(content.toString("binary").replace(/\r\n/g, "\n"), "binary");
}

/**
 * Hash of the library's content.
 *
 * Covers the path and the bytes of every file, in code point order and with line endings
 * folded, so the same library gives the same hash wherever it is checked out and whatever
 * the platform's line endings are.
 */
export async function hashLibrary(dir: string): Promise<{ hash: string; fileCount: number }> {
  const files = await walkFiles(dir);
  const digest = createHash("sha256");
  for (const rel of files) {
    digest.update(rel);
    digest.update("\0");
    digest.update(normalizeNewlines(await readFile(join(dir, rel))));
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
 * Never throws: a world with a missing library stays loadable and the diagnosis
 * arrives as a validation problem.
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
 * Only libraries present and intact: a permission for a missing library is pointless,
 * and an unresolved path would become `""`, which as a pattern is `*`.
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
 * In the system prompt and not the turn's context: it lists file names rather than
 * content, and being in the system prompt it survives compaction.
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
