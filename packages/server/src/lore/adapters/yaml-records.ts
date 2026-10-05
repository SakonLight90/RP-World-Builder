import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  entryFileFor,
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
 * Adapter for a YAML index: one file per sub-index, holding a sequence of
 * records with the library's columns.
 *
 * It is there for one precise purpose: to show that the engine has no format in
 * mind. This adapter is one of the two, and it has nothing in common with the
 * other except the descriptor that governs them; a library that uses them does not
 * touch the engine, and does not touch this file either.
 */

function textOf(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** A column may arrive as a list or as text separated by semicolons. */
function listOf(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => textOf(item).trim()).filter((item) => item !== "");
  }
  if (typeof value === "string") {
    return value
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  return [];
}

export function yamlRecords(layout: LoreDescriptor): LoreProvider {
  return {
    id: "yaml-records",
    layout,
    kinds: () => Object.keys(layout.sections),

    readIndex: async (library: LoreLibrary, kind: string): Promise<LoreRecord[]> => {
      const section = layout.sections[kind];
      if (section === undefined) return [];
      const dir = libraryPath(library.dir, section.dir);
      const extension = indexExtension(section.index);
      const records: LoreRecord[] = [];

      for (const file of await listIndexFiles(dir, extension)) {
        let parsed: unknown;
        try {
          parsed = parseYaml(await readFile(join(dir, file), "utf8"));
        } catch {
          continue;
        }
        if (!Array.isArray(parsed)) continue;
        const group = groupFromFile(file, extension);
        for (const item of parsed) {
          if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
          const row = item as Record<string, unknown>;
          const subject = textOf(row[layout.fields.name]).trim();
          if (subject === "") continue;
          const categories = listOf(row[layout.fields.categories]);
          const entry = entryFileFor(
            layout,
            { subject, group, kind, section: section.dir },
            layout.fields.file === "" ? undefined : textOf(row[layout.fields.file]),
          );
          if (entry === null) continue;
          records.push({
            subject,
            variants: listOf(row[layout.fields.aliases]),
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
