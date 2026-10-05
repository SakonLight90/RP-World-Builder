import type { WorldStart } from "@rpwb/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./helpers/http.js";
import { harness, makeWorld } from "./helpers/http.js";

/**
 * Choosing how a campaign begins, over HTTP.
 *
 * The route exists so the choice is a step of playing and not a field on the
 * creation form: the world is the setting, and the player picks a way into it once
 * they are in the chat, where the narration of each start is the first thing they
 * will read.
 *
 * The two refusals are the interesting part. Both are 400s with distinct codes,
 * because the interface says two different things: an id the world does not have
 * means the campaign was forked from a template that has since changed and the
 * player has to choose again, while a lore-only start means the interface offered
 * something the project has no opening for. Collapsing them into one code would
 * leave the player reading "no such start" about a game that is right there in the
 * library, and they would conclude the library is broken.
 */

const STARTS: WorldStart[] = [
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

let h: Harness;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
});

const world = (slug: string) => makeWorld(h, slug, STARTS);

const select = (id: string, body: unknown) =>
  h.app.inject({ method: "POST", url: `/api/worlds/${id}/start`, payload: body as never });

describe("choosing a start", () => {
  it("a world with starts arrives with none selected", async () => {
    // The selector waits: the opening is the player's first decision and this must
    // not be spent for them.
    const payload = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world("start-waiting").id}` })
    ).json<{
      world: { starts: { list: { id: string }[]; selectedId: string | null } };
    }>();

    expect(payload.world.starts.list.map((s) => s.id)).toEqual([
      "new-vegas",
      "fallout-76",
      "fallout-1",
    ]);
    expect(payload.world.starts.selectedId).toBeNull();
  });

  it("choosing one records it and answers with the world", async () => {
    const target = world("start-scelto");
    const response = await select(target.id, { startId: "fallout-76" });

    expect(response.statusCode).toBe(200);
    const payload = response.json<{ world: { starts: { selectedId: string | null } } }>();
    // The world and not just an ok: the caller re-reads the transcript right after,
    // and it must show the narration this choice produced.
    expect(payload.world.starts.selectedId).toBe("fallout-76");
  });

  it("taking the choice back is allowed", async () => {
    const target = world("start-annullato");
    await select(target.id, { startId: "new-vegas" });

    const response = await select(target.id, { startId: null });
    expect(response.statusCode).toBe(200);
    expect(
      response.json<{ world: { starts: { selectedId: string | null } } }>().world.starts.selectedId,
    ).toBeNull();
  });

  it("a lore-only start is refused with its own code", async () => {
    const target = world("start-solo-lore");
    const response = await select(target.id, { startId: "fallout-1" });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("start.loreOnly");
    // And the refusal changed nothing: a half-chosen campaign would be worse than
    // one still waiting.
    expect(h.worlds.get(target.id)?.starts.selectedId).toBeNull();
  });

  it("a start the world doesn't have is refused with a different code", async () => {
    const target = world("start-inesistente");
    const response = await select(target.id, { startId: "cyberpunk-2077" });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("start.notFound");
  });

  it("a world that doesn't exist answers 404, not 400", async () => {
    // The two are different questions: "no such campaign" is not a bad body, and
    // answering 400 would send the interface looking for a mistake in the payload.
    const response = await select("w-does-not-exist", { startId: "new-vegas" });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("world.notFound");
  });

  it("a body without a startId is a bad body", async () => {
    // `null` is the way to unselect, not the way to leave it alone, so an absent
    // field is a mistake: treating it as "no change" would make the route
    // untestable for that case and hide it from the schema.
    const response = await select(world("start-body").id, {});
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("body.invalid");
  });

  it("a world with no starts can be asked to select one, and gets a refusal", async () => {
    const plain = makeWorld(h, "start-nessuno");
    const response = await select(plain.id, { startId: "new-vegas" });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("start.notFound");
  });
});
