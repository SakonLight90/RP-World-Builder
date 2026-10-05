import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChapterRepository } from "../src/db/repo/chapters.js";
import type { Harness } from "./helpers/http.js";
import { harness, harnessWorldDir, makeWorld } from "./helpers/http.js";

/**
 * Canon checking, a route asking a model with more than one test.
 *
 * Why it's tested even though judgment always comes from a model: the route
 * has three things that can break unnoticed, because the result is a list and
 * an empty list always looks like a reasonable answer. It must answer 503
 * without a narrator instead of waiting, reject a malformed body **before**
 * looking at opencode, and close the session it opens: a hanging verification
 * session is one more session occupying that world's server.
 *
 * The chapter is written on real disk, because the chapter text is what's
 * judged: judging the summary would be another route.
 */

let h: Harness;
let chapters: ChapterRepository;

const verify = (id: string, payload: unknown = {}) =>
  h.app.inject({
    method: "POST",
    url: `/api/worlds/${id}/verify`,
    payload: payload as object,
  });

/** A chapter with its text on disk, long enough to be judged. */
async function capitoloSuDisco(world: { id: string; opencodeDir: string }, testo: string) {
  const dir = join(world.opencodeDir, "capitoli");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "01.md"), testo, "utf8");
  return chapters.add({
    worldId: world.id,
    locale: "it",
    title: "L'arrivo",
    summary: "Michael arriva a Vault 12.",
    path: join("capitoli", "01.md"),
    tokenStart: 0,
    tokenEnd: 400,
    canonRefs: ["canon-vault-12"],
    arcId: null,
  });
}

const LONG_TEXT = `Michael attraversa il deserto e arriva alla porta del Vault 12.
La guardian chiude il comando e resta in piedi davanti a lui, senza parlare.
Lui mostra il pipistrello, il tubo e la maschera che ha raccolto per strada.`;

beforeEach(async () => {
  h = await harness({ withBridge: true });
  chapters = new ChapterRepository(h.db);
});

afterEach(async () => {
  await h.close();
});

describe("verifying canon", () => {
  it("returns the claims the reviewer judged", async () => {
    const world = makeWorld(h, "verify-esito");
    await capitoloSuDisco(world, LONG_TEXT);
    h.fake.promptReply = JSON.stringify({
      findings: [
        {
          claim: "La guardian chiude il comando e resta in piedi davanti a lui.",
          verdict: "canon",
          canonRef: "canon-vault-12",
          suggestion: "",
        },
      ],
    });

    const response = await verify(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual([
      {
        chapterN: 1,
        claim: "La guardian chiude il comando e resta in piedi davanti a lui.",
        verdict: "canon",
        canonRef: "canon-vault-12",
        suggestion: "",
      },
    ]);
  });

  it("closes the session it opened for judging", async () => {
    // Every verification opens a new session to avoid polluting the
    // conversation. If never closed, the world server keeps one per
    // verification done and occupies context windows the narrator needs.
    const world = makeWorld(h, "verify-sessione");
    await capitoloSuDisco(world, LONG_TEXT);

    await verify(world.id);
    expect(h.fake.deleted).toEqual(["ses_verifica"]);
  });

  it("a too-short chapter isn't judged, and no judgment is invented", async () => {
    // Below that length there's nothing to evaluate: judging two sentences
    // would produce useless notes the player must then dismantle by hand.
    const world = makeWorld(h, "verify-corto");
    await capitoloSuDisco(world, "Two sentences.");
    h.fake.promptReply = JSON.stringify({
      findings: [{ claim: "Due frasi.", verdict: "contradiction" }],
    });

    expect((await verify(world.id)).json().entries).toEqual([]);
  });

  it("a non-JSON answer doesn't fail the route", async () => {
    // Free models don't always respect the schema: the result is an empty
    // list, not a campaign-blocking error.
    const world = makeWorld(h, "verify-risposta-pesante");
    await capitoloSuDisco(world, LONG_TEXT);
    h.fake.promptReply = "Sorry, I was not able to answer in JSON.";

    const response = await verify(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toEqual([]);
  });

  it("a world without chapters opens no session and answers empty", async () => {
    const world = makeWorld(h, "verify-senza-capitoli");

    const response = await verify(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ entries: [] });
    // No verification session opened, so none to close: the criterion
    // distinguishing "nothing to judge" from "judged and found nothing",
    // same screen for the player.
    expect(h.fake.deleted).toEqual([]);
  });

  it("a malformed body is the presser's error, not the narrator's", async () => {
    // Validation comes before the bridge check: a missing language is an
    // immediately fixable error, and answering "opencode unavailable" sends
    // hunting for a problem that isn't there.
    const withoutBridge = await harness();
    try {
      const world = makeWorld(withoutBridge, "verify-corpo-rotto");

      const response = await withoutBridge.app.inject({
        method: "POST",
        url: `/api/worlds/${world.id}/verify`,
        payload: { locale: "x" },
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await withoutBridge.close();
    }
  });

  it("without opencode answers 503 without waiting", async () => {
    const withoutBridge = await harness();
    try {
      const world = makeWorld(withoutBridge, "verify-senza-ponte");

      const response = await withoutBridge.app.inject({
        method: "POST",
        url: `/api/worlds/${world.id}/verify`,
        payload: {},
      });
      expect(response.statusCode).toBe(503);
    } finally {
      await withoutBridge.close();
    }
  });

  it("a missing world answers 404, not an empty list", async () => {
    // An empty list for a missing world is indistinguishable from "nothing to
    // verify": two different screens looking the same.
    const response = await verify("mondo-che-non-esiste");
    expect(response.statusCode).toBe(404);
  });

  it("the world folder is what the database declares, not the current one", async () => {
    // The chapter is read from `opencodeDir`: if the path never arrived, the
    // verification would judge the summary and still look working.
    const world = makeWorld(h, "verify-percorso");
    const dir = harnessWorldDir(h, world.slug);
    await mkdir(join(dir, "capitoli"), { recursive: true });
    await writeFile(join(dir, "capitoli", "01.md"), LONG_TEXT, "utf8");
    chapters.add({
      worldId: world.id,
      locale: "it",
      title: "L'arrivo",
      summary: "Riassunto cortissimo.",
      path: join("capitoli", "01.md"),
      tokenStart: 0,
      tokenEnd: 400,
      canonRefs: [],
      arcId: null,
    });
    h.fake.promptReply = JSON.stringify({
      findings: [{ claim: "Something", verdict: "canon" }],
    });

    const response = await verify(world.id);
    // Had it judged the summary, the chapter wouldn't pass minimum length and
    // the list would be empty.
    expect(response.json().entries).toHaveLength(1);
    expect(h.fake.requested).toEqual([dir]);
  });
});
