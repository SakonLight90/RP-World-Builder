import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bible } from "@rpwb/shared";
import { BIBLE_SECTIONS, CANON_ANY_ERA, type ReasoningEffort } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { parse as parseYaml } from "yaml";
import { slugify } from "../config/paths.js";
import { CanonRepository } from "../db/repo/canon.js";
import { WorldRepository } from "../db/repo/worlds.js";
import { resolveLibraries } from "../lore/registry.js";
import {
  type CorpusFile,
  CorpusFileSchema,
  type CorpusWorld,
  CorpusWorldSchema,
  toCanonEntry,
} from "./schema.js";

export interface CorpusProblem {
  file: string;
  message: string;
  severity: "error" | "warning";
}

export interface LoadedWorld {
  worldId: string;
  slug: string;
  entries: number;
  activeEras: string[];
  problems: CorpusProblem[];
}

export interface LoadOptions {
  /** Corpus root, that is the folder containing one directory per world. */
  root: string;
  /**
   * Root of the lore libraries.
   *
   * It is received and not deduced: a world's requirements are declared in
   * `world.yaml` and checked against disk, so validation has to know where the
   * libraries are. The caller is `config/paths.ts`.
   */
  loreRoot: string;
  /** Model to use for the worlds created from the corpus. */
  model: string;
  smallModel: string;
  /** Requested reasoning power. "default" = ask for nothing. */
  reasoningEffort?: ReasoningEffort;
  /** Where the worlds' directories end up. */
  worldsDir: string;
  /** Recreate the world if it already exists: makes loading repeatable. */
  recreate?: boolean;
  log?: (message: string) => void;
}

const WORLD_FILE = "world.yaml";
const ENTRIES_DIR = "entries";

/**
 * Validates a corpus without writing it: it is for CI, where failing on the
 * first broken world is preferable to loading half a corpus and finding out
 * afterwards.
 *
 * The libraries are not inside the corpus, so their root comes from outside: if
 * it were deduced here, validation would say "library not found" for a perfectly
 * valid world, and the message would point at a file instead of at a path.
 */
export async function validateCorpus(root: string, loreRoot: string): Promise<CorpusProblem[]> {
  const problems: CorpusProblem[] = [];
  const names = await listWorldDirectories(root);

  for (const name of names) {
    const dir = join(root, name);
    const worldFile = join(dir, WORLD_FILE);

    let raw: unknown;
    try {
      raw = parseYaml(await readFile(worldFile, "utf8"));
    } catch (error) {
      problems.push({
        file: worldFile,
        message: `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
        severity: "error",
      });
      continue;
    }

    const parsed = CorpusWorldSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push({
          file: worldFile,
          message: `${issue.path.join(".") || "root"}: ${issue.message}`,
          severity: "error",
        });
      }
      continue;
    }

    const world = parsed.data;
    const knownEras = new Set([...world.eras.map((era) => era.key), CANON_ANY_ERA]);

    for (const key of world.activeEras) {
      if (!knownEras.has(key)) {
        problems.push({
          file: worldFile,
          message: `activeEras contains "${key}", which is not defined among the eras`,
          severity: "error",
        });
      }
    }
    if (world.activeEras.length === 0 && world.eras.length > 0) {
      problems.push({
        file: worldFile,
        message: "no active era: the canon would never enter the context",
        severity: "error",
      });
    }

    // Library requirements are checked here and not at load time: this is the
    // place where the user reads them before playing. A missing library is an
    // error, because the narrator would lose the reference the world says it
    // has; a different hash is a subtler error, because the world works but is
    // describing a campaign against sources that are no longer those.
    const resolved = await resolveLibraries(loreRoot, world.libraries);
    for (const lib of resolved) {
      const where = worldFile;
      if (lib.state !== "ok") {
        problems.push({
          file: where,
          message: `required library "${lib.requirement.id}" not found or unreadable in ${loreRoot}`,
          severity: "error",
        });
        continue;
      }
      if (lib.requirement.hash === "") {
        problems.push({
          file: where,
          message: `library "${lib.requirement.id}" required without a hash: add the current sha256 (${lib.actualHash}) to detect future changes`,
          severity: "warning",
        });
      } else if (lib.drifted) {
        problems.push({
          file: where,
          message: `library "${lib.requirement.id}" changed after the world required it: expected ${lib.requirement.hash}, found ${lib.actualHash}. Update the requirement only if the change is intended`,
          severity: "error",
        });
      }
      const manifest = lib.manifest;
      if (manifest && manifest.version !== lib.requirement.version) {
        problems.push({
          file: where,
          message: `library "${lib.requirement.id}" declares version ${manifest.version}, the world requires ${lib.requirement.version}`,
          severity: "warning",
        });
      }
    }

    for (const file of await listFiles(join(dir, ENTRIES_DIR), ".yaml")) {
      const path = join(dir, ENTRIES_DIR, file);
      let fileRaw: unknown;
      try {
        fileRaw = parseYaml(await readFile(path, "utf8"));
      } catch (error) {
        problems.push({
          file: path,
          message: `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
          severity: "error",
        });
        continue;
      }

      const fileParsed = CorpusFileSchema.safeParse(fileRaw);
      if (!fileParsed.success) {
        for (const issue of fileParsed.error.issues) {
          problems.push({
            file: path,
            message: `entry ${issue.path.join(".") || "?"}: ${issue.message}`,
            severity: "error",
          });
        }
        continue;
      }

      const subjects = new Set<string>();
      for (const entry of fileParsed.data.entries) {
        if (!knownEras.has(entry.era)) {
          problems.push({
            file: path,
            message: `"${entry.subject}" uses era "${entry.era}", which is not defined`,
            severity: "error",
          });
        }
        const identity = `${entry.subject}@${entry.era}`;
        if (subjects.has(identity)) {
          problems.push({
            file: path,
            message: `"${identity}" is duplicated in the same file`,
            severity: "error",
          });
        }
        subjects.add(identity);
        if (entry.summary.trim() === "" && entry.facts.length === 0) {
          problems.push({
            file: path,
            message: `"${entry.subject}" has neither a summary nor facts`,
            severity: "warning",
          });
        }
      }
    }
  }

  return problems;
}

