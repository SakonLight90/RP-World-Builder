import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { normalize } from "../canon/inject.js";

/**
 * How a library describes itself.
 *
 * There is no library's name in here: only the levers the engine knows how to
 * work. A library declares in its manifest what format its index has, what an
 * entry's file is called, which words distinguish nothing and what "this entry
 * belongs to the game, it is not just quoted" means. The engine reads the
 * description and knows nothing about Fallout, New Vegas or any other corpus: if
 * another rule is needed, whoever owns the library writes it.
 *
 * The underlying reason is that the engine was not written for one library and
 * was not supposed to be. As long as knowledge of a corpus lived in the code,
 * every other corpus required rewriting the engine, and the engine was therefore
 * the thing that made having two of them impossible.
 */

/** A section of the index: a type of entry, with its index files. */
export interface LoreSection {
  /** Folder, inside the library, that holds the index files of this type. */
  dir: string;
  /**
   * What a sub-index's index file is called, for example `{group}.md`.
   *
   * The sub-index's name is the file's name without the extension this string
   * declares: that is how the engine does not have to know how it is derived. Only
   * the shape of the name is read from the string, not its folder: the files live
   * in the `dir` folder.
   */
  index: string;
}

/**
 * How an entry's file name is built.
 *
 * It lives in the library and not in the engine because it is a convention of
 * whoever wrote the files: if the generator and the engine computed it in two
 * places, one day the first would rename and the second would keep looking for the
 * old name, and the entry would be there but would not open.
 */
export interface LoreSlugRule {
  /** `slug` = only the normalised name. `slug-hash` = name plus a tag of the title. */
  strategy: "slug" | "slug-hash";
  /** How many characters the normalised name keeps. */
  maxLength: number;
  /** How many hash characters are added, to avoid different names for homonyms. */
  hashLength: number;
  /** Hash algorithm: sha1 is the one the generator wrote the files with. */
  hash: string;
  /** Name to use when the title leaves nothing usable. */
  fallback: string;
}

/** The words the engine uses to hook onto a name the player writes short. */
export interface LoreMatchingRule {
  /** Below this length a name identifies nothing and generates noise. */
  minNameLength: number;
  /** First words that distinguish nothing, because they repeat in the canon. */
  ignoreWords: Set<string>;
  /** Name shapes that are not names: section headings, containers. */
  ignoreNamePatterns: RegExp[];
}

/** How an entry the library owns is told apart from one it only quotes. */
export interface LorePrimaryRule {
  /** The category has to end with the entry type's name. */
  sectionSuffix: boolean;
  /** Categories that quote the entry instead of owning it. */
  excludePatterns: RegExp[];
}

/** The vocabulary of records: how this library calls its columns. */
export interface LoreFields {
  name: string;
  aliases: string;
  categories: string;
  /** Optional: if present, the record carries the entry's path with it. */
  file: string;
}

export interface LoreDescriptor {
  /** Index format: which adapter can read it. */
  adapter: string;
  /** Entry type -> index section that lists it. */
  sections: Record<string, LoreSection>;
  fields: LoreFields;
  /** How the entry's path is derived from the record that lists it. */
  entryPath: string;
  slug: LoreSlugRule;
  matching: LoreMatchingRule;
  primary: LorePrimaryRule;
}

const DEFAULT_SLUG: LoreSlugRule = {
  strategy: "slug",
  maxLength: 70,
  hashLength: 0,
  hash: "sha1",
  fallback: "entry",
};

const DEFAULT_MIN_NAME_LENGTH = 5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A relative path that does not escape the library containing it.
 *
 * It is needed in three different places and for the same reason: a path that
 * escapes the library's folder ends up in a permission and in a `readFile`, so it
 * becomes a read the narrator should not be able to do. It is not enough for the
 * path to look relative: `..` inside a string that looks harmless is exactly what
 * is needed, and on Windows also `C:` and a leading slash.
 */
