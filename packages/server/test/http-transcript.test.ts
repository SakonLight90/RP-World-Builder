import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness, SessionMessage } from "./helpers/http.js";
import { harness, makeWorld } from "./helpers/http.js";

/**
 * The history the player reopens.
 *
 * This route already broke twice for two different reasons. First is the
 * prologue, message 1, doesn't live on the opencode session: it lives in the
 * world Bible and is rebuilt on every read. If not added, the UI starts from
 * the first line and looks like the world vanished. Second is the deletion
 * bookmark: `kept_messages` says how many messages to show, and when 1 the
 * transcript shows **only** the prologue, whatever gets written. The narrator
 * answers, the session grows, and the UI looks like the prompt never started.
 *
 * Here the route is tested for what the player sees: prologue on top, no
 * engine context in the middle, and the cut that's there.
 */

let h: Harness;

const PROLOGUE = "Appalachia, 2287: the world is post-nuclear.";
const RULES = "No gratuitous violence.";

/**
 * Two playable starts and one lore-only entry.
 *
 * The third exists so the tests can check that a game nobody can play stays out of
 * the selector and cannot be selected: it is in the library as reference, and the
 * rule that keeps it from turning into a campaign that begins nowhere is the point.
 */
const STARTS = [
  {
    id: "new-vegas",
    name: "Fallout: New Vegas",
    game: "new-vegas",
    playable: true,
    narration: "Goodsprings. You wake on the floor with a hole in your head.",
  },
  {
    id: "fallout-76",
    name: "Fallout 76",
    game: "fallout-76",
    playable: true,
    narration: "Flatwoods. The saloon is quiet and the proprietress watches you.",
  },
  {
    id: "fallout-1",
    name: "Fallout",
    game: "fallout-1",
    playable: false,
    narration: "",
  },
];

const LINE: SessionMessage = { role: "user", text: "I open the door." };
const REPLY: SessionMessage = {
  role: "assistant",
  text: "The door gives way with a dry noise.",
};

beforeEach(async () => {
  h = await harness({ withBridge: true });
});

afterEach(async () => {
  await h.close();
});

/** A world with compiled Bible and an already open session. */
function worldWithSession(slug: string, session: SessionMessage[], premise = PROLOGUE) {
  const world = makeWorld(h, slug);
  h.worlds.setBibleSection(world.id, "premise", premise);
  h.worlds.setBibleSection(world.id, "rules", RULES);
  h.worlds.update(world.id, { opencodeSessionId: "ses_1" });
  h.fake.session = session;
  return world;
}

const transcript = (id: string) =>
  h.app.inject({ method: "GET", url: `/api/worlds/${id}/transcript` });

