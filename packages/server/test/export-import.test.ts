import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanonRepository } from "../src/db/repo/canon.js";
import type { Harness } from "./helpers/http.js";
import { harness, makeCharacter, makeLocation, makeWorld } from "./helpers/http.js";

/**
 * A backup that's really a backup.
 *
 * Export and import already existed and looked working: import answered 200
 * and created a world. But it copied five of fourteen sections, and the other
 * nine were lost **without an error**. The worst case of all for a copy: you
 * think you have a backup, and the backup is incomplete. Canon, eras,
 * requested libraries and world settings were exactly what was missing, i.e.
 * everything making a campaign recognizable.
 *
 * Here the copy is checked to be **faithful**, not to answer.
 */

let h: Harness;

const exportWorld = (id: string) =>
  h.app.inject({ method: "GET", url: `/api/worlds/${id}/export` });

const importWorld = (file: unknown) =>
  h.app.inject({ method: "POST", url: "/api/import", payload: file as object });

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
});

/** Prepares a world with a bit of everything: eras, cast, places, canon, libraries. */
function richWorld(h: Harness, nameOf: string): string {
  const world = makeWorld(h, nameOf);
  h.worlds.update(world.id, {
    description: "Una campagna di prova.",
    activeLocale: "fr",
    reasoningEffort: "high",
    chapterThresholdRatio: 0.42,
    canonBudgetRatio: 0.11,
    libraries: [{ id: "fallout", version: "1.0.0", hash: "abc123" }],
  });
  h.worlds.setBibleSection(world.id, "premise", "Appalachia, 2287.");
  h.worlds.replaceEras(world.id, [
    { key: "pre-war", label: "Prima della guerra", startYear: 2052, summary: "Il Vecchio Mondo." },
    { key: "post-war", label: "Dopo la guerra", summary: "Oggi." },
  ]);

  const spot = makeLocation(h, world.id, "Morganthown");
  const character0 = makeCharacter(h, world.id, "Vera");
  h.cast.updateCharacter(world.id, character0, { locationId: spot.id });
  h.cast.setRelationship(world.id, {
    worldId: world.id,
    fromCharacterId: character0,
    toCharacterId: makeCharacter(h, world.id, "Christine"),
    affinity: 40,
    trust: -10,
    note: "Si conoscono.",
  });

  new CanonRepository(h.db).upsertMany([
    {
      id: crypto.randomUUID(),
      worldId: world.id,
      subject: "Vera",
      kind: "character",
      aliases: ["la bacheca"],
      summary: "Vestale di Morganthown.",
      facts: ["Gestisce le annunci."],
      era: "post-war",
      status: "active",
      priority: 8,
      tokens: 60,
    },
    {
      id: crypto.randomUUID(),
      worldId: world.id,
      subject: "Sentries",
      kind: "faction",
      aliases: [],
      summary: "Roboti da sorveglianza.",
      facts: ["Disattivati dal 2052."],
      era: "any",
      // A disputed entry counts as a player choice: if the copy loses it, the
      // narrator works with a different canon with nothing flagging it.
      status: "disputed",
      priority: 3,
      tokens: 30,
    },
  ]);

  return world.id;
}