export function isSafeRelative(value: string): boolean {
  if (value === "" || value.includes("\0")) return false;
  if (/^[a-zA-Z]:/.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\")) return false;
  return value.split(/[\\/]+/).every((part) => part !== "" && part !== "." && part !== "..");
}

/** Compiles the patterns declared by the library: they are data, and data can be wrong. */
function compilePatterns(value: unknown): RegExp[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: RegExp[] = [];
  for (const item of value) {
    const pattern = text(item);
    if (pattern === null) return null;
    try {
      out.push(new RegExp(pattern, "i"));
    } catch {
      return null;
    }
  }
  return out;
}

function readSlug(raw: unknown): LoreSlugRule | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_SLUG };
  if (!isRecord(raw)) return null;
  const strategy = raw.strategy === undefined ? DEFAULT_SLUG.strategy : text(raw.strategy);
  if (strategy !== "slug" && strategy !== "slug-hash") return null;
  const maxLength = raw.maxLength === undefined ? DEFAULT_SLUG.maxLength : raw.maxLength;
  const hashLength = raw.hashLength === undefined ? DEFAULT_SLUG.hashLength : raw.hashLength;
  const hash = text(raw.hash) ?? DEFAULT_SLUG.hash;
  const fallback = text(raw.fallback) ?? DEFAULT_SLUG.fallback;
  if (typeof maxLength !== "number" || !Number.isInteger(maxLength) || maxLength <= 0) return null;
  if (typeof hashLength !== "number" || !Number.isInteger(hashLength) || hashLength < 0)
    return null;
  return { strategy, maxLength, hashLength, hash, fallback };
}

function readMatching(raw: unknown): LoreMatchingRule | null {
  if (raw === undefined || raw === null) {
    return {
      minNameLength: DEFAULT_MIN_NAME_LENGTH,
      ignoreWords: new Set(),
      ignoreNamePatterns: [],
    };
  }
  if (!isRecord(raw)) return null;
  const minNameLength =
    raw.minNameLength === undefined ? DEFAULT_MIN_NAME_LENGTH : raw.minNameLength;
  if (typeof minNameLength !== "number" || !Number.isInteger(minNameLength)) return null;
  const words = raw.ignoreWords === undefined || raw.ignoreWords === null ? [] : raw.ignoreWords;
  if (!Array.isArray(words)) return null;
  const ignoreWords = new Set<string>();
  for (const word of words) {
    const value = text(word);
    if (value === null) return null;
    ignoreWords.add(normalize(value));
  }
  const ignoreNamePatterns = compilePatterns(raw.ignoreNamePatterns);
  if (ignoreNamePatterns === null) return null;
  return { minNameLength, ignoreWords, ignoreNamePatterns };
}

function readPrimary(raw: unknown): LorePrimaryRule | null {
  if (raw === undefined || raw === null) return { sectionSuffix: true, excludePatterns: [] };
  if (!isRecord(raw)) return null;
  const sectionSuffix = raw.sectionSuffix === undefined ? true : raw.sectionSuffix;
  if (typeof sectionSuffix !== "boolean") return null;
  const excludePatterns = compilePatterns(raw.excludePatterns);
  if (excludePatterns === null) return null;
  return { sectionSuffix, excludePatterns };
}

/**
 * The vocabulary of records.
 *
 * `name` is mandatory because without a name there is no entry: a descriptor
 * that omits it is broken, not minimal.
 */
function readFields(raw: unknown): LoreFields | null {
  if (!isRecord(raw)) return null;
  const name = text(raw.name);
  if (name === null) return null;
  return {
    name,
    aliases: text(raw.aliases) ?? "",
    categories: text(raw.categories) ?? "",
    file: text(raw.file) ?? "",
  };
}

function readSections(raw: unknown): Record<string, LoreSection> | null {
  if (!isRecord(raw)) return null;
  const sections: Record<string, LoreSection> = {};
  for (const [kind, value] of Object.entries(raw)) {
    if (kind === "" || !isRecord(value)) return null;
    const dir = text(value.dir) ?? kind;
    const index = text(value.index);
    // `dir` and `index` end up in a `join` and in a `readdir`: if they contained
    // `..`, the library would read outside itself without anyone having written
    // it.
    if (!isSafeRelative(dir) || index === null || !isSafeRelative(index)) return null;
    sections[kind] = { dir, index };
  }
  if (Object.keys(sections).length === 0) return null;
  return sections;
}

/**
 * Reads the `layout` block of a manifest.
 *
 * It returns `null` when there is none or when it is wrong, and does not throw: a
 * library with a broken descriptor must stay openable as a folder to read,
 * simply with no entries to look for. Throwing here would make the world
 * unreachable exactly when the problem is the library.
 */
export function readDescriptor(raw: unknown): LoreDescriptor | null {
  if (!isRecord(raw)) return null;
  const adapter = text(raw.adapter);
  const entryPath = text(raw.entryPath);
  if (adapter === null || entryPath === null) return null;
  if (!isSafeRelative(entryPath.replace(/\{[^}]*\}/g, "x"))) return null;
  const sections = readSections(raw.sections);
  const fields = readFields(raw.fields);
  const slug = readSlug(raw.slug);
  const matching = readMatching(raw.matching);
  const primary = readPrimary(raw.primary);
  if (sections === null || fields === null || slug === null || matching === null) return null;
  if (primary === null) return null;
  return { adapter, sections, fields, entryPath, slug, matching, primary };
}