describe("conversation history", () => {
  it("starts from the world prologue, which isn't on the session", async () => {
    // Prologue is built from the Bible on every read: if the route only reads
    // opencode, the first thing the player sees is some random line and the
    // world looks started halfway.
    const world = worldWithSession("chronology-prologue", [LINE, REPLY]);

    const response = await transcript(world.id);
    expect(response.statusCode).toBe(200);

    const payload = response.json<{
      messages: { role: string; text: string; createdAt: number }[];
    }>();
    expect(payload.messages[0]?.text).toBe(`${PROLOGUE}\n\n${RULES}`);
    expect(payload.messages[0]?.role).toBe("assistant");
    // `createdAt` at zero: the prologue happened at no precise moment, and
    // inventing one would put it at the list end instead of on top.
    expect(payload.messages[0]?.createdAt).toBe(0);
    expect(payload.messages[1]?.text).toBe(LINE.text);
  });

  it("a world without prologue gets no invented message on top", async () => {
    // A new world has empty Bible: the first message is the first real line,
    // not an empty block looking like a lost turn.
    const world = makeWorld(h, "chronology-no-prologue");
    h.worlds.update(world.id, { opencodeSessionId: "ses_1" });
    h.fake.session = [LINE, REPLY];

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    expect(payload.messages.map((m) => m.text)).toEqual([LINE.text, REPLY.text]);
  });

  it("falls back to the description when the Bible is still empty", async () => {
    // The prologue used to be assembled out of the Bible alone, so a campaign
    // whose premise and rules had not been filled in had no prologue at all:
    // the story played fine and then resetting the conversation left an empty
    // transcript, which read as a deletion of something that had been there.
    // The description is the player's own line about their campaign, so it can
    // open the story instead of leaving a hole where the opening should be.
    const world = makeWorld(h, "chronology-prologue-da-descrizione");
    h.worlds.update(world.id, {
      description: "A campaign that has not written its Bible yet.",
      opencodeSessionId: "ses_1",
    });
    h.fake.session = [LINE];

    const payload = (await transcript(world.id)).json<{
      messages: { role: string; text: string; createdAt: number }[];
    }>();

    expect(payload.messages[0]?.text).toBe("A campaign that has not written its Bible yet.");
    expect(payload.messages[0]?.role).toBe("assistant");
    expect(payload.messages[0]?.createdAt).toBe(0);
    expect(payload.messages[1]?.text).toBe(LINE.text);
  });

  it("the Bible wins over the description when both are there", async () => {
    // Otherwise editing the premise would appear to do nothing, because the
    // description was already on screen and the two would be indistinguishable.
    const world = worldWithSession("chronology-bible-wins", [LINE], PROLOGUE);
    h.worlds.update(world.id, { description: "A description that must lose." });

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    expect(payload.messages[0]?.text).toBe(`${PROLOGUE}\n\n${RULES}`);
  });

  it("the chosen start becomes the opening, in place of the generic prologue", async () => {
    /*
     * The whole point of the feature.
     *
     * Choosing a start and still being shown the Bible's prologue would leave the
     * choice invisible: the player picks "Goodsprings, on the floor with a hole in
     * your head" and the first line they read is a paragraph about a setting they
     * have not entered yet. The selection would be a field with no consequence,
     * which is the same failure mode as the one the deletion bookmark had.
     */
    const world = worldWithSession("start-opening", [LINE, REPLY]);
    h.worlds.setStarts(world.id, STARTS, "new-vegas");

    const payload = (await transcript(world.id)).json<{
      messages: { role: string; text: string; createdAt: number }[];
    }>();

    expect(payload.messages[0]?.text).toBe(STARTS[0]?.narration);
    expect(payload.messages[0]?.role).toBe("assistant");
    expect(payload.messages[0]?.createdAt).toBe(0);
    // The Bible's opening is replaced, not appended: two openings would be one too
    // many, and the generic one would sit on top of the one the player picked.
    expect(payload.messages.map((m) => m.text)).not.toContain(`${PROLOGUE}\n\n${RULES}`);
    // And the session still starts right after it.
    expect(payload.messages[1]?.text).toBe(LINE.text);
  });

  it("a start with no narration falls through to the Bible", async () => {
    // A start written without a scene is not an opening. Falling back keeps the
    // transcript readable instead of opening it on an empty bubble, and the
    // repository refuses to select one anyway: this is the renderer agreeing with it.
    const world = worldWithSession("start-senza-narrazione", [LINE]);
    h.worlds.setStarts(
      world.id,
      [{ id: "vuoto", name: "No scene", game: "", playable: true, narration: "  " }],
      "vuoto",
    );

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    expect(payload.messages[0]?.text).toBe(`${PROLOGUE}\n\n${RULES}`);
  });

  it("a world that hasn't chosen a start keeps the generic prologue", async () => {
    // The selection is the player's first decision and this must not be spent for
    // them: with starts available and none chosen, the campaign opens on the world
    // itself and the selector waits in the chat.
    const world = worldWithSession("start-non-scelto", [LINE]);
    h.worlds.setStarts(world.id, STARTS, null);

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    expect(payload.messages[0]?.text).toBe(`${PROLOGUE}\n\n${RULES}`);
  });

  it("doesn't show context the engine injects every turn", async () => {
    // The canon block is an engine message: in history it would look like a
    // player-written line, and the player didn't write it.
    const world = worldWithSession("cronologia-contesto", [
      LINE,
      { role: "assistant", text: "## CANON\nThe world is post-nuclear." },
      REPLY,
      { role: "user", text: "[narrator request] Continue the scene." },
    ]);

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    const texts = payload.messages.map((m) => m.text);
    expect(texts).not.toContain("## CANON\nThe world is post-nuclear.");
    expect(texts.some((t) => t.includes("narrator request"))).toBe(false);
    // And the real ones stay: the filter must not eat the conversation.
    expect(texts).toContain(REPLY.text);
    expect(payload.messages).toHaveLength(3);
  });

  it("cleans the narrator response from markers", async () => {
    // The model adds asterisks despite the prompt instruction: if the route
    // didn't clean, raw ones would reach history, formatting noise for
    // readers. Text cleanup belongs to `cleanNarration`: here the route is
    // proven to call it, not skip it.
    const world = worldWithSession("cronologia-marcatori", [
      { role: "assistant", text: "*A light blinks in the room." },
    ]);

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    expect(payload.messages[1]?.text).toBe("A light blinks in the room.");
  });

  it("a not-yet-started campaign shows only the prologue, without calling opencode", async () => {
    // The world was created but no turn started: there's no session to ask,
    // and asking an empty id makes opencode answer with a missing-session
    // error.
    const world = makeWorld(h, "chronography-not-started");
    h.worlds.setBibleSection(world.id, "premise", PROLOGUE);
    h.fake.requested = [];

    const payload = (await transcript(world.id)).json<{ messages: unknown[]; total: number }>();
    expect(payload.messages).toHaveLength(1);
    expect(payload.total).toBe(1);
    expect(h.fake.requested).toEqual([]);
  });
});

