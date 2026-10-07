import { localeName, type TokenUsage, type World } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveRoots } from "../src/config/paths.js";
import { openMemory } from "../src/db/connection.js";
import { TURNS_SCHEMA } from "../src/db/migrations/006_turns.js";
import { RUNNING_STALE_MS, TurnRepository } from "../src/db/repo/turns.js";
import { WorldRepository } from "../src/db/repo/worlds.js";
import { runTurnWithDeadline } from "../src/http/turn-coordinator.js";
import type { Narrator } from "../src/opencode/narrator.js";
import { languageBlock, parseTurnEvent, TURN_TIMEOUT_MS } from "../src/turns/pipeline.js";
import { CampaignSession } from "../src/turns/session.js";

/**
 * A turn can't stay `running` forever, and a session whose provider errored
 * isn't reused indefinitely.
 *
 * The two defects were born together and look the same: the campaign freezes
 * and the interface keeps saying "writing". Here the two things keeping them
 * alive are covered, with a time that isn't the real one: the threshold is a
 * parameter, so the test doesn't wait four minutes and isn't hunting for a
 * second of delay on an idle machine.
 *
 * Time itself isn't the defect: the defect is the way time can fail to arrive.
 * That's why the case under test is precisely the one where `play()` **never
 * returns**, which is the real situation, measured.
 */

const USAGE: TokenUsage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };

/**
 * Lore root for a session with no libraries.
 *
 * The parameter is mandatory here too: if a test could omit it, production could
 * do the same, and the defect born from that is exactly the one this file isn't
 * testing.
 */
const LORE = resolveRoots().lore;

let db: Database;
let worlds: WorldRepository;
let turns: TurnRepository;
let worldId: string;

beforeEach(() => {
  db = openMemory();
  const table = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='turns'",
    )
    .get();
  if (table === undefined) db.exec(TURNS_SCHEMA);
  worlds = new WorldRepository(db);
  turns = new TurnRepository(db);
  worldId = worlds.create({
    name: "Prova",
    slug: "prova",
    model: "opencode/space-bunny-free",
    smallModel: "opencode/space-bunny-free",
    opencodeDir: "C:/tmp/prova",
  }).id;
});

/** A promise that never resolves: the case time must defeat. */
function pending(): Promise<never> {
  return new Promise<never>(() => {});
}

/**
 * The world just created.
 *
 * It must be reread from the database and not kept in hand from the creation,
 * because that's what the rest of the code does: after an `update` the value in
 * memory is no longer the one on disk, and using it here would be a way of
 * testing something that doesn't happen in production.
 */
function makeWorld(id: string): World {
  const found = worlds.get(id);
  if (found === null) throw new Error(`test world not found: ${id}`);
  return found;
}

interface Close {
  event: string;
  data: unknown;
}

function closer(): {
  fn: (turnId: string, event: string, data: unknown) => void;
  called: Close[];
} {
  const called: Close[] = [];
  return {
    called,
    fn: (_turnId, event, data) => {
      called.push({ event, data });
    },
  };
}

describe("a turn that produces nothing", () => {
  it("becomes failed, it doesn't stay running", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    await runTurnWithDeadline(
      turn.id,
      turns,
      { play: () => pending(), abort: async () => undefined },
      () => undefined,
      // Small threshold: what's tested here is the logic, not a real turn's duration.
      60,
    );

    const closed = turns.get(worldId, turn.id);
    expect(closed?.state).toBe("failed");
    expect(closed?.text).toBeNull();
    expect(closed?.finishedAt).not.toBeNull();
    // and it's no longer the world's ongoing turn
    expect(turns.active(worldId)).toBeNull();
  });

  it("says why it failed, and not with a generic reason", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    await runTurnWithDeadline(
      turn.id,
      turns,
      { play: () => pending(), abort: async () => undefined },
      () => undefined,
      60,
    );

    const error = turns.get(worldId, turn.id)?.error ?? "";
    // The player must be able to understand that time ran out, not that
    // something went wrong in the world.
    expect(error).toContain("did not answer within");
    expect(error.length).toBeGreaterThan(20);
  });

  it("interrupts the session, otherwise opencode keeps working", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    let aborted = false;

    await runTurnWithDeadline(
      turn.id,
      turns,
      {
        play: () => pending(),
        abort: async () => {
          aborted = true;
        },
      },
      () => undefined,
      60,
    );

    expect(aborted).toBe(true);
  });

  it("closes the stream with the error, not with silence", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    const close = closer();

    await runTurnWithDeadline(
      turn.id,
      turns,
      { play: () => pending(), abort: async () => undefined },
      close.fn,
      60,
    );

    expect(close.called).toHaveLength(1);
    expect(close.called[0]?.event).toBe("error");
  });
});

