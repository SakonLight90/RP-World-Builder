import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  entryFileFor,
  escapeRegex,
  groupFromFile,
  headKeysFor,
  indexExtension,
  isPrimaryFor,
  isUsefulNameFor,
  type LoreDescriptor,
  listIndexFiles,
  weightFor,
} from "../layout.js";
import type { LoreLibrary, LoreProvider, LoreRecord } from "../provider.js";
import { libraryPath } from "../registry.js";

/**
 * Adapter for the record-list index.
 *
 * The format is this: one file per sub-index, and inside it lines starting with
 * `- name: "..."` followed by indented lines with the other columns. It is a format
 * the engine did not invent, so it lives here and not in the engine.
 *
 * The column names also come from the library's descriptor: one that writes `title`
 * instead of `name` is read without touching anything. A column the descriptor does not
 * declare is simply not read.
 */

/**
 * How the libraries that already existed described themselves, before the
 * descriptor existed.
 *
 * It stays because a library that does not declare `layout` has to keep working:
 * the server must not notice, on the first start after an update, that a library
 * required by a world has stopped being readable. A new library declares its own
 * `layout` and this value does not concern it.
 */
export function legacyDescriptor(): LoreDescriptor {
  return {
    adapter: "record-list",
    sections: {
      locations: { dir: "locations", index: "{group}.md" },
      factions: { dir: "factions", index: "{group}.md" },
    },
    fields: { name: "name", aliases: "variants", categories: "categories", file: "" },
    entryPath: "entries/{group}/{section}/{slug}.md",
    slug: {
      strategy: "slug-hash",
      maxLength: 70,
      hashLength: 6,
      hash: "sha1",
      fallback: "entry",
    },
    matching: {
      minNameLength: 5,
      ignoreWords: new Set([
        "the",
        "new",
        "old",
        "north",
        "south",
        "east",
        "west",
        "upper",
        "lower",
        "great",
        "big",
        "little",
        "first",
        "second",
        "third",
        "vault",
        "fort",
        "camp",
        "city",
        "town",
        "point",
        "national",
        "state",
        "united",
        "royal",
      ]),
      ignoreNamePatterns: [
        /^(Fallout|New|Category|Unmarked|Marked|Mentioned)\b/i,
        /locations?$/i,
        /factions?$/i,
        / Secondary Locations$/i,
      ],
    },
    primary: {
      sectionSuffix: true,
      excludePatterns: [
        /mentioned[- ]only/i,
        /Secondary Locations$/i,
        /unmarked|marked|shops|roadways/i,
      ],
    },
  };
}

/**
 * A column's value, split into entries.
 *
 * Two shapes, because the format admits both: a list in square brackets and a
 * scalar value. The inner separator is the semicolon, which is what those
 * libraries use to write several labels on one line.
 */
function splitValue(raw: string): string[] {
  const value = raw.trim();
  if (value === "") return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    if (inner.trim() === "") return [];
    return (
      inner
        .split(",")
        // Spaces are stripped before the quotes: stripping them after, an entry
        // like `"Family (Fallout 3)"` would have kept the leading quote attached
        // and the name would have hooked onto nothing again.
        .map((item) => item.trim().replace(/^"|"$/g, ""))
        .filter((item) => item !== "")
    );
  }
  return value
    .replace(/^"/, "")
    .replace(/"$/, "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Every record in the file, with the raw value of the declared columns. */
function parseRecords(raw: string, layout: LoreDescriptor): Array<Map<string, string>> {
  const name = new RegExp(`^- ${escapeRegex(layout.fields.name)}: "(.*)"$`);
  const others = [layout.fields.aliases, layout.fields.categories, layout.fields.file]
    .filter((field) => field !== "" && field !== layout.fields.name)
    .map((field) => [field, new RegExp(`^ {2}${escapeRegex(field)}: (.*)$`)] as const);
  const lines = raw.split("\n");
  const records: Array<Map<string, string>> = [];

  for (let i = 0; i < lines.length; i++) {
    const found = lines[i]?.match(name)?.[1];
    if (found === undefined) continue;
    const values = new Map<string, string>();
    values.set(layout.fields.name, found.replace(/\\"/g, '"'));
    // The record ends at the blank line: below it the next one starts. It is a
    // format meant to be read by eye, and the blank line is its only separator.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line === undefined || line.trim() === "") break;
      for (const [field, pattern] of others) {
        const value = line.match(pattern)?.[1];
        if (value !== undefined) values.set(field, value);
      }
    }
    records.push(values);
  }
  return records;
}

export function recordList(layout: LoreDescriptor): LoreProvider {
  return {
    id: "record-list",
    layout,
    kinds: () => Object.keys(layout.sections),

    readIndex: async (library: LoreLibrary, kind: string): Promise<LoreRecord[]> => {
      const section = layout.sections[kind];
      if (section === undefined) return [];
      const dir = libraryPath(library.dir, section.dir);
      const extension = indexExtension(section.index);
      const records: LoreRecord[] = [];

      for (const file of await listIndexFiles(dir, extension)) {
        let raw: string;
        try {
          raw = await readFile(join(dir, file), "utf8");
        } catch {
          continue;
        }
        const group = groupFromFile(file, extension);
        for (const values of parseRecords(raw, layout)) {
          const subject = values.get(layout.fields.name) ?? "";
          if (subject.trim() === "") continue;
          const categories = splitValue(values.get(layout.fields.categories) ?? "");
          const entry = entryFileFor(
            layout,
            { subject, group, kind, section: section.dir },
            layout.fields.file === "" ? undefined : values.get(layout.fields.file),
          );
          if (entry === null) continue;
          records.push({
            subject,
            variants: splitValue(values.get(layout.fields.aliases) ?? ""),
            categories,
            group,
            kind,
            file: entry,
            primary: isPrimaryFor(categories, kind, layout.primary),
            sources: 1,
            weight: weightFor(subject),
          });
        }
      }
      return records;
    },

    readEntry: async (library: LoreLibrary, record: LoreRecord): Promise<string> =>
      await readFile(libraryPath(library.dir, record.file), "utf8"),

    isPrimary: (record: LoreRecord): boolean =>
      isPrimaryFor(record.categories, record.kind, layout.primary),

    searchKeys: (subject: string): string[] => headKeysFor(subject, layout.matching),

    isUsefulName: (name: string): boolean => isUsefulNameFor(name, layout.matching),
  };
}
