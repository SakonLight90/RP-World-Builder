import type { StartsState, WorldStart } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openMemory } from "../src/db/connection.js";
import { WORLD_STARTS_SCHEMA } from "../src/db/migrations/010_world_starts.js";
import { WorldRepository } from "../src/db/repo/worlds.js";

/**
 * Several starts inside one world.
 *
 * The thing being protected here is the separation between a setting and a way into
 * it. Fallout used to be one world with one beginning written into the Bible's
 * premise, which meant the second game to be added overwrote the first one's
 * opening. With starts, the world holds the setting and the player picks an opening
 * when they begin playing, so Fallout 3 and New Vegas can both be in the same world
 * without either of them being the other one.
 *
 * Everything degrades instead of failing: a corrupted column costs the player the
 * selector, which they get back by choosing again, while a world that does not load
 * cannot be told apart from a world that does not exist.
 */

/**
 * The column is added by a migration, applied by hand here for the same reason as
 * in `player-character.test.ts`. The guard is there because the day it gets
 * registered in `migrate.ts` a second `ALTER TABLE` would fail the test.
 */
function ensureStartsColumn(db: Database): void {
  const columns = db.prepare<[], { name: string }>("PRAGMA table_info(worlds)").all();
  if (columns.some((column) => column.name === "starts")) return;
  db.exec(WORLD_STARTS_SCHEMA);
}

const STARTS: WorldStart[] = [
  {
    id: "new-vegas",
    name: "Fallout: New Vegas",
    game: "new-vegas",
    playable: true,
    narration: "Goodsprings. A shot goes off behind the buildings and the street empties.",
  },
  {
    id: "fallout-76",
    name: "Fallout 76",
    game: "fallout-76",
    playable: true,
    narration: "Flatwoods. The saloon is quiet and the proprietress has stopped wiping the glass.",
  },
  {
    // Lore only: in the library so the narrator can cite it, not as an opening.
    id: "fallout-1",
    name: "Fallout",
    game: "fallout-1",
    playable: false,
    narration: "",
  },
];