/**
 * An entry's file name, derived from the record that lists it.
 *
 * If the record carries the path, that is the path: that is the case where the
 * naming criterion is not reconstructible and the library has to say it entry by
 * entry. Otherwise the declared template is expanded, and that is the only place
 * the naming convention is written down.
 */
export function entryFileFor(
  layout: LoreDescriptor,
  ctx: { subject: string; group: string; kind: string; section: string },
  declared?: string,
): string | null {
  const fromRecord = declared?.trim() ?? "";
  if (fromRecord !== "") return isSafeRelative(fromRecord) ? fromRecord : null;
  return expandPath(layout.entryPath, {
    slug: slugFor(ctx.subject, layout.slug),
    subject: ctx.subject,
    group: ctx.group,
    kind: ctx.kind,
    section: ctx.section,
  });
}

/**
 * Expands the declared placeholders.
 *
 * A placeholder the engine cannot fill makes the path unreliable, and an
 * unreliable path means an entry that does not go into the index: no entry is
 * better than an entry read from the wrong file.
 */
export function expandPath(template: string, values: Record<string, string>): string | null {
  let unknown = false;
  const out = template.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const value = values[token];
    if (value === undefined) {
      unknown = true;
      return "";
    }
    return value;
  });
  if (unknown) return null;
  return isSafeRelative(out) ? out : null;
}

export function slugFor(subject: string, rule: LoreSlugRule): string {
  const base =
    subject
      .normalize("NFKD")
      .replace(/[\u0300-\u030f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, rule.maxLength) || rule.fallback;
  if (rule.strategy !== "slug-hash" || rule.hashLength <= 0) return base;
  const tag = createHash(rule.hash).update(subject).digest("hex").slice(0, rule.hashLength);
  return `${base}-${tag}`;
}

/**
 * The index files' extension, taken from the declared template.
 *
 * It is needed to list the right files and to derive the sub-index's name: the
 * engine must not know that that library's indexes end in `.md`.
 */
export function indexExtension(template: string): string {
  const base = template.slice(template.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

/** The sub-index's name: the file's name without the declared extension. */
export function groupFromFile(file: string, extension: string): string {
  if (extension === "" || !file.endsWith(extension)) return file;
  return file.slice(0, file.length - extension.length);
}

/** A section's index files, in order: the order keeps the index reproducible. */
export async function listIndexFiles(dir: string, extension: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => extension === "" || name.endsWith(extension)).sort();
  } catch {
    return [];
  }
}

/**
 * The first useful word of the name is a search key too.
 *
 * Without it, a name like "Mojave Wasteland" is only found if the player writes it
 * in full, and nobody writes it in full: the text says "Mojave", the library says
 * "Mojave Wasteland", and the right name does not go into the context exactly when
 * the player is using it. Which words are useless is a choice of the library, so
 * the list comes from `ignoreWords`.
 */
export function headKeysFor(subject: string, rule: LoreMatchingRule): string[] {
  const words = normalize(subject)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  for (const word of words) {
    if (rule.ignoreWords.has(word)) continue;
    return [word];
  }
  return [];
}

/** A name is the right one to look for only if it is long enough and it is a name. */
export function isUsefulNameFor(name: string, rule: LoreMatchingRule): boolean {
  if (name.length < rule.minNameLength) return false;
  return !rule.ignoreNamePatterns.some((pattern) => pattern.test(name));
}

const suffixPatterns = new Map<string, RegExp>();

function sectionPattern(kind: string): RegExp {
  const cached = suffixPatterns.get(kind);
  if (cached !== undefined) return cached;
  const built = new RegExp(`${escapeRegex(kind)}$`, "i");
  suffixPatterns.set(kind, built);
  return built;
}

/**
 * Does the entry really belong to this type, or is it only mentioned?
 *
 * The answer is given by the categories the library wrote next to the name: they
 * are a datum, not the engine's opinion. Which categories count as a quotation
 * and which do not is a choice of that library, so it comes from `primary` and
 * not from here.
 */
export function isPrimaryFor(
  categories: readonly string[],
  kind: string,
  rule: LorePrimaryRule,
): boolean {
  if (categories.length === 0) return false;
  for (const raw of categories) {
    const category = raw.trim();
    if (category === "") continue;
    if (rule.sectionSuffix && !sectionPattern(kind).test(category)) continue;
    if (rule.excludePatterns.some((pattern) => pattern.test(category))) continue;
    return true;
  }
  return false;
}

/**
 * A record's weight: the longer the name, the more specific it is.
 *
 * It is here because it is not a property of any particular library, but it is
 * still a choice declared by the engine and not a fact about the data: a long
 * name is usually more precise than a short one.
 */
export function weightFor(subject: string): number {
  return subject.length;
}
