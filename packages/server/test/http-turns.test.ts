import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUNNING_STALE_MS, TurnRepository } from "../src/db/repo/turns.js";
import type { Harness } from "./helpers/http.js";
import { harness, makeWorld } from "./helpers/http.js";

/**
 * Turns the UI draws, read from the database.
 *
 * Two things must live in the same response, and can't live in two requests:
 * the list and `attivo`. With two requests the two data arrive from two
 * different moments, i.e. the same screen can say "writing" and "no, done"
 * together.
 *
 * `attivo` is the part that can't be done like other fields: a turn nobody is
 * carrying on isn't an ongoing turn. It's the halfway-restarted backend case,
 * and without this distinction the indicator stays on forever. Time here isn't
 * waited: the turn's hour is written directly, because the threshold is proven
 * with time, not by waiting five minutes.
 */

let h: Harness;
let turns: TurnRepository;

const list = (id: string, query = "") =>
  h.app.inject({ method: "GET", url: `/api/worlds/${id}/turns${query}` });

/** Ages a turn as much as wanted, as time would. */
function invecchia(id: string, ms: number): void {
  h.db
    .prepare("UPDATE turns SET created_at = ? WHERE id = ?")
    .run(new Date(Date.now() - ms).toISOString(), id);
}

beforeEach(async () => {
  h = await harness();
  turns = new TurnRepository(h.db);
});

afterEach(async () => {
  await h.close();
});

describe("the turn list", () => {
  it("a world without turns answers empty, and no ongoing turn", async () => {
    const world = makeWorld(h, "turns-vuoto");

    expect((await list(world.id)).json()).toEqual({ turns: [], active: null });
  });

  it("goes newest to oldest, even at the same hour", async () => {
    const world = makeWorld(h, "turns-ordine");
    const first = turns.start(world.id, "Primo.", "it");
    const second = turns.start(world.id, "Secondo.", "it");
    const terzo = turns.start(world.id, "Terzo.", "it");
    // Three rows can share the hour: order can't depend on it, otherwise the
    // list changes from one read to the next.
    h.db.prepare("UPDATE turns SET created_at = ?").run("2026-10-01T10:00:00.000Z");

    const payload = (await list(world.id)).json<{ turns: { id: string }[] }>();
    expect(payload.turns.map((t) => t.id)).toEqual([terzo.id, second.id, first.id]);
  });

  it("a closed turn stays listed with its text or its reason", async () => {
    const world = makeWorld(h, "turni-esiti");
    const failed = turns.start(world.id, "It will fail.", "it");
    turns.fail(failed.id, "Provider error");
    const succeeded = turns.start(world.id, "It will succeed.", "it");
    turns.complete(succeeded.id, "The light returns.");

    const payload = (await list(world.id)).json<{
      turns: { id: string; state: string; text: string | null; error: string | null }[];
    }>();
    expect(payload.turns.map((t) => t.id)).toEqual([succeeded.id, failed.id]);
    expect(payload.turns[0]?.text).toBe("The light returns.");
    expect(payload.turns[1]?.error).toBe("Provider error");
    // And neither is ongoing.
    expect(payload.turns.every((t) => t.state !== "running")).toBe(true);
  });

  it("doesn't mix worlds", async () => {
    const mine = makeWorld(h, "turns-mio");
    const other = makeWorld(h, "turns-altro");
    turns.start(mine.id, "Here.", "it");
    turns.start(other.id, "There.", "it");

    const payload = (await list(mine.id)).json<{ turns: { prompt: string }[] }>();
    expect(payload.turns.map((t) => t.prompt)).toEqual(["Here."]);
  });

  it("the UI-requested limit is respected", async () => {
    // Chat asks last turns to draw the screen bottom: without a limit, a
    // thousand-turn world sends the whole story on every open.
    const world = makeWorld(h, "turns-limite");
    for (const text of ["One.", "Two.", "Three."]) turns.start(world.id, text, "it");

    const payload = (await list(world.id, "?limit=2")).json<{ turns: { prompt: string }[] }>();
    expect(payload.turns.map((t) => t.prompt)).toEqual(["Three.", "Two."]);
  });

  it("a non-numeric limit doesn't fail the request", async () => {
    // It's a query-string field: can arrive empty, non-numeric, or negated.
    // Failing here would mean an empty screen with a console error.
    const world = makeWorld(h, "turns-limite-rotto");
    turns.start(world.id, "One.", "it");

    const payload = (await list(world.id, "?limit=junk")).json<{ turns: unknown[] }>();
    expect(payload.turns).toHaveLength(1);
  });
});

describe("the ongoing turn", () => {
  it("is what the narrator is writing right now", async () => {
    const world = makeWorld(h, "turns-attivo");
    const closed = turns.start(world.id, "Before.", "it");
    turns.complete(closed.id, "The door gives way.");
    const ongoing = turns.start(world.id, "I am writing.", "it");

    const payload = (await list(world.id)).json<{
      active: string | null;
      turns: { id: string; state: string }[];
    }>();
    expect(payload.active).toBe(ongoing.id);
    expect(payload.turns.find((t) => t.id === ongoing.id)?.state).toBe("running");
  });

  it("isn't an old turn left hanging", async () => {
    // It's the halfway-restarted backend: nobody writing, the row still
    // `running`, and without this check UI would show "writing" for a turn
    // that no longer exists. Time is injected by writing the turn hour: no
    // real wait, and the result doesn't depend on the machine.
    const world = makeWorld(h, "turns-interrotto");
    const turn = turns.start(world.id, "I open the door.", "it");
    invecchia(turn.id, RUNNING_STALE_MS + 60_000);

    const payload = (await list(world.id)).json<{
      active: string | null;
      turns: { id: string; state: string; text: string | null; finishedAt: string | null }[];
    }>();
    // The list shows it, but declaring it was interrupted.
    expect(payload.turns[0]?.state).toBe("stale");
    expect(payload.turns[0]?.text).toBeNull();
    // And it doesn't invent an end hour nobody wrote.
    expect(payload.turns[0]?.finishedAt).toBeNull();
    expect(payload.active).toBeNull();
  });

  it("a just-born turn is still alive", async () => {
    const world = makeWorld(h, "turns-vivo");
    const turn = turns.start(world.id, "I open the door.", "it");

    const payload = (await list(world.id)).json<{ active: string | null }>();
    expect(payload.active).toBe(turn.id);
  });
});