describe("world starts", () => {
  let db: Database;
  let worlds: WorldRepository;
  let worldId: string;

  beforeEach(() => {
    db = openMemory();
    ensureStartsColumn(db);
    worlds = new WorldRepository(db);
    worldId = worlds.create({
      name: "Fallout",
      slug: "fallout",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "/tmp/fallout",
      starts: STARTS,
    }).id;
  });

  it("a new world has the starts it was given, and none selected", () => {
    const world = worlds.get(worldId);
    expect(world?.starts.list.map((s) => s.id)).toEqual(["new-vegas", "fallout-76", "fallout-1"]);
    expect(world?.starts.selectedId).toBeNull();
  });

  it("a world created without starts is not a broken one", () => {
    // Every world built from scratch lands here. An absent field would be
    // indistinguishable from "the column has not been migrated yet", and every
    // reader would need a guard to tell the two apart.
    const plain = worlds.create({
      name: "Plain",
      slug: "plain",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "/tmp/plain",
    });
    expect(plain.starts).toEqual<StartsState>({ list: [], selectedId: null });
  });

  it("choosing a start records it", () => {
    const world = worlds.selectStart(worldId, "fallout-76");
    expect(world?.starts.selectedId).toBe("fallout-76");
    expect(worlds.get(worldId)?.starts.selectedId).toBe("fallout-76");
  });

  it("unselecting takes the choice back", () => {
    // A real state, not a missing field: the player can decide they want to look
    // again, and the campaign goes back to waiting for a choice.
    worlds.selectStart(worldId, "new-vegas");
    expect(worlds.selectStart(worldId, null)?.starts.selectedId).toBeNull();
  });

  it("a lore-only start cannot be selected", () => {
    // Fallout is in the library, so the narrator can cite it. There is no scenario
    // to step into, and letting it be chosen would produce an opening for a game
    // nobody can play.
    expect(() => worlds.selectStart(worldId, "fallout-1")).toThrow(/lore only/);
    // And the refusal leaves the campaign as it was, rather than half chosen.
    expect(worlds.get(worldId)?.starts.selectedId).toBeNull();
  });

  it("a start the world doesn't have is refused, not silently accepted", () => {
    // Correcting this to null would be wrong: null is "the player has not chosen
    // yet", which the selector shows and offers. Answering with a world that has no
    // opening would hide the mistake until the transcript looked empty.
    expect(() => worlds.selectStart(worldId, "cyberpunk-2077")).toThrow(/not one of/);
    expect(worlds.get(worldId)?.starts.selectedId).toBeNull();
  });

  it("a stale selection is dropped when the column is read", () => {
    /*
     * The state the single-column decision exists to prevent from ever being
     * written, reproduced by hand because a database can still arrive that way: a
     * campaign exported from an older version, or edited outside the interface.
     */
    db.prepare("UPDATE worlds SET starts = ? WHERE id = ?").run(
      JSON.stringify({ list: STARTS, selectedId: "shakespeare" }),
      worldId,
    );
    expect(worlds.get(worldId)?.starts.selectedId).toBeNull();
  });

  it("a corrupted column costs the selector and not the world", () => {
    /*
     * The rule every JSON column in this table follows: a world that does not load
     * cannot be told apart from a world that does not exist. Losing the starts costs
     * the player one choice and it can be made again; losing the world costs them
     * the campaign.
     */
    for (const broken of ["not json at all", "[]", "null", '"a string"', '{"list":42}']) {
      db.prepare("UPDATE worlds SET starts = ? WHERE id = ?").run(broken, worldId);
      const world = worlds.get(worldId);
      expect(world, `starts=${broken}`).not.toBeNull();
      expect(world?.starts, `starts=${broken}`).toEqual<StartsState>({
        list: [],
        selectedId: null,
      });
    }
  });

  it("a start with no id is dropped: nothing can point at it", () => {
    db.prepare("UPDATE worlds SET starts = ? WHERE id = ?").run(
      JSON.stringify({
        list: [...STARTS, { id: "   ", name: "No id", game: "", playable: true, narration: "x" }],
        selectedId: null,
      }),
      worldId,
    );
    expect(worlds.get(worldId)?.starts.list.map((s) => s.id)).not.toContain("   ");
    expect(worlds.get(worldId)?.starts.list).toHaveLength(3);
  });

  it("duplicate ids are collapsed", () => {
    // A list with the same id twice is not two starts: a selection naming it would
    // be ambiguous, and the interface would render two buttons pointing at one.
    const first = STARTS[0];
    const second = STARTS[1];
    if (first === undefined || second === undefined) throw new Error("fixture is empty");
    worlds.setStarts(worldId, [first, first, second], null);
    expect(worlds.get(worldId)?.starts.list.map((s) => s.id)).toEqual(["new-vegas", "fallout-76"]);
  });

  it("renaming the world does not wipe the selection", () => {
    // The two are written by different methods on purpose. A `PATCH` of the name
    // must not zero the choice out, or renaming a campaign silently un-begins it.
    worlds.selectStart(worldId, "new-vegas");
    worlds.update(worldId, { name: "Fallout, my campaign" });
    expect(worlds.get(worldId)?.starts.selectedId).toBe("new-vegas");
  });

  it("a clone inherits the starts but not the selection", () => {
    /*
     * The character is not cloned either, and for the same reason: whoever starts
     * from a template has not chosen their protagonist, and a template that arrived
     * with a start already selected would open the new campaign on the previous
     * player's decision.
     */
    worlds.selectStart(worldId, "new-vegas");
    const clone = worlds.clone(worldId, { name: "Fork", slug: "fork" });
    expect(clone.starts.list.map((s) => s.id)).toEqual(["new-vegas", "fallout-76", "fallout-1"]);
    expect(clone.starts.selectedId).toBeNull();
  });
});