export async function loadCorpus(db: Database, options: LoadOptions): Promise<LoadedWorld[]> {
  const problems = await validateCorpus(options.root, options.loreRoot);
  const blocking = problems.filter((problem) => problem.severity === "error");
  if (blocking.length > 0) {
    throw new Error(
      `Invalid corpus, ${blocking.length} blocking problems:\n` +
        blocking.map((problem) => `  - ${problem.file}: ${problem.message}`).join("\n"),
    );
  }

  const worlds = new WorldRepository(db);
  const canon = new CanonRepository(db);
  const loaded: LoadedWorld[] = [];

  for (const name of await listWorldDirectories(options.root)) {
    const dir = join(options.root, name);
    const world = CorpusWorldSchema.parse(parseYaml(await readFile(join(dir, WORLD_FILE), "utf8")));

    const existing = worlds.getBySlug(world.slug);
    if (existing) {
      if (options.recreate === true) {
        worlds.delete(existing.id);
      } else {
        // Library requirements are reconciled even for an already loaded world.
        // A requirement is a dependency declaration, not content: declaring it in
        // `world.yaml` and then finding the world without it is exactly the case
        // the requirements mechanism was supposed to prevent, because it means the
        // declared library never reached the narrator and nobody notices.
        //
        // Requirements only. Canon, Bible and eras stay untouched: `recreate`
        // already exists for those and does its job.
        const declared = JSON.stringify(world.libraries);
        if (JSON.stringify(existing.libraries) !== declared) {
          worlds.update(existing.id, { libraries: world.libraries });
          options.log?.(`  ${world.slug}: library requirement updated`);
        } else {
          options.log?.(`  ${world.slug}: already present, skipped`);
        }
        loaded.push({
          worldId: existing.id,
          slug: world.slug,
          entries: canon.countFor(existing.id),
          activeEras: world.activeEras,
          problems: [],
        });
        continue;
      }
    }

    const created = worlds.create({
      name: world.name,
      slug: world.slug === "" ? slugify(world.name) : world.slug,
      description: world.description,
      baseLocale: world.baseLocale,
      activeLocale: world.baseLocale,
      model: options.model,
      smallModel: options.smallModel,
      reasoningEffort: options.reasoningEffort,
      opencodeDir: join(options.worldsDir, world.slug),
      isTemplate: world.isTemplate,
      templateAuthor: world.templateAuthor,
      // Requirements are declared, not resolved here: the library stays outside
      // and the world points at it. If the requirement is not satisfied,
      // validation has already flagged it, and creating the world makes it
      // inspectable anyway.
      libraries: world.libraries,
      // The ways into the world travel with it, and none is selected: choosing is
      // the player's first move inside the chat.
      starts: world.starts.map((start) => ({
        id: start.id,
        name: start.name,
        game: start.game,
        playable: start.playable,
        narration: start.narration,
      })),
    });

    writeBible(worlds, created.id, world.bible);
    worlds.replaceEras(created.id, world.eras);

    const entries = [];
    for (const file of await listFiles(join(dir, ENTRIES_DIR), ".yaml")) {
      const parsed = CorpusFileSchema.parse(
        parseYaml(await readFile(join(dir, ENTRIES_DIR, file), "utf8")),
      );
      for (const entry of parsed.entries) entries.push(toCanonEntry(created.id, entry));
    }

    canon.upsertMany(entries);
    options.log?.(`  ${world.slug}: ${entries.length} canon entries`);

    loaded.push({
      worldId: created.id,
      slug: world.slug,
      entries: entries.length,
      activeEras: world.activeEras,
      problems: problems.filter((problem) => problem.file.includes(name)),
    });
  }

  return loaded;
}

function writeBible(worlds: WorldRepository, worldId: string, bible: CorpusWorld["bible"]): void {
  const complete: Bible = {
    premise: bible.premise,
    rules: bible.rules,
    tone: bible.tone,
    style: bible.style,
    conventions: bible.conventions,
  };
  for (const section of BIBLE_SECTIONS) worlds.setBibleSection(worldId, section, complete[section]);
}

async function listWorldDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function listFiles(dir: string, extension: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export type { CorpusFile, CorpusWorld };
