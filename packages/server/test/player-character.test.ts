import type { PlayerCharacter } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { buildStateCard } from "../src/canon/state-card.js";
import { openMemory } from "../src/db/connection.js";
import { PLAYER_CHARACTER_SCHEMA } from "../src/db/migrations/005_player_character.js";
import { WorldRepository } from "../src/db/repo/worlds.js";
import { makeWorld } from "./helpers/fixtures.js";

/**
 * The character migration isn't yet registered in `migrate.ts`, so it's applied
 * by hand here.
 *
 * The call is guarded because the day it gets registered `openMemory` will
 * apply the `ALTER TABLE` alone, and a second `ALTER TABLE` on the same column
 * fails the test: from then the path is the same and the test must keep
 * holding untouched.
 */
function ensurePlayerColumn(db: Database): void {
  const columns = db.prepare<[], { name: string }>("PRAGMA table_info(worlds)").all();
  if (columns.some((column) => column.name === "player_character")) return;
  db.exec(PLAYER_CHARACTER_SCHEMA);
}

const NORA: PlayerCharacter = {
  name: "Nora Vale",
  role: "reporter di Morgantown",
  description: "Cerca la cognita perduta, porta con sé la torcia accesa.",
};

function cardFor(world: ReturnType<typeof makeWorld>): string {
  return buildStateCard({
    world,
    currentLocation: null,
    locationAncestry: [],
    presentCharacters: [],
    relationships: [],
    charactersById: new Map(),
    currentChapter: null,
    activeEras: ["2287"],
  }).text;
}

describe("player character", () => {
  let db: Database;
  let worlds: WorldRepository;
  let worldId: string;

  beforeEach(() => {
    db = openMemory();
    ensurePlayerColumn(db);
    worlds = new WorldRepository(db);
    worldId = worlds.create({
      name: "Prova",
      slug: "prova",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "/tmp/prova",
    }).id;
  });

  it("a new world has no character, and doesn't pretend to have one", () => {
    // Empty string would look the same and isn't: the narrator would read it
    // as a field to complete and invent a name.
    const world = worlds.get(worldId);
    expect(world?.player).toBeUndefined();
    expect(cardFor(makeWorld())).not.toContain("You play");
  });

  it("the set character rereads as is", () => {
    worlds.setPlayer(worldId, NORA);
    expect(worlds.get(worldId)?.player).toEqual(NORA);
  });

  it("the character changes without rewriting the rest of the world", () => {
    worlds.setPlayer(worldId, NORA);
    worlds.setPlayer(worldId, { ...NORA, name: "Nora Vale-Hart" });
    const world = worlds.get(worldId);
    expect(world?.player?.name).toBe("Nora Vale-Hart");
    // the rest of the world is intact
    expect(world?.name).toBe("Prova");
  });

  it("the character is removed, and the world returns without one", () => {
    worlds.setPlayer(worldId, NORA);
    expect(worlds.get(worldId)?.player).toEqual(NORA);
    worlds.setPlayer(worldId, null);
    expect(worlds.get(worldId)?.player).toBeUndefined();
  });

  it("corrupt JSON doesn't take the world away", () => {
    worlds.setPlayer(worldId, NORA);
    db.prepare("UPDATE worlds SET player_character = ? WHERE id = ?").run("{non è json", worldId);

    // The world loads: it would also lose name, model and session, and a world
    // that won't start isn't a characterless world, it's a lost world.
    const world = worlds.get(worldId);
    expect(world?.name).toBe("Prova");
    expect(world?.player).toBeUndefined();

    // And JSON that isn't a character counts as no character.
    db.prepare("UPDATE worlds SET player_character = ? WHERE id = ?").run('["Nora"]', worldId);
    expect(worlds.get(worldId)?.player).toBeUndefined();
    db.prepare("UPDATE worlds SET player_character = ? WHERE id = ?").run(
      '{"role":"reporter"}',
      worldId,
    );
    expect(worlds.get(worldId)?.player).toBeUndefined();
  });

  it("the character can be fixed at creation", () => {
    const world = worlds.create({
      name: "Col personaggio",
      slug: "col-personaggio",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "/tmp/col-personaggio",
      player: NORA,
    });
    expect(world.player).toEqual(NORA);
    expect(worlds.getBySlug("col-personaggio")?.player).toEqual(NORA);
  });

  it("the character updates together with the rest of the world", () => {
    expect(worlds.update(worldId, { player: NORA })?.player).toEqual(NORA);
  });

  it("updating the world without character doesn't zero it", () => {
    worlds.setPlayer(worldId, NORA);
    expect(worlds.update(worldId, { name: "Prova rinominata" })?.player).toEqual(NORA);
  });

  it("the character also reads from listings", () => {
    worlds.setPlayer(worldId, NORA);
    expect(worlds.list().map((world) => world.player?.name)).toEqual(["Nora Vale"]);
  });

  it("a template fork doesn't carry the character away", () => {
    // Forking a template means another player, who must declare their own
    // protagonist: inheriting the template writer's name means telling a
    // stranger about someone never met.
    worlds.setPlayer(worldId, NORA);
    const fork = worlds.clone(worldId, { slug: "prova-fork", opencodeDir: "/tmp/fork" });
    expect(fork.player).toBeUndefined();
  });

  it("the character enters context with name, role and description", () => {
    const text = cardFor(makeWorld({ player: NORA }));
    expect(text).toContain("You play");
    expect(text).toContain("Nora Vale");
    expect(text).toContain("reporter di Morgantown");
    expect(text).toContain("Cerca la cognita perduta");
  });

  it("the card is written in English whatever the campaign language is", () => {
    // The card and the prompt that introduces it are both English, and the
    // narrator is told the campaign language separately. What this test really
    // guards is that nobody reintroduces a per-language label map: it used to
    // exist, and the assertion below could not fail because both branches of it
    // produced the same string.
    const text = buildStateCard({
      world: makeWorld({ player: NORA }),
      currentLocation: null,
      locationAncestry: [],
      presentCharacters: [],
      relationships: [],
      charactersById: new Map(),
      currentChapter: null,
      activeEras: ["2287"],
    }).text;
    expect(text).toContain("**You play:** Nora Vale");
  });

  it("the world character isn't declared as who's on stage", () => {
    // Two different things: the protagonist is world data, the scene is what
    // the narrator sees right now. Mixing them makes the narrator write "With
    // you now: nobody" when the player is right there.
    const text = cardFor(makeWorld({ player: NORA }));
    expect(text).toContain("**With you now:** Nobody else is present.");
  });
});
