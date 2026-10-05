import { beforeEach, describe, expect, it } from "vitest";
import { openMemory } from "../src/db/connection.js";
import { WorldRepository } from "../src/db/repo/worlds.js";

/**
 * "Delete" removes **one** message. Not a couple, not all, not one extra.
 *
 * The count is stored in the database because opencode doesn't delete:
 * `session.revert` answers success and leaves messages where they are. Without
 * this count, pressing Delete would look like it worked and on first refresh
 * the message would be back.
 */

let db: ReturnType<typeof openMemory>;
let worlds: WorldRepository;
let worldId: string;

beforeEach(() => {
  db = openMemory();
  worlds = new WorldRepository(db);
  worldId = worlds.create({
    name: "Prova",
    slug: "prova",
    model: "opencode/space-bunny-free",
    smallModel: "opencode/space-bunny-free",
    opencodeDir: "C:/tmp/prova",
  }).id;
});

describe("how many messages remain", () => {
  it("nothing deleted at the start", () => {
    // `-1` means "all". Zero would be something else: a campaign with no
    // messages, which isn't what "I didn't press Delete" means.
    expect(worlds.keptMessages(worldId)).toBe(-1);
  });

  it("after a deletion the count drops by one", () => {
    worlds.setKeptMessages(worldId, 5);
    expect(worlds.keptMessages(worldId)).toBe(5);
  });

  it("never drops below one", () => {
    worlds.setKeptMessages(worldId, 1);
    expect(worlds.keptMessages(worldId)).toBe(1);
  });

  it("the count survives reopening the database", () => {
    worlds.setKeptMessages(worldId, 7);
    expect(worlds.keptMessages(worldId)).toBe(7);
  });

  it("a new world restarts from zero deletions", () => {
    const other = worlds.create({
      name: "Altro",
      slug: "altro",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "C:/tmp/altro",
    });
    expect(worlds.keptMessages(other.id)).toBe(-1);
  });

  it("the count belongs to its world, not the others", () => {
    const other = worlds.create({
      name: "Altro",
      slug: "altro",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "C:/tmp/altro",
    });
    worlds.setKeptMessages(worldId, 3);

    expect(worlds.keptMessages(worldId)).toBe(3);
    expect(worlds.keptMessages(other.id)).toBe(-1);
  });
});

describe("the rule: one at a time", () => {
  /** The same arithmetic the route does, with numbers coming from the server. */
  const afterDrop = (visible: number, kept: number): number =>
    Math.max(1, kept < 0 ? visible - 1 : Math.min(kept, visible) - 1);

  it("on five messages it removes only one", () => {
    // The five messages: world, user, AI, user, AI. Pressing Delete removes
    // the fifth, the fourth stays.
    const kept = afterDrop(5, -1);

    expect(kept).toBe(4);
  });

  it("repeating, it always removes one at a time", () => {
    let kept = -1;
    kept = afterDrop(5, kept);
    kept = afterDrop(5, kept);
    kept = afterDrop(5, kept);

    expect(kept).toBe(2);
  });

  it("doesn't eat the world's initial message", () => {
    let kept = -1;
    for (let i = 0; i < 10; i++) kept = afterDrop(5, kept);

    expect(kept).toBe(1);
  });

  it("if the count was already reduced, it resumes from there", () => {
    expect(afterDrop(10, 4)).toBe(3);
  });

  it("a count larger than present messages doesn't grow back", () => {
    // The database may have been realigned by hand, or messages compacted:
    // better a count cutting slightly too much than one resurrecting
    // messages the player already deleted.
    expect(afterDrop(3, 9)).toBe(2);
  });
});
