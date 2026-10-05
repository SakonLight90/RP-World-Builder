import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./helpers/http.js";
import { harness, makeCharacter, makeWorld } from "./helpers/http.js";

/**
 * "Restart" opens a new conversation and leaves the old one behind.
 *
 * Don't delete messages one by one: "Delete" can't go below the first
 * message, and that first message may be something no longer yours. But here
 * is the forgotten part: **the cast goes too**, and the removed-character
 * count comes back, because without that number the user presses "Restart",
 * sees empty chat and can't tell if the route did its job or failed silently.
 *
 * The constraint making the number trustworthy is characters are **per-world**:
 * a reset must zero that campaign's cast and not touch the others, which are
 * another game with other people.
 */

let h: Harness;

const reset = (id: string) =>
  h.app.inject({ method: "POST", url: `/api/worlds/${id}/conversation/reset` });

/** A world with an open session, bookmark and two characters on stage. */
function readyWorld(nameOf: string) {
  const world = makeWorld(h, nameOf);
  h.worlds.update(world.id, { opencodeSessionId: "ses_vecchia" });
  h.worlds.setKeptMessages(world.id, 3);
  const first = makeCharacter(h, world.id, "Vera");
  const second = makeCharacter(h, world.id, "Michael");
  h.cast.setRelationship(world.id, {
    worldId: world.id,
    fromCharacterId: first,
    toCharacterId: second,
    affinity: 10,
    trust: 20,
    note: "si conoscono",
  });
  return world;
}

beforeEach(async () => {
  h = await harness({ withBridge: true });
});

afterEach(async () => {
  await h.close();
});

describe("restarting the conversation", () => {
  it("forgets the session and resets the bookmark to 'all'", async () => {
    // Bookmark at 3 is the case that crashed the campaign: after reset it must
    // return to -1, because -1 is "all" not "as many as there were".
    const world = readyWorld("reset-segnalibro");

    const response = await reset(world.id);
    expect(response.statusCode).toBe(200);

    expect(h.worlds.get(world.id)?.opencodeSessionId).toBeNull();
    expect(h.worlds.keptMessages(world.id)).toBe(-1);
  });

  it("deletes the world's characters and tells how many there were", async () => {
    const world = readyWorld("reset-personaggi");

    const response = await reset(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, removedCharacters: 2 });
    expect(h.cast.listCharacters(world.id)).toEqual([]);
  });

  it("doesn't touch another world's cast", async () => {
    // The returned number counts **only** the reset world's: if it counted
    // others too, a user with two campaigns opening "Restart" would see a
    // number explaining nothing.
    const world = readyWorld("reset-mio");
    const other = readyWorld("reset-altro");

    const response = await reset(world.id);
    expect(response.json().removedCharacters).toBe(2);

    expect(
      h.cast
        .listCharacters(other.id)
        .map((c) => c.name)
        .sort(),
    ).toEqual(["Michael", "Vera"]);
    // And the other world wasn't disturbed: its session and bookmark.
    expect(h.worlds.get(other.id)?.opencodeSessionId).toBe("ses_vecchia");
    expect(h.worlds.keptMessages(other.id)).toBe(3);
  });

  it("also takes the deleted characters' relationships", async () => {
    // Relationships are between characters: if they stayed, the day a new
    // character reused the same id it would have relationships with someone
    // never met.
    const world = readyWorld("reset-relazioni");
    expect(h.cast.listRelationships(world.id)).toHaveLength(1);

    await reset(world.id);
    expect(h.cast.listRelationships(world.id)).toEqual([]);
  });

  it("closes the old session instead of leaving it hanging", async () => {
    // Not deleted: if still needed it's better to have it than never recover
    // it. What must not remain is a live abandoned session.
    const world = readyWorld("reset-sessione");

    await reset(world.id);
    expect(h.fake.deleted).toEqual(["ses_vecchia"]);
  });

  it("a world that hasn't started doesn't try closing any session", async () => {
    // Session is `null`: calling `session.delete` with an empty id is a
    // request that can't work and pollutes the count of what really closed.
    const world = makeWorld(h, "reset-mai-cominciato");

    const response = await reset(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, removedCharacters: 0 });
    expect(h.fake.deleted).toEqual([]);
  });

  it("the Bible stays: it's the world, not the conversation", async () => {
    // The route says to touch nothing else, and the Bible is what must never
    // be lost. If reset took it away, the restarted campaign would be a world
    // without premise.
    const world = readyWorld("reset-bible");
    h.worlds.setBibleSection(world.id, "premise", "Appalachia, 2287.");

    await reset(world.id);
    expect(h.worlds.getBible(world.id).premise).toBe("Appalachia, 2287.");
  });

  it("on a characterless world the returned number is zero, not nothing", async () => {
    // Missing `personaggiRimossi` is indistinguishable from a truncated response:
    // the field is there even when zero, because that's a result too.
    const world = makeWorld(h, "reset-senza-gente");

    const response = await reset(world.id);
    expect(response.json()).toEqual({ ok: true, removedCharacters: 0 });
  });
});

describe("when restart isn't possible", () => {
  it("without opencode the route answers 503 and zeroes nothing", async () => {
    // Reset without a bridge is an unexecuted request: if it zeroed the cast
    // it would do it halfway, with the campaign already lost and no narrator
    // to restart with.
    const withoutBridge = await harness();
    try {
      const world = makeWorld(withoutBridge, "reset-senza-ponte");
      withoutBridge.worlds.update(world.id, { opencodeSessionId: "ses_vecchia" });
      makeCharacter(withoutBridge, world.id, "Vera");

      const response = await withoutBridge.app.inject({
        method: "POST",
        url: `/api/worlds/${world.id}/conversation/reset`,
      });
      expect(response.statusCode).toBe(503);
      expect(withoutBridge.cast.listCharacters(world.id)).toHaveLength(1);
      expect(withoutBridge.worlds.get(world.id)?.opencodeSessionId).toBe("ses_vecchia");
    } finally {
      await withoutBridge.close();
    }
  });

  it("a missing world answers 404", async () => {
    const response = await reset("world-does-not-exist");
    expect(response.statusCode).toBe(404);
  });
});