describe("a backup faithful to the original", () => {
  it("brings inside everything it took outside", async () => {
    const source = richWorld(h, "esporta-fedele");
    const file = (await exportWorld(source)).json();

    const response = await importWorld(file);
    expect(response.statusCode).toBe(200);
    const copy = response.json().world;

    // The world and its values.
    expect(copy.name).toBe(file.world.name);
    expect(copy.description).toBe("Una campagna di prova.");
    expect(copy.activeLocale).toBe("fr");
    expect(copy.reasoningEffort).toBe("high");
    expect(copy.chapterThresholdRatio).toBe(0.42);
    expect(copy.canonBudgetRatio).toBe(0.11);
    // Requested libraries: without these the copy's narrator works with a
    // different canon, with nothing flagging it.
    expect(copy.libraries).toEqual(file.world.libraries);

    // The content.
    expect(h.worlds.getBible(copy.id)).toEqual(file.bible);
    expect(
      h.worlds
        .listEras(copy.id)
        .map((e) => e.key)
        .sort(),
    ).toEqual(["post-war", "pre-war"]);

    const cast = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${copy.id}/characters` })
    ).json();
    expect(cast.characters.map((c: { name: string }) => c.name).sort()).toEqual(
      file.characters.map((c: { name: string }) => c.name).sort(),
    );

    const relationships = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${copy.id}/relationships` })
    ).json();
    expect(relationships.relationships).toHaveLength(file.relationships.length);
    expect(relationships.relationships[0]?.note).toBe("Si conoscono.");

    const canon = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${copy.id}/canon` })
    ).json();
    /*
     * `listAll` not the reading route: `/canon` only keeps active-era entries,
     * and comparing them with the unfiltered export would measure the filter,
     * not the copy.
     */
    expect(new CanonRepository(h.db).listAll(copy.id)).toHaveLength(file.canon.length);
    expect(canon.health.total).toBeGreaterThan(0);
  });

  it("also keeps entries the player chose to dispute", async () => {
    // A `disputed` entry is a decision. If the copy drops it, the narrator
    // stops doubting a fact the player wanted doubted.
    const source = richWorld(h, "esporta-disputato");
    const file = (await exportWorld(source)).json();

    const copy = (await importWorld(file)).json().world;
    const entries = new CanonRepository(h.db).listAll(copy.id);

    expect(entries.map((v) => v.subject).sort()).toEqual(["Sentries", "Vera"]);
    expect(entries.find((v) => v.subject === "Sentries")?.status).toBe("disputed");
  });

  it("atomic facts survive, not just the synthesis", async () => {
    // Synthesis is what lands in context, but facts are what search and verify
    // use. Copying only syntax would produce an entry looking equal and not
    // answering questions.
    const source = richWorld(h, "esporta-fatti");
    const file = (await exportWorld(source)).json();

    const copy = (await importWorld(file)).json().world;
    const entries = new CanonRepository(h.db).listAll(copy.id);

    expect(entries.find((v) => v.subject === "Vera")?.facts).toEqual(["Gestisce le annunci."]);
    expect(entries.find((v) => v.subject === "Vera")?.aliases).toEqual(["la bacheca"]);
  });

  it("the character stays tied to its place, not to a vanished id", async () => {
    // The danger of id references: copying characters with `locationId` as in
    // the original, the id wouldn't exist in the copy and the character would
    // end up unplaced.
    const source = richWorld(h, "esporta-luogo");
    const file = (await exportWorld(source)).json();

    const copy = (await importWorld(file)).json().world;
    const cast = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${copy.id}/characters` })
    ).json();
    const vera = cast.characters.find((c: { name: string }) => c.name === "Vera");
    const locations = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${copy.id}/locations` })
    ).json();

    expect(vera?.locationId).toBeTruthy();
    expect(locations.locations.some((l: { id: string }) => l.id === vera?.locationId)).toBe(true);
  });

  it("doesn't reuse the original campaign's ids", async () => {
    // If ids stayed the same, a correction on one copy would touch the other,
    // and nobody would see it.
    const source = richWorld(h, "esporta-id");
    const file = (await exportWorld(source)).json();

    const copy = (await importWorld(file)).json().world;
    const sourceIds = new Set(file.characters.map((c: { id: string }) => c.id));
    const cast = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${copy.id}/characters` })
    ).json();

    expect(cast.characters.some((c: { id: string }) => sourceIds.has(c.id))).toBe(false);
  });

  it("doesn't resume the original campaign's opencode session", async () => {
    // Conversation isn't copied: the two campaigns have different sessions, and
    // if the copy pointed at the original's both worlds would write into the
    // same conversation.
    const source = richWorld(h, "esporta-sessione");
    h.worlds.update(source, { opencodeSessionId: "ses_originale" });
    const file = (await exportWorld(source)).json();

    const copy = (await importWorld(file)).json().world;
    expect(copy.opencodeSessionId).toBeNull();
  });

  it("a file that isn't a campaign is refused, not half imported", async () => {
    expect((await importWorld({ robba: 1 })).statusCode).toBe(400);
    expect((await importWorld({ format: "rpwb-campaign" })).statusCode).toBe(400);
    // Not even a list: `typeof` of an array is "object".
    expect((await importWorld([1, 2, 3])).statusCode).toBe(400);
  });

  it("a previous version file still imports", async () => {
    // Fields today's export writes and yesterday's doesn't must not fail
    // import: otherwise already made copies turn unreadable after an update.
    const source = richWorld(h, "esporta-vecchio");
    const file = (await exportWorld(source)).json();
    delete (file as Record<string, unknown>)["canon"];
    delete (file as Record<string, unknown>)["canonEdits"];

    const response = await importWorld(file);
    expect(response.statusCode).toBe(200);
    const copy = response.json().world;
    // Present sections still get copied.
    expect(h.worlds.listEras(copy.id).length).toBe(2);
  });

  it("an orphan relationship doesn't fail the rest of the import", async () => {
    // If the file lost a character, its relationship can't be rebuilt. Failing
    // everything for that means a partly unreadable file loses everything else
    // too.
    const source = richWorld(h, "esporta-orfana");
    const file = (await exportWorld(source)).json();
    (file as Record<string, unknown>)["characters"] = [];

    const response = await importWorld(file);
    expect(response.statusCode).toBe(200);
    expect(h.worlds.listEras(response.json().world.id).length).toBe(2);
  });
});
