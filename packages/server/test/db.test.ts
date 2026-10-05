import type { CanonEntry } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { databaseVersion, openMemory } from "../src/db/connection.js";
import { currentVersion, MIGRATIONS } from "../src/db/migrate.js";
import { CanonRepository } from "../src/db/repo/canon.js";
import { CastRepository } from "../src/db/repo/cast.js";
import { ChapterRepository } from "../src/db/repo/chapters.js";
import { buildFtsQuery } from "../src/db/repo/common.js";
import { WorldRepository } from "../src/db/repo/worlds.js";

function entry(
  worldId: string,
  patch: Partial<CanonEntry> & Pick<CanonEntry, "subject" | "kind">,
): CanonEntry {
  return {
    id: crypto.randomUUID(),
    worldId,
    aliases: [],
    summary: "",
    facts: [],
    era: "any",
    status: "active",
    priority: 0,
    tokens: 10,
    ...patch,
  };
}

describe("database", () => {
  let db: Database;
  let worlds: WorldRepository;
  let canon: CanonRepository;
  let cast: CastRepository;
  let chapters: ChapterRepository;
  let worldId: string;

  beforeEach(() => {
    db = openMemory();
    worlds = new WorldRepository(db);
    canon = new CanonRepository(db);
    cast = new CastRepository(db);
    chapters = new ChapterRepository(db);
    worldId = worlds.create({
      name: "Prova",
      slug: "prova",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "/tmp/prova",
    }).id;
  });

  it("applies every migration, only once", () => {
    // The number comes from the list and isn't written by hand: adding a
    // migration must not be able to break this test.
    expect(databaseVersion(db)).toBe(MIGRATIONS.length);
    expect(currentVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version);
  });

  it("the arcs table exists after the migrations", () => {
    const tables = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    expect(tables).toContain("arcs");

    // and chapters have the arc field
    const columns = db.prepare<[], { name: string }>("PRAGMA table_info(chapters)").all();
    expect(columns.map((column) => column.name)).toContain("arc_id");
  });

  it("the foreign key is active: a broken reference fails", () => {
    expect(() =>
      cast.addCharacter("world-does-not-exist", {
        name: "X",
        role: "",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: null,
        isPlayer: false,
        canonical: true,
        era: "any",
      }),
    ).toThrow();
  });

  it("the Bible is born with every section empty", () => {
    const bible = worlds.getBible(worldId);
    expect(Object.keys(bible).sort()).toEqual(["conventions", "premise", "rules", "style", "tone"]);
    expect(bible.premise).toBe("");
  });

  it("updates one Bible section without touching the others", () => {
    worlds.setBibleSection(worldId, "rules", "Magic does not exist.");
    worlds.setBibleSection(worldId, "premise", "Appalachia, 2287.");
    const bible = worlds.getBible(worldId);
    expect(bible.rules).toBe("Magic does not exist.");
    expect(bible.premise).toBe("Appalachia, 2287.");
    expect(bible.tone).toBe("");
  });

  describe("canon", () => {
    it("loads the corpus idempotently", () => {
      const first = entry(worldId, {
        subject: "Vault 12",
        kind: "location",
        summary: "Un rifugio.",
      });
      const second = entry(worldId, {
        subject: "Vault 12",
        kind: "location",
        summary: "Un rifugio aggiornato.",
      });
      expect(canon.upsertMany([first, second])).toBe(2);
      // the second row with the same identity updates, doesn't duplicate
      expect(canon.countFor(worldId)).toBe(1);
      const list = canon.list({ worldId, activeEras: [], includeDisputed: false });
      expect(list[0]?.summary).toBe("Un rifugio aggiornato.");
    });

    it("the same subject in different eras is two entries", () => {
      canon.upsertMany([
        entry(worldId, {
          subject: "Horizon",
          kind: "location",
          era: "pre-war",
          summary: "Enclave aziendale.",
        }),
        entry(worldId, {
          subject: "Horizon",
          kind: "location",
          era: "2287",
          summary: "Resti di Frontier.",
        }),
      ]);
      expect(canon.countFor(worldId)).toBe(2);
      expect(canon.list({ worldId, activeEras: ["2287"], includeDisputed: false })).toHaveLength(1);
    });

    it("an entry with era any always holds", () => {
      canon.upsertMany([entry(worldId, { subject: "Nuke", kind: "technology", era: "any" })]);
      expect(canon.list({ worldId, activeEras: ["pre-war"], includeDisputed: false })).toHaveLength(
        1,
      );
      expect(canon.list({ worldId, activeEras: ["2287"], includeDisputed: false })).toHaveLength(1);
    });

    it("in strict, disputed and non_canon material stays out", () => {
      canon.upsertMany([
        entry(worldId, { subject: "A", kind: "event", status: "active" }),
        entry(worldId, { subject: "B", kind: "event", status: "disputed" }),
        entry(worldId, { subject: "C", kind: "event", status: "non_canon" }),
        entry(worldId, { subject: "D", kind: "event", status: "retconned" }),
      ]);
      const strict = canon.list({ worldId, activeEras: [], includeDisputed: false });
      expect(strict.map((e) => e.subject).sort()).toEqual(["A", "D"]);

      const lenient = canon.list({ worldId, activeEras: [], includeDisputed: true });
      expect(lenient.map((e) => e.subject).sort()).toEqual(["A", "B", "D"]);
    });

    it("filters by kind", () => {
      canon.upsertMany([
        entry(worldId, { subject: "Regola", kind: "rule" }),
        entry(worldId, { subject: "Place", kind: "location" }),
      ]);
      const rules = canon.list({
        worldId,
        activeEras: [],
        includeDisputed: false,
        kinds: ["rule"],
      });
      expect(rules).toHaveLength(1);
      expect(rules[0]?.subject).toBe("Regola");
    });

    describe("full-text search", () => {
      beforeEach(() => {
        canon.upsertMany([
          entry(worldId, {
            subject: "Replicants Beach",
            kind: "item",
            summary: "Giacca con cappuccio, tessuto rinforzato.",
            facts: ["Prodotta dalla Replicated Life", "Colore nero"],
          }),
          entry(worldId, {
            subject: "Nuka-Cola",
            kind: "item",
            summary: "Bibita gassata arrivata col reddito di wartime.",
          }),
          entry(worldId, {
            subject: "Minutemen",
            kind: "faction",
            summary: "A group of civilians who defend the small settlements.",
          }),
        ]);
      });

      it("finds an entry cited in the player's text", () => {
        const results = canon.search({
          worldId,
          activeEras: [],
          includeDisputed: false,
          text: "prendo la giacca dei replicanti",
        });
        expect(results.map((r) => r.subject)).toContain("Replicants Beach");
      });

      it("ignores function words in the query", () => {
        const query = buildFtsQuery("chiedo a Vera della torrette est");
        expect(query).not.toBeNull();
        expect(query).not.toContain('"chiedo"');
        expect(query).not.toContain('"della"');
        expect(query).toContain('"vera"');
        expect(query).toContain('"torrette"');
      });

      it("a sentence of only function words produces no query", () => {
        expect(buildFtsQuery("vado avanti e apro la porta")).toBeNull();
      });

      it("doesn't break on FTS5 operators in the text", () => {
        // `AND`, `*`, `:` and `-` are operators: passed through raw they would
        // make the MATCH fail with a syntax error instead of returning 0 rows.
        for (const text of ['cerca "Nuka" AND cola', "wildcard*", "campo: valore", "a-b"]) {
          expect(() =>
            canon.search({ worldId, activeEras: [], includeDisputed: false, text }),
          ).not.toThrow();
        }
      });

      it("tolerates accented characters in both directions", () => {
        canon.upsertMany([
          entry(worldId, {
            subject: "Città della Luce",
            kind: "location",
            summary: "A metropolis.",
          }),
        ]);
        const without = canon.search({
          worldId,
          activeEras: [],
          includeDisputed: false,
          text: "vado a citta della luce",
        });
        expect(without.map((r) => r.subject)).toContain("Città della Luce");

        const with_ = canon.search({
          worldId,
          activeEras: [],
          includeDisputed: false,
          text: "vado a città della luce",
        });
        expect(with_.map((r) => r.subject)).toContain("Città della Luce");
      });

      it("text made only of function words produces no query", () => {
        const results = canon.search({
          worldId,
          activeEras: [],
          includeDisputed: false,
          text: "e di a per la con",
        });
        expect(results).toHaveLength(0);
      });

      it("discards terms too frequent to distinguish anything", () => {
        // "locale" appears in many entries of a hypothetical corpus: it carries
        // no information and would pull irrelevant entries into the context.
        const filler = Array.from({ length: 20 }, (_, index) =>
          entry(worldId, {
            subject: `Filler entry ${index}`,
            kind: "location",
            summary: "Any place in the area.",
          }),
        );
        canon.upsertMany([
          ...filler,
          entry(worldId, {
            subject: "The secret laboratory",
            kind: "location",
            summary: "Un laboratorio sotterraneo pieno di provette.",
          }),
        ]);

        const results = canon.search({
          worldId,
          activeEras: [],
          includeDisputed: false,
          text: "entro nel laboratorio",
        });
        expect(results.map((r) => r.subject)).toContain("The secret laboratory");
        expect(results.map((r) => r.subject)).not.toContain("Filler entry 0");
      });

      it("if the filter discards everything it still prefers a query", () => {
        // Better some noisy results than a turn with no foothold on the canon.
        canon.upsertMany([
          entry(worldId, { subject: "Comune", kind: "location", summary: "zona comune" }),
        ]);
        const results = canon.search({
          worldId,
          activeEras: [],
          includeDisputed: false,
          text: "zona comune",
        });
        expect(results.length).toBeGreaterThan(0);
      });

      it("respects the era filter in search too", () => {
        canon.upsertMany([
          entry(worldId, {
            subject: "Horizon",
            kind: "location",
            era: "pre-war",
            summary: "Enclave.",
          }),
        ]);
        const prewar = canon.search({
          worldId,
          activeEras: ["pre-war"],
          includeDisputed: false,
          text: "visito horizon",
        });
        const modern = canon.search({
          worldId,
          activeEras: ["2287"],
          includeDisputed: false,
          text: "visito horizon",
        });
        expect(prewar.map((r) => r.subject)).toContain("Horizon");
        expect(modern).toHaveLength(0);
      });
    });

    it("detects explicitly cited entities", () => {
      canon.upsertMany([
        entry(worldId, {
          subject: "Vault 12",
          kind: "location",
          aliases: ["V12", "The twelfth"],
        }),
        entry(worldId, { subject: "Minutemen", kind: "faction" }),
      ]);
      const mentioned = canon.findMentioned(worldId, "gli chiedo al V12 se i Minutemen servono");
      expect(mentioned.map((e) => e.subject).sort()).toEqual(["Minutemen", "Vault 12"]);
    });

    it("the full-text index updates when an entry changes", () => {
      canon.upsertMany([
        entry(worldId, { subject: "Before", kind: "event", summary: "Old text." }),
      ]);
      canon.upsertMany([
        entry(worldId, { subject: "Before", kind: "event", summary: "New text." }),
      ]);
      const results = canon.search({
        worldId,
        activeEras: [],
        includeDisputed: false,
        text: "new text",
      });
      expect(results).toHaveLength(1);
      const old = canon.search({
        worldId,
        activeEras: [],
        includeDisputed: false,
        text: "vecchio",
      });
      expect(old).toHaveLength(0);
    });

    it("the index empties when the entry is removed", () => {
      canon.upsertMany([
        entry(worldId, { subject: "Temporanea", kind: "event", summary: "Da cancellare." }),
      ]);
      const list = canon.list({ worldId, activeEras: [], includeDisputed: false });
      const id = list[0]?.id ?? "";
      expect(canon.remove(worldId, id)).toBe(true);
      const results = canon.search({
        worldId,
        activeEras: [],
        includeDisputed: false,
        text: "cancellare",
      });
      expect(results).toHaveLength(0);
    });

    it("the canon health counts the problematic entries", () => {
      canon.upsertMany([
        entry(worldId, { subject: "Sound", kind: "event" }),
        entry(worldId, { subject: "Dated", kind: "event" }),
        entry(worldId, { subject: "Debated", kind: "event", status: "disputed" }),
        entry(worldId, { subject: "Superseded", kind: "event", status: "retconned" }),
      ]);
      const health = canon.health(worldId);
      expect(health).toEqual({ total: 4, disputed: 1, retconned: 1 });
    });

    it("records and rereads the canonicity audit", () => {
      canon.addAudit({
        worldId,
        chapterId: null,
        claim: "The narrator had the protagonist healed",
        verdict: "unsupported",
        canonRef: "",
        suggestion: "Nessuna tecnologia di guarigione esiste in quest'epoca.",
      });
      const audit = canon.listAudit(worldId);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.verdict).toBe("unsupported");
    });
  });

  describe("cast", () => {
    it("builds the chain of locations up to the root", () => {
      const region = cast.addLocation(worldId, {
        name: "Appalachia",
        description: "",
        parentId: null,
        aliases: [],
        era: "any",
      });
      const city = cast.addLocation(worldId, {
        name: "Charleston",
        description: "",
        parentId: region.id,
        aliases: [],
        era: "any",
      });
      const vault = cast.addLocation(worldId, {
        name: "Vault 12",
        description: "",
        parentId: city.id,
        aliases: ["V12"],
        era: "any",
      });

      const chain = cast.locationAncestry(worldId, vault.id);
      expect(chain.map((l) => l.name)).toEqual(["Vault 12", "Charleston", "Appalachia"]);
    });

    it("a cycle in the location hierarchy doesn't cause an infinite loop", () => {
      const a = cast.addLocation(worldId, {
        name: "A",
        description: "",
        parentId: null,
        aliases: [],
        era: "any",
      });
      const b = cast.addLocation(worldId, {
        name: "B",
        description: "",
        parentId: a.id,
        aliases: [],
        era: "any",
      });
      db.prepare("UPDATE locations SET parent_id = ? WHERE id = ?").run(b.id, a.id);
      const chain = cast.locationAncestry(worldId, a.id);
      expect(chain.map((l) => l.name)).toEqual(["A", "B"]);
    });

    it("the canonical characters on stage are the location's", () => {
      const vault = cast.addLocation(worldId, {
        name: "Vault 12",
        description: "",
        parentId: null,
        aliases: [],
        era: "any",
      });
      const other = cast.addLocation(worldId, {
        name: "Fort Atlas",
        description: "",
        parentId: null,
        aliases: [],
        era: "any",
      });
      const player = cast.addCharacter(worldId, {
        name: "The Survivor",
        role: "protagonista",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: vault.id,
        isPlayer: true,
        canonical: true,
        era: "any",
      });
      const present = cast.addCharacter(worldId, {
        name: "Vera",
        role: "abitante",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: vault.id,
        isPlayer: false,
        canonical: true,
        era: "any",
      });
      cast.addCharacter(worldId, {
        name: "Lontano",
        role: "",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: other.id,
        isPlayer: false,
        canonical: true,
        era: "any",
      });

      const inScene = cast.charactersAt(worldId, vault.id);
      expect(inScene.map((c) => c.name).sort()).toEqual(["The Survivor", "Vera"]);
      expect(inScene.some((c) => c.id === player.id)).toBe(true);
      expect(inScene.some((c) => c.id === present.id)).toBe(true);
    });

    it("excludes non-canonical characters", () => {
      const vault = cast.addLocation(worldId, {
        name: "Vault 12",
        description: "",
        parentId: null,
        aliases: [],
        era: "any",
      });
      cast.addCharacter(worldId, {
        name: "Solo lore interna",
        role: "",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: vault.id,
        isPlayer: false,
        canonical: false,
        era: "any",
      });
      expect(cast.charactersAt(worldId, vault.id)).toHaveLength(0);
    });

    it("relationships update without duplicating", () => {
      const from = cast.addCharacter(worldId, {
        name: "Vera",
        role: "",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: null,
        isPlayer: false,
        canonical: true,
        era: "any",
      });
      const to = cast.addCharacter(worldId, {
        name: "Christine",
        role: "",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: null,
        isPlayer: false,
        canonical: true,
        era: "any",
      });

      cast.setRelationship(worldId, {
        worldId,
        fromCharacterId: from.id,
        toCharacterId: to.id,
        affinity: 10,
        trust: 5,
        note: "si conoscono",
      });
      cast.setRelationship(worldId, {
        worldId,
        fromCharacterId: from.id,
        toCharacterId: to.id,
        affinity: 40,
        trust: 25,
        note: "si fida",
      });

      const all = cast.listRelationships(worldId);
      expect(all).toHaveLength(1);
      expect(all[0]?.affinity).toBe(40);
      expect(cast.relationshipsOf(worldId, to.id)).toHaveLength(1);
    });

    it("deleting a location leaves the characters with no reference", () => {
      const vault = cast.addLocation(worldId, {
        name: "Vault 12",
        description: "",
        parentId: null,
        aliases: [],
        era: "any",
      });
      const person = cast.addCharacter(worldId, {
        name: "Vera",
        role: "",
        description: "",
        personality: "",
        secret: "",
        status: "",
        locationId: vault.id,
        isPlayer: false,
        canonical: true,
        era: "any",
      });
      expect(cast.deleteLocation(worldId, vault.id)).toBe(true);
      const after = cast.getCharacter(worldId, person.id);
      expect(after).not.toBeNull();
      expect(after?.locationId).toBeNull();
    });
  });

  describe("chapters", () => {
    it("progressive numbering starting at 1", () => {
      expect(chapters.nextNumber(worldId)).toBe(1);
      chapters.add({
        worldId,
        locale: "it",
        title: "The Awakening",
        summary: "",
        path: "capitolo-01.md",
        tokenStart: 0,
        tokenEnd: 100,
        canonRefs: [],
        arcId: null,
      });
      expect(chapters.nextNumber(worldId)).toBe(2);
      chapters.add({
        worldId,
        locale: "it",
        title: "The Depot",
        summary: "",
        path: "capitolo-02.md",
        tokenStart: 100,
        tokenEnd: 200,
        canonRefs: ["Vault 12"],
        arcId: null,
      });
      expect(chapters.list(worldId).map((c) => c.n)).toEqual([1, 2]);
      expect(chapters.latest(worldId)?.title).toBe("The Depot");
      expect(chapters.get(worldId, 2)?.canonRefs).toEqual(["Vault 12"]);
    });
  });

  it("deleting a world takes everything else with it in cascade", () => {
    canon.upsertMany([entry(worldId, { subject: "Vault 12", kind: "location" })]);
    const vault = cast.addLocation(worldId, {
      name: "Vault 12",
      description: "",
      parentId: null,
      aliases: [],
      era: "any",
    });
    cast.addCharacter(worldId, {
      name: "Vera",
      role: "",
      description: "",
      personality: "",
      secret: "",
      status: "",
      locationId: vault.id,
      isPlayer: false,
      canonical: true,
      era: "any",
    });

    expect(worlds.delete(worldId)).toBe(true);
    expect(canon.countFor(worldId)).toBe(0);
    expect(cast.listLocations(worldId)).toHaveLength(0);
    expect(cast.listCharacters(worldId)).toHaveLength(0);
  });

  it("the default reasoning effort isn't written to the database", () => {
    const world = worlds.getBySlug("prova");
    expect(world?.reasoningEffort).toBe("default");
  });

  it("the chosen reasoning effort is kept", () => {
    const updated = worlds.update(worldId, { reasoningEffort: "high" });
    expect(updated?.reasoningEffort).toBe("high");
    expect(worlds.get(worldId)?.reasoningEffort).toBe("high");

    // a nonexistent value falls back to the default instead of landing in the database
    const nonsense = worlds.update(worldId, { reasoningEffort: "massimo" as never });
    expect(nonsense?.reasoningEffort).toBe("default");
  });

  it("forking a template inherits the reasoning effort", () => {
    worlds.update(worldId, { reasoningEffort: "low" });
    const clone = worlds.clone(worldId, { slug: "prova-fork2", opencodeDir: "/tmp/fork2" });
    expect(clone.reasoningEffort).toBe("low");
  });

  it("forking a template copies the Bible and the eras", () => {
    worlds.setBibleSection(worldId, "rules", "Magic does not exist.");
    worlds.replaceEras(worldId, [{ key: "2287", label: "Appalachia 2287", summary: "" }]);

    const template = worlds.update(worldId, { isTemplate: true, templateAuthor: "admin" });
    expect(template?.isTemplate).toBe(true);
    expect(worlds.listTemplates()).toHaveLength(1);

    const clone = worlds.clone(worldId, { slug: "prova-fork", opencodeDir: "/tmp/fork" });
    expect(clone.isTemplate).toBe(false);
    expect(clone.templateAuthor).toBeNull();
    expect(worlds.getBible(clone.id).rules).toBe("Magic does not exist.");
    expect(worlds.listEras(clone.id)).toHaveLength(1);
  });

  it("the 'all' bookmark stays writable", () => {
    // The defect: `setKeptMessages` did `Math.max(1, count)`, so `-1` became
    // `1`. One conversation reset was enough to plant that `1`, and from then on
    // the transcript showed only the prologue forever, even while the narrator
    // was writing and the session was growing.
    worlds.setKeptMessages(worldId, -1);
    expect(worlds.keptMessages(worldId)).toBe(-1);

    // A positive count stays capped, but doesn't drop below the prologue.
    worlds.setKeptMessages(worldId, 3);
    expect(worlds.keptMessages(worldId)).toBe(3);

    worlds.setKeptMessages(worldId, 0);
    expect(worlds.keptMessages(worldId)).toBe(1);

    worlds.setKeptMessages(worldId, -1);
    expect(worlds.keptMessages(worldId)).toBe(-1);
  });
});
