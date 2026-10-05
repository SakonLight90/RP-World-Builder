import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveRoots } from "../src/config/paths.js";
import { loadCorpus, validateCorpus } from "../src/corpus/load.js";
import { entryTokens, estimateTokens } from "../src/corpus/schema.js";
import { openMemory } from "../src/db/connection.js";
import { CanonRepository } from "../src/db/repo/canon.js";
import { WorldRepository } from "../src/db/repo/worlds.js";

const MODEL = "opencode/space-bunny-free";

/**
 * Lore root for the test corpora.
 *
 * These worlds declare no libraries, so the value changes nothing: it's still
 * mandatory, because a root that deduces itself is a root that sooner or later
 * deduces itself wrong.
 */
const LORE = resolveRoots().lore;

async function makeWorld(name: string, files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "rpwb-corpus-"));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(dir, name, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return dir;
}

const WORLD_YAML = `
name: Mondo di prova
slug: mondo-di-prova
baseLocale: it
activeEras: ["2287"]
eras:
  - key: "2287"
    label: "Era 2287"
    summary: "L'epoca corrente."
bible:
  premise: "Una premessa."
  rules: "La magia non esiste."
`;

const ENTRIES_YAML = `
entries:
  - subject: "Rifugio Alfa"
    kind: location
    era: "2287"
    aliases: ["Alfa"]
    summary: "Un rifugio piccolo."
    facts:
      - "Non ha tecnologia pre-war."
  - subject: "La regola della fisica"
    kind: rule
    era: any
    summary: "Nulla teletrasporta."
    facts:
      - "La velocita' maxima di un corpo umano e' limitata."
    priority: 500
`;