describe("the deletion bookmark", () => {
  const five = (): SessionMessage[] => [
    LINE,
    REPLY,
    { role: "user", text: "I look out of the small window." },
    { role: "assistant", text: "The sky is grey." },
    { role: "user", text: "I take the raincoat." },
  ];

  it("without deletions shows everything", async () => {
    const world = worldWithSession("segnalibro-tutti", five());

    const payload = (await transcript(world.id)).json<{ messages: unknown[]; total: number }>();
    // Prologue plus the five messages.
    expect(payload.messages).toHaveLength(6);
    expect(payload.total).toBe(6);
  });

  it("a bookmark of 3 shows the first three messages and leaves the rest out", async () => {
    const world = worldWithSession("segnalibro-tre", five());
    h.worlds.setKeptMessages(world.id, 3);

    const payload = (await transcript(world.id)).json<{
      messages: { text: string }[];
      total: number;
    }>();
    // Cut is from the start, prologue included: it's the count of remaining
    // history messages, not how many arrived after the cut.
    expect(payload.messages).toHaveLength(3);
    expect(payload.messages[0]?.text).toContain(PROLOGUE);
    // `total` tells how many messages really exist: without it, "only prologue"
    // and "all cut" would be the same screen.
    expect(payload.total).toBe(6);
  });

  it("a bookmark of 1 can't be an empty campaign", async () => {
    // The case that got stuck: `Math.max(1, -1)` made 1, and from there the
    // transcript forever showed only the prologue. Here it's proven with
    // `kept_messages` at 1 the route answers, and the prologue is there: the
    // first message, the one never deleted.
    const world = worldWithSession("bookmark-one", five());
    h.worlds.setKeptMessages(world.id, 1);

    const payload = (await transcript(world.id)).json<{ messages: { text: string }[] }>();
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]?.text).toContain(PROLOGUE);
  });

  it("one world's bookmark doesn't cut another's history", async () => {
    const first = worldWithSession("segnalibro-primo", five());
    const second = worldWithSession("segnalibro-secondo", five());
    h.worlds.setKeptMessages(first.id, 2);

    const trimmed = (await transcript(first.id)).json<{ messages: unknown[] }>();
    const whole = (await transcript(second.id)).json<{ messages: unknown[] }>();
    expect(trimmed.messages).toHaveLength(2);
    expect(whole.messages).toHaveLength(6);
  });
});

describe("when there's no world", () => {
  it("answers 404 and doesn't invent a history", async () => {
    const response = await transcript("world-does-not-exist");
    expect(response.statusCode).toBe(404);
    expect(response.json().problem).toBe("World not found");
  });
});
