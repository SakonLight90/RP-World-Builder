import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness, SessionMessage } from "./helpers/http.js";
import { harness, makeWorld } from "./helpers/http.js";

/**
 * "Delete" takes **one** message. One only, never two, never zero.
 *
 * The remaining-message count is stored on the world, because opencode doesn't
 * delete: `session.revert` answers success and leaves messages where they are.
 * Leaning "Delete" on `revert` looked right and isn't: the message vanished and
 * came back on first refresh, which is the defect the route fixes by returning
 * the count and saving it.
 *
 * Here the route is proven to cut from the start, respect an already reduced
 * bookmark, and never drop below the prologue: below the prologue there's no
 * world nor campaign left.
 */

let h: Harness;

const drop = (id: string) =>
  h.app.inject({ method: "POST", url: `/api/worlds/${id}/message/drop` });

const SESSION: SessionMessage[] = [
  { role: "user", text: "I open the door." },
  { role: "assistant", text: "The door gives way with a dry noise." },
  { role: "user", text: "I look out of the small window." },
  { role: "assistant", text: "The sky is grey." },
];

/** A world with prologue, open session and the four messages above. */
function readyWorld(nameOf: string, session: SessionMessage[] = SESSION) {
  const world = makeWorld(h, nameOf);
  h.worlds.setBibleSection(world.id, "premise", "Appalachia, 2287.");
  h.worlds.update(world.id, { opencodeSessionId: "ses_1" });
  h.fake.session = session;
  return world;
}

beforeEach(async () => {
  h = await harness({ withBridge: true });
});

afterEach(async () => {
  await h.close();
});

describe("deleting the last message", () => {
  it("takes one and says so", async () => {
    const world = readyWorld("drop-one");
    // Prologue plus four messages.
    const before = 5;

    const response = await drop(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kept: before - 1, removed: 1 });
    expect(h.worlds.keptMessages(world.id)).toBe(before - 1);
  });

  it("repeating always takes one at a time, no faster", async () => {
    // The defect this number prevents is eating two messages for one click:
    // the user presses once and loses a scene piece they wrote.
    const world = readyWorld("drop-ripetuto");

    const conti = [await drop(world.id), await drop(world.id), await drop(world.id)];
    expect(conti.map((r) => r.json().kept)).toEqual([4, 3, 2]);
    for (const response of conti) expect(response.json().removed).toBe(1);
  });

  it("starts from the already reduced bookmark instead of resetting to all", async () => {
    // The bookmark is what the player already deleted: restarting from the
    // total would resurrect messages already removed.
    const world = readyWorld("drop-da-segnalibro");
    h.worlds.setKeptMessages(world.id, 3);

    const response = await drop(world.id);
    expect(response.json()).toEqual({ kept: 2, removed: 1 });
  });

  it("doesn't touch another world's bookmark", async () => {
    const world = readyWorld("drop-mio");
    const other = readyWorld("drop-altro");
    h.worlds.setKeptMessages(other.id, 2);

    await drop(world.id);
    expect(h.worlds.keptMessages(other.id)).toBe(2);
  });

  it("tells opencode where to resume, without pretending it deletes", async () => {
    // Revert deletes nothing: it only lets opencode know the conversation was
    // truncated. The kept message is the second-to-last of those the session
    // really holds.
    const world = readyWorld("drop-revert");

    await drop(world.id);
    expect(h.fake.reverted).toEqual(["msg_2"]);
    expect(h.fake.deleted).toEqual([]);
  });
});

describe("when deletion isn't possible", () => {
  it("a not-yet-started campaign answers 409 and doesn't touch the bookmark", async () => {
    // Without a session there's nothing to delete: answering 200 with an
    // invented count would make the click look successful.
    const world = makeWorld(h, "drop-not-started");
    h.worlds.setBibleSection(world.id, "premise", "Appalachia, 2287.");

    const response = await drop(world.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().problem).toContain("has not started yet");
    expect(h.worlds.keptMessages(world.id)).toBe(-1);
    expect(h.fake.reverted).toEqual([]);
  });

  it("with only the prologue trace deletion is refused", async () => {
    // Below the prologue there's nowhere to resume from, so no going lower:
    // the prologue is the message giving meaning to everything after.
    const world = readyWorld("drop-prologue-only", []);

    const response = await drop(world.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toContain("prologue");
    expect(h.worlds.keptMessages(world.id)).toBe(-1);
  });

  it("a bookmark already at one doesn't drop below the prologue", async () => {
    const world = readyWorld("drop-bookmark-one");
    h.worlds.setKeptMessages(world.id, 1);

    const response = await drop(world.id);
    expect(response.statusCode).toBe(400);
    // Bookmark stays as it was: a refused request can't change the count,
    // otherwise refusal would already do half the job.
    expect(h.worlds.keptMessages(world.id)).toBe(1);
  });

  it("if the session can't be read, the response says so with no half work", async () => {
    // The count updates only after opencode answered: if reading fails, the
    // number stays as before and the next deletion starts from the same point
    // instead of skipping a message.
    const world = readyWorld("drop-lettura-fallita");
    h.fake.messageError = new Error("opencode is not reachable");

    const response = await drop(world.id);
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toContain("not reachable");
    expect(h.worlds.keptMessages(world.id)).toBe(-1);
    expect(h.fake.reverted).toEqual([]);
  });

  it("a missing world answers 404", async () => {
    const response = await drop("world-does-not-exist");
    expect(response.statusCode).toBe(404);
  });

  it("without opencode the route answers 503 before touching the world", async () => {
    const withoutBridge = await harness();
    try {
      const world = makeWorld(withoutBridge, "drop-senza-ponte");
      withoutBridge.worlds.update(world.id, { opencodeSessionId: "ses_1" });

      const response = await withoutBridge.app.inject({
        method: "POST",
        url: `/api/worlds/${world.id}/message/drop`,
      });
      expect(response.statusCode).toBe(503);
      expect(withoutBridge.worlds.keptMessages(world.id)).toBe(-1);
    } finally {
      await withoutBridge.close();
    }
  });
});