describe("a turn that goes well", () => {
  it("closes the row with the text", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    const close = closer();

    await runTurnWithDeadline(
      turn.id,
      turns,
      {
        play: async () => ({
          sessionId: "ses_1",
          usage: USAGE,
          text: "La porta cede con un rumore secco.",
          debug: {} as never,
          cost: null,
        }),
        abort: async () => undefined,
      },
      close.fn,
      5_000,
    );

    const closed = turns.get(worldId, turn.id);
    expect(closed?.state).toBe("completed");
    expect(closed?.text).toBe("La porta cede con un rumore secco.");
    expect(close.called[0]?.event).toBe("done");
  });

  it("doesn't wait for the deadline when the work finishes earlier", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    const startTime = Date.now();

    await runTurnWithDeadline(
      turn.id,
      turns,
      {
        play: async () => ({
          sessionId: "ses_1",
          usage: USAGE,
          text: "Una luce lampeggia.",
          debug: {} as never,
          cost: null,
        }),
        abort: async () => undefined,
      },
      () => undefined,
      // Enormous deadline: if the function waited for it, the test would last
      // forever. The fact that it returns at once is the check.
      600_000,
    );

    expect(Date.now() - startTime).toBeLessThan(2_000);
    expect(turns.get(worldId, turn.id)?.state).toBe("completed");
  });
});

describe("a turn with no text isn't a successful turn", () => {
  it("empty text is failed with a reason", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    await runTurnWithDeadline(
      turn.id,
      turns,
      {
        play: async () => ({
          sessionId: "ses_1",
          usage: USAGE,
          text: "",
          debug: {} as never,
          cost: null,
        }),
        abort: async () => undefined,
      },
      () => undefined,
      5_000,
    );

    const closed = turns.get(worldId, turn.id);
    // Never `completed` with empty text: in the interface it's indistinguishable
    // from a narrator that chose to stay silent, and that's a lie.
    expect(closed?.state).toBe("failed");
    expect(closed?.text).toBeNull();
    expect(closed?.error).toContain("wrote nothing");
  });

  it("a single space isn't text", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    await runTurnWithDeadline(
      turn.id,
      turns,
      {
        play: async () => ({
          sessionId: "ses_1",
          usage: USAGE,
          text: "   \n  ",
          debug: {} as never,
          cost: null,
        }),
        abort: async () => undefined,
      },
      () => undefined,
      5_000,
    );

    expect(turns.get(worldId, turn.id)?.state).toBe("failed");
  });

  it("a narrator error closes the row with its reason", async () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    await runTurnWithDeadline(
      turn.id,
      turns,
      {
        play: () => Promise.reject(new Error("Error from provider (Console): ...")),
        abort: async () => undefined,
      },
      () => undefined,
      5_000,
    );

    const closed = turns.get(worldId, turn.id);
    expect(closed?.state).toBe("failed");
    expect(closed?.error).toContain("Error from provider");
  });
});