describe("corpus", () => {
  describe("token estimate", () => {
    it("uses about four characters per token", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("abcd")).toBe(1);
      expect(estimateTokens("abcde")).toBe(2);
    });

    it("sums summary, facts and aliases", () => {
      const tokens = entryTokens({ summary: "abcd", facts: ["efgh", "ijkl"], aliases: ["mnop"] });
      expect(tokens).toBe(4);
    });
  });

  describe("validation", () => {
    // Validation doesn't touch the database: it works on the files and that's it.
    it("accepts a well-formed corpus", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML,
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.filter((p) => p.severity === "error")).toHaveLength(0);
      await rm(root, { recursive: true, force: true });
    });

    it("flags a nonexistent active era", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML.replace('"2287"', '"9999"').replace('key: "2287"', 'key: "2287"'),
        "entries/000.yaml": ENTRIES_YAML,
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.some((p) => p.message.includes("9999"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    });

    it("flags an entry using an undefined era", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML.replace('era: "2287"', 'era: "1900"'),
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.some((p) => p.message.includes("1900"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    });

    it("flags a duplicated entry in the same file", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": `${ENTRIES_YAML}${ENTRIES_YAML.split("entries:")[1]}`,
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.some((p) => p.message.includes("is duplicated in the same file"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    });

    it("flags a world with no active eras", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML.replace('activeEras: ["2287"]', "activeEras: []"),
        "entries/000.yaml": ENTRIES_YAML,
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.some((p) => p.message.includes("no active era"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    });

    it("flags an invalid slug", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML.replace("slug: mondo-di-prova", "slug: Mondo Di Prova"),
        "entries/000.yaml": ENTRIES_YAML,
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.some((p) => p.message.includes("slug"))).toBe(true);
      await rm(root, { recursive: true, force: true });
    });

    it("flags broken YAML without blowing up", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": "name: [non chiuso",
        "entries/000.yaml": ENTRIES_YAML,
      });
      const problems = await validateCorpus(root, LORE);
      expect(problems.some((p) => p.severity === "error")).toBe(true);
      await rm(root, { recursive: true, force: true });
    });
  });

  describe("loading", () => {
    let db: Database;

    beforeEach(() => {
      db = openMemory();
    });

    it("refuses to load a corpus with blocking errors", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML.replace("slug: mondo-di-prova", "slug: Non Valido"),
        "entries/000.yaml": ENTRIES_YAML,
      });
      await expect(
        loadCorpus(db, {
          root,
          loreRoot: LORE,
          model: MODEL,
          smallModel: MODEL,
          worldsDir: "/tmp",
        }),
      ).rejects.toThrow(/blocking problems/);
      await rm(root, { recursive: true, force: true });
    });

    it("creates the world, the Bible, the eras and the entries", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML,
      });

      const loaded = await loadCorpus(db, {
        root,
        loreRoot: LORE,
        model: MODEL,
        smallModel: MODEL,
        worldsDir: "/tmp",
      });

      expect(loaded).toHaveLength(1);
      const worlds = new WorldRepository(db);
      const world = worlds.getBySlug("mondo-di-prova");
      expect(world).not.toBeNull();
      expect(world?.isTemplate).toBe(true);
      expect(world?.templateAuthor).toBe("amministrazione");
      expect(world?.model).toBe(MODEL);
      expect(worlds.getBible(world?.id ?? "").rules).toBe("La magia non esiste.");
      expect(worlds.listEras(world?.id ?? "")).toHaveLength(1);

      const canon = new CanonRepository(db);
      expect(canon.countFor(world?.id ?? "")).toBe(2);
      await rm(root, { recursive: true, force: true });
    });

    it("carries the world's starts over, and selects none of them", async () => {
      /*
       * The template is the model somebody starts from, so it brings the ways into
       * the setting and not the choice between them: whoever forks it has not
       * decided how their campaign begins, and the selector is the first thing they
       * should meet.
       *
       * The lore-only entry is here on purpose. Fallout 1 and 2 are in the library so
       * the narrator can cite them; there is no scenario to step into, so they must
       * arrive marked `playable: false` and stay out of the selector.
       */
      const root = await makeWorld("prova", {
        "world.yaml": `${WORLD_YAML}
starts:
  - id: "new-vegas"
    name: "Fallout: New Vegas"
    game: "new-vegas"
    playable: true
    narration: "Goodsprings. You wake on the floor with a hole in your head."
  - id: "fallout-1"
    name: "Fallout"
    game: "fallout-1"
    playable: false
`,
        "entries/000.yaml": ENTRIES_YAML,
      });

      await loadCorpus(db, {
        root,
        loreRoot: LORE,
        model: MODEL,
        smallModel: MODEL,
        worldsDir: "/tmp",
      });

      const world = new WorldRepository(db).getBySlug("mondo-di-prova");
      expect(world?.starts.list.map((s) => s.id)).toEqual(["new-vegas", "fallout-1"]);
      expect(world?.starts.list[0]?.narration).toContain("Goodsprings");
      expect(world?.starts.list[1]?.playable).toBe(false);
      expect(world?.starts.selectedId).toBeNull();
    });

    it("a start that doesn't say it can be played is not playable", async () => {
      /*
       * The default is false and not true, and the direction matters: a start written
       * without the flag belongs in the library as reference, and the worst case is a
       * start nobody sees. The other default would offer a campaign that begins
       * nowhere.
       */
      const root = await makeWorld("prova", {
        "world.yaml": `${WORLD_YAML}
starts:
  - id: "senza-flag"
    name: "No flag"
    narration: "Una scena."
`,
        "entries/000.yaml": ENTRIES_YAML,
      });

      await loadCorpus(db, {
        root,
        loreRoot: LORE,
        model: MODEL,
        smallModel: MODEL,
        worldsDir: "/tmp",
      });

      expect(new WorldRepository(db).getBySlug("mondo-di-prova")?.starts.list[0]?.playable).toBe(
        false,
      );
    });

    it("a corpus with no starts loads a world with none", async () => {
      // Every world built from scratch reaches this, so it is not a corner: an
      // absent field would be indistinguishable from a missing column.
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML,
      });

      await loadCorpus(db, {
        root,
        loreRoot: LORE,
        model: MODEL,
        smallModel: MODEL,
        worldsDir: "/tmp",
      });

      expect(new WorldRepository(db).getBySlug("mondo-di-prova")?.starts).toEqual({
        list: [],
        selectedId: null,
      });
    });

    it("a start with no id is a blocking error", async () => {
      // The id is what a selection points at and what the transcript is opened by,
      // so a start nobody can point at is a mistake in the template, and it is
      // caught at load time rather than at the first choice.
      const root = await makeWorld("prova", {
        "world.yaml": `${WORLD_YAML}
starts:
  - name: "Senza id"
    playable: true
    narration: "Una scena."
`,
        "entries/000.yaml": ENTRIES_YAML,
      });

      await expect(
        loadCorpus(db, {
          root,
          loreRoot: LORE,
          model: MODEL,
          smallModel: MODEL,
          worldsDir: "/tmp",
        }),
      ).rejects.toThrow(/blocking problems/);
    });

    it("reloading doesn't duplicate", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML,
      });
      const options = { root, loreRoot: LORE, model: MODEL, smallModel: MODEL, worldsDir: "/tmp" };
      await loadCorpus(db, options);
      await loadCorpus(db, options);

      const worlds = new WorldRepository(db);
      // The corpus creates a **template**, and a template isn't a campaign: it
      // must not show among playable worlds, or the "your worlds" page would
      // have an entry nobody can open.
      expect(worlds.list()).toHaveLength(0);
      expect(worlds.listTemplates()).toHaveLength(1);
      const canon = new CanonRepository(db);
      expect(canon.countFor(worlds.getBySlug("mondo-di-prova")?.id ?? "")).toBe(2);
      await rm(root, { recursive: true, force: true });
    });

    it("with recreate the world is rebuilt", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML,
      });
      const base = { root, loreRoot: LORE, model: MODEL, smallModel: MODEL, worldsDir: "/tmp" };
      await loadCorpus(db, base);
      const [first] = await loadCorpus(db, { ...base, recreate: true });

      const worlds = new WorldRepository(db);
      // As above: the template is a model, not a playable campaign.
      expect(worlds.list()).toHaveLength(0);
      expect(worlds.listTemplates()).toHaveLength(1);
      expect(first?.worldId).toBe(worlds.getBySlug("mondo-di-prova")?.id);
      await rm(root, { recursive: true, force: true });
    });

    it("ignores directories starting with an underscore", async () => {
      const root = await makeWorld("prova", {
        "world.yaml": WORLD_YAML,
        "entries/000.yaml": ENTRIES_YAML,
        "_bozza/world.yaml": "name: Bozza\nslug: bozza",
      });
      const loaded = await loadCorpus(db, {
        root,
        loreRoot: LORE,
        model: MODEL,
        smallModel: MODEL,
        worldsDir: "/tmp",
      });
      expect(loaded).toHaveLength(1);
      await rm(root, { recursive: true, force: true });
    });
  });
});