describe("a failed session isn't reused", () => {
  /** Fake narrator: counts how many sessions were opened. */
  function fakeNarrator(): { narrator: Narrator; create: () => number } {
    let create = 0;
    const narrator = {
      createSession: async () => {
        create += 1;
        return `ses_${create}`;
      },
      sessionExists: async () => true,
    } as unknown as Narrator;
    return { narrator, create: () => create };
  }

  it("after a failure the next turn opens a new one", async () => {
    const { narrator, create } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);

    const first = await campaign.ensure(makeWorld(worldId));
    expect(first).toBe("ses_1");
    expect(create()).toBe(1);

    // The turn on this session ended badly.
    campaign.markSessionFailed(worldId, first);

    const second = await campaign.ensure(makeWorld(worldId));
    // A new session, not the one that already failed.
    expect(second).not.toBe(first);
    expect(second).toBe("ses_2");
    expect(create()).toBe(2);
    expect(worlds.get(worldId)?.opencodeSessionId).toBe("ses_2");
  });

  it("a healthy session is reused instead", async () => {
    const { narrator, create } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);

    const first = await campaign.ensure(makeWorld(worldId));
    const second = await campaign.ensure(makeWorld(worldId));

    expect(second).toBe(first);
    expect(create()).toBe(1);
  });

  it("a world with no failures never changes session", async () => {
    const { narrator, create } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);

    await campaign.ensure(makeWorld(worldId));
    await campaign.ensure(makeWorld(worldId));
    await campaign.ensure(makeWorld(worldId));

    expect(create()).toBe(1);
  });

  it("one world's failure doesn't touch the others", async () => {
    const { narrator } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);
    const other = worlds.create({
      name: "Altro",
      slug: "altro",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "C:/tmp/altro",
    }).id;

    const mine = await campaign.ensure(makeWorld(worldId));
    campaign.markSessionFailed(worldId, mine);

    const theirs = await campaign.ensure(makeWorld(other));
    expect(theirs).toBeTruthy();
    expect(campaign.failedSession(worldId)).toBe(mine);
    expect(campaign.failedSession(other)).toBeNull();
  });

  it("a turn closed as failed makes the session get thrown away even after a restart", async () => {
    // This is the case the in-memory bookmark doesn't cover: the backend has
    // restarted, the suspended session is still the one saved on the world, and
    // without this check the first turn after the restart would reuse it.
    worlds.update(worldId, { opencodeSessionId: "ses_appesa" });
    const failed = turns.start(worldId, "Apro la porta.", "it");
    turns.fail(failed.id, "Stream interrupted before the end of the turn");

    const { narrator, create } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);

    expect(campaign.latestFailedSession(worldId)).toBe("ses_appesa");

    const created = await campaign.ensure(makeWorld(worldId));
    expect(created).not.toBe("ses_appesa");
    expect(create()).toBe(1);
  });

  it("a last successful turn doesn't make the session get thrown away", async () => {
    worlds.update(worldId, { opencodeSessionId: "ses_buona" });
    const good = turns.start(worldId, "Apro la porta.", "it");
    turns.complete(good.id, "La porta cede.");

    const { narrator, create } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);

    expect(campaign.latestFailedSession(worldId)).toBeNull();
    await campaign.ensure(makeWorld(worldId));
    expect(create()).toBe(0);
  });

  it("an ongoing turn doesn't count as failed", async () => {
    worlds.update(worldId, { opencodeSessionId: "ses_occupata" });
    turns.start(worldId, "Sto scrivendo.", "it");

    const { narrator } = fakeNarrator();
    const campaign = new CampaignSession(db, narrator, LORE);

    // A turn somebody is carrying forward isn't a turn that ended badly, and
    // must not cost the conversation.
    expect(campaign.latestFailedSession(worldId)).toBeNull();
  });
});

describe("the narrator's events", () => {
  const session = "ses_1";
  /** The two messages the stream echoes back and that aren't the reply. */
  const toDiscard = new Set(["msg_giocatore", "msg_canone"]);

  /** A text part, with the message it belongs to. */
  function part(messageID: string, text: string): unknown {
    return {
      type: "message.part.updated",
      properties: {
        part: { sessionID: session, messageID, id: "prt_1", type: "text", text },
      },
    };
  }

  it("the narrator's text gets through", () => {
    const event = parseTurnEvent(part("msg_del_narratore", "Una luce."), session, toDiscard);
    expect(event).toEqual({ kind: "text", delta: "Una luce.", partId: "prt_1" });
  });

  it("an event from another campaign is discarded", () => {
    const event = parseTurnEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "ses_altra",
            messageID: "msg_del_narratore",
            id: "prt_1",
            type: "text",
            text: "Una luce.",
          },
        },
      },
      session,
      toDiscard,
    );
    expect(event).toBeNull();
  });

  it("the player's prompt isn't repeated at the head of the reply", () => {
    // Real, measured defect: we filter by message id and not on text, because
    // the player's prompt has no markers. With a text filter it passed, and the
    // narrator's reply started by repeating it.
    const event = parseTurnEvent(
      part("msg_giocatore", "Michael entra a Flatwoods e guarda la bacheca dei lavori."),
      session,
      toDiscard,
    );
    expect(event).toBeNull();
  });

  it("injected canon isn't shown as a line of dialogue", () => {
    // The canon block is an engine message and the stream echoes it back:
    // without this filter it would appear at the head of the reply.
    const event = parseTurnEvent(
      part("msg_canone", "## CANON\nThe world is post-nuclear."),
      session,
      toDiscard,
    );
    expect(event).toBeNull();
  });

  it("a narrator quoting the canon isn't discarded", () => {
    // The filter is on ids, so a narrator's part gets through even if the text
    // contains a marker: otherwise a legitimate quote would disappear.
    const event = parseTurnEvent(part("msg_del_narratore", "## CANON"), session, toDiscard);
    expect(event).toEqual({ kind: "text", delta: "## CANON", partId: "prt_1" });
  });

  it("session.idle closes the turn", () => {
    const event = parseTurnEvent(
      { type: "session.idle", properties: { sessionID: session } },
      session,
      toDiscard,
    );
    expect(event).toEqual({ kind: "done", usage: null });
  });

  it("a session error carries the provider's message", () => {
    const event = parseTurnEvent(
      {
        type: "session.error",
        properties: {
          sessionID: session,
          error: { name: "APIError", data: { message: "Error from provider (Console)" } },
        },
      },
      session,
      toDiscard,
    );
    expect(event).toEqual({ kind: "error", message: "Error from provider (Console)" });
  });

  it("a keep-alive isn't a turn event", () => {
    expect(
      parseTurnEvent({ type: "server.heartbeat", properties: {} }, session, toDiscard),
    ).toBeNull();
    expect(
      parseTurnEvent({ type: "server.connected", properties: {} }, session, toDiscard),
    ).toBeNull();
  });
});

describe("the deadline threshold", () => {
  it("the internal limit leaves room for the work that comes before the stream", () => {
    // Not 180s as before: 180s only covered reading the events, while the limit
    // here covers the whole turn, chapters and context included. It must stay
    // below the repository's `RUNNING_STALE_MS` (5 minutes), otherwise the row
    // would age into `stale` instead of becoming `failed` with a reason.
    expect(TURN_TIMEOUT_MS).toBe(240_000);
    expect(TURN_TIMEOUT_MS).toBeLessThan(RUNNING_STALE_MS);
    expect(TURN_TIMEOUT_MS).toBeGreaterThan(180_000);
  });
});

/**
 * The language the narrator receives on every turn.
 *
 * It lives here and not only in the agent test because they're two different
 * points with two different sources: the agent brings the world's language, the
 * turn the one the interface just asked for. If the turn didn't declare it, the
 * agent would say "Italian" to a world playing in English and the narrator
 * would write in Italian all the same.
 */
describe("the turn's language", () => {
  it("the code becomes the language name", () => {
    expect(languageBlock("it")).toContain("Italian");
    expect(languageBlock("en")).toContain("English");
    expect(languageBlock("es")).toContain("Spanish");
    expect(languageBlock("fr")).toContain("French");
    expect(languageBlock("de")).toContain("German");
  });

  it("the block forbids recycling the library's words", () => {
    const block = languageBlock("it");
    expect(block).toContain("## LANGUAGE");
    expect(block).toContain("is in English");
    expect(block).toContain("use its facts");
  });

  it("no language gets lost on the way", () => {
    // A language not in the map is declared with its code: declaring a specific
    // language to someone playing in Portuguese is wrong in the way nobody reports.
    expect(localeName("pt")).toBe("pt");
    expect(localeName("pt-BR")).toBe("pt");
    // With the subtag, because that's the form browsers send: without it a
    // British English would reach the prompt as a code and the narrator would
    // write in the default language, which is the defect that was meant to be removed.
    expect(localeName("en-GB")).toBe("English");
    // Only when there's no code at all: the one case where the default is the
    // only sensible guess, and it's the default that already holds everywhere else.
    expect(localeName("")).toBe("English");
    expect(localeName("  ")).toBe("English");
  });
});
