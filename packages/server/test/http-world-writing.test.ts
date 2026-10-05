import { BIBLE_SECTIONS } from "@rpwb/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./helpers/http.js";
import { harness, makeCharacter, makeLocation, makeWorld } from "./helpers/http.js";

/**
 * Routes writing the world: Bible, eras, places and relationships.
 *
 * Four routes with the same shape and risk: half-baked validation. If the
 * schema accepts and the database writes, the world ends up with a nonexistent
 * Bible section or an unlabeled era, and the narrator agent gets senseless
 * context. So here the body is proven validated **before** writing, a missing
 * world isn't written, and what was written comes back.
 *
 * Reading happens from the reading route, not the repository: the point is the
 * value written by a route is what the UI reopens.
 */

let h: Harness;

const put = (id: string, route: string, payload: unknown) =>
  h.app.inject({ method: "PUT", url: `/api/worlds/${id}/${route}`, payload: payload as object });

const post = (id: string, route: string, payload: unknown) =>
  h.app.inject({ method: "POST", url: `/api/worlds/${id}/${route}`, payload: payload as object });

const readWorld = (id: string) => h.app.inject({ method: "GET", url: `/api/worlds/${id}` });

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
});

describe("the world Bible", () => {
  it("writes the section and it's rereadable", async () => {
    const world = makeWorld(h, "bible-scrittura");

    const response = await put(world.id, "bible", {
      section: "premise",
      body: "Appalachia, 2287: the world is post-nuclear.",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().bible.premise).toBe("Appalachia, 2287: the world is post-nuclear.");

    // Reread from the reading route, not the repository: what the user sees
    // reopening the world is what was written.
    const reread = (await readWorld(world.id)).json<{ bible: { premise: string } }>();
    expect(reread.bible.premise).toBe("Appalachia, 2287: the world is post-nuclear.");
  });

  it("tells which sections exist, because the client must write the name", async () => {
    // The engine can't know the world's vocabulary: if the answer didn't carry
    // the list, UI would have to guess it.
    const world = makeWorld(h, "bible-sezioni");

    const response = await put(world.id, "bible", { section: "tone", body: "Secco." });
    expect(response.json().sections).toEqual([...BIBLE_SECTIONS]);
  });

  it("writes one section without touching the others", async () => {
    const world = makeWorld(h, "bible-isolata");
    await put(world.id, "bible", { section: "rules", body: "No gratuitous violence." });

    await put(world.id, "bible", { section: "tone", body: "Secco e asciutto." });

    const bible = (await readWorld(world.id)).json<{ bible: Record<string, string> }>().bible;
    expect(bible.rules).toBe("No gratuitous violence.");
    expect(bible.tone).toBe("Secco e asciutto.");
    expect(bible.premise).toBe("");
  });

  it("rejects a nonexistent section, writing nothing", async () => {
    // An invented section would land in the Bible and nobody would ever read
    // it: initial context that "must never be lost" could silently be lost.
    const world = makeWorld(h, "bible-sezione-falsa");

    const response = await put(world.id, "bible", { section: "appendice", body: "testo" });
    expect(response.statusCode).toBe(400);
    expect(h.worlds.getBible(world.id).premise).toBe("");
  });

  it("rejects a body without section and a body without text", async () => {
    const world = makeWorld(h, "bible-corpo-incompleto");

    expect((await put(world.id, "bible", { body: "testo" })).statusCode).toBe(400);
    expect((await put(world.id, "bible", { section: "premise" })).statusCode).toBe(400);
    expect((await put(world.id, "bible", { section: "premise", body: 42 })).statusCode).toBe(400);
  });

  it("a missing world isn't written", async () => {
    const response = await put("world-does-not-exist", "bible", {
      section: "premise",
      body: "testo",
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("the world eras", () => {
  const ERAS = [
    { key: "pre-war", label: "Before the war", startYear: 2052, endYear: 2056, summary: "" },
    { key: "post-war", label: "After the war", startYear: 2057, summary: "The world begins." },
  ];

  it("writes eras and they're rereadable", async () => {
    const world = makeWorld(h, "eras-scrittura");

    const response = await put(world.id, "eras", ERAS);
    expect(response.statusCode).toBe(200);
    expect(response.json().eras).toEqual([
      { key: "pre-war", label: "Before the war", startYear: 2052, endYear: 2056, summary: "" },
      { key: "post-war", label: "After the war", startYear: 2057, summary: "The world begins." },
    ]);

    const reread = (await readWorld(world.id)).json<{ eras: { key: string }[] }>().eras;
    expect(reread.map((e) => e.key)).toEqual(["pre-war", "post-war"]);
  });

  it("rejects a body that isn't a list", async () => {
    // `replaceEras` takes a list: an object here would iterate as if a list
    // and no era would be written, with nothing saying so.
    const world = makeWorld(h, "eras-not-a-list");

    const response = await put(world.id, "eras", { key: "pre-war" });
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toBe("Expected a list");
    expect((await readWorld(world.id)).json().eras).toEqual([]);
  });

  it("rejects an era without label, because the narrator can't describe it", async () => {
    const world = makeWorld(h, "eras-senza-etichetta");

    const response = await put(world.id, "eras", [{ key: "post-war" }]);
    expect(response.statusCode).toBe(400);
    expect((await readWorld(world.id)).json().eras).toEqual([]);
  });

  it("rejects a year that isn't a year", async () => {
    const world = makeWorld(h, "eras-anno-rotto");

    const response = await put(world.id, "eras", [
      { key: "pre-war", label: "Before", startYear: "2052" },
    ]);
    expect(response.statusCode).toBe(400);
  });

  it("a missing world answers 404 and writes nothing", async () => {
    // Defect found writing this file then fixed in `routes.ts` with a single
    // `preHandler`: none of these routes checked the world existed, so writes
    // hit the foreign key and the answer was a 500 leaking SQLite's internal
    // message. It concerned `eras`, `locations`, `relationships`, `arcs` and
    // `characters`: eleven routes in all.
    const response = await put("world-does-not-exist", "eras", ERAS);
    expect(response.statusCode).toBe(404);
  });

  it("an already present key is updated, not duplicated", async () => {
    // Constraint is on world+key: two rows with the same key would give the
    // narrator two eras with the same name and different years, picking at
    // random which is right.
    const world = makeWorld(h, "eras-aggiornamento");
    await put(world.id, "eras", ERAS);

    await put(world.id, "eras", [
      { key: "pre-war", label: "Before the war", startYear: 2052, summary: "Revised." },
    ]);

    const era = h.worlds.listEras(world.id).find((e) => e.key === "pre-war");
    expect(era?.summary).toBe("Revised.");
    expect(h.worlds.listEras(world.id).filter((e) => e.key === "pre-war")).toHaveLength(1);
  });

  // Defect found writing this file then fixed in `WorldRepository`:
  // `replaceEras` only did `INSERT ... ON CONFLICT DO UPDATE`, so removing an
  // era from the list didn't delete it. An era range the player deleted stayed
  // in the narrator context forever, invisible in the screen.
  it("an era missing from the sent list disappears", async () => {
    const world = makeWorld(h, "eras-rimozione");
    await put(world.id, "eras", ERAS);

    await put(world.id, "eras", [
      { key: "post-war", label: "Dopo la guerra", startYear: 2057, summary: "" },
    ]);

    expect(h.worlds.listEras(world.id).map((e) => e.key)).toEqual(["post-war"]);
  });
});

describe("the world places", () => {
  it("creates a place with schema-declared defaults", async () => {
    // Defaults are here because below nobody ever checks if a field exists: if
    // the schema stopped filling them, `era` and `aliases` would become
    // `undefined` and land in the database as `null`.
    const world = makeWorld(h, "luoghi-creazione");

    const response = await post(world.id, "locations", { name: "Vault 12" });
    expect(response.statusCode).toBe(200);
    expect(response.json().location).toMatchObject({
      name: "Vault 12",
      aliases: [],
      era: "any",
      parentId: null,
      description: "",
      worldId: world.id,
    });
  });

  it("lists them all, not just the world's", async () => {
    const world = makeWorld(h, "luoghi-elenco");
    const other = makeWorld(h, "places-other-world");
    makeLocation(h, world.id, "Zona pericolosa");
    makeLocation(h, world.id, "Appalachia");
    makeLocation(h, other.id, "Mojave");

    const response = await h.app.inject({
      method: "GET",
      url: `/api/worlds/${world.id}/locations`,
    });
    // By name order, so geography doesn't change from one read to the next.
    expect(response.json().locations.map((l: { name: string }) => l.name)).toEqual([
      "Appalachia",
      "Zona pericolosa",
    ]);
  });

  it("a place can live inside another place", async () => {
    const world = makeWorld(h, "luoghi-gerarchia");
    const parent = makeLocation(h, world.id, "Mojave Wasteland");

    const response = await post(world.id, "locations", {
      name: "Freeside",
      parentId: parent.id,
      aliases: ["Freeside"],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().location.parentId).toBe(parent.id);
    // The chain feeds the turn's geographic context, so parents must stay
    // readable.
    expect(h.cast.locationAncestry(world.id, response.json().location.id).length).toBe(2);
  });

  it("rejects a nameless place", async () => {
    // A nameless place can't be shown, searched or named: a row taking space
    // saying nothing.
    const world = makeWorld(h, "luoghi-senza-nome");

    expect((await post(world.id, "locations", { description: "un posto" })).statusCode).toBe(400);
    expect((await post(world.id, "locations", { name: "", aliases: [] })).statusCode).toBe(400);
    expect((await post(world.id, "locations", { name: "X", aliases: [42] })).statusCode).toBe(400);
    expect(h.cast.listLocations(world.id)).toEqual([]);
  });
});

describe("relationships between characters", () => {
  it("writes a relationship and it's rereadable", async () => {
    const world = makeWorld(h, "relazioni-scrittura");
    const vera = makeCharacter(h, world.id, "Vera");
    const michael = makeCharacter(h, world.id, "Michael");

    const response = await post(world.id, "relationships", {
      fromCharacterId: vera,
      toCharacterId: michael,
      affinity: 40,
      trust: 30,
      note: "they met at Morganthown",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().relationship).toMatchObject({
      worldId: world.id,
      fromCharacterId: vera,
      toCharacterId: michael,
      affinity: 40,
      trust: 30,
    });

    const listed = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/relationships` })
    ).json<{ relationships: { note: string }[] }>();
    expect(listed.relationships).toHaveLength(1);
    expect(listed.relationships[0]?.note).toBe("they met at Morganthown");
  });

  it("the same pair isn't duplicated, but updated", async () => {
    // Two rows only if the table lacks the key: the narrator would get two
    // reports between the same people with different numbers, picking at
    // random.
    const world = makeWorld(h, "relazioni-aggiornamento");
    const a = makeCharacter(h, world.id, "Vera");
    const b = makeCharacter(h, world.id, "Michael");

    await post(world.id, "relationships", { fromCharacterId: a, toCharacterId: b, affinity: 10 });
    await post(world.id, "relationships", { fromCharacterId: a, toCharacterId: b, affinity: -20 });

    const listed = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/relationships` })
    ).json<{ relationships: { affinity: number }[] }>();
    expect(listed.relationships).toHaveLength(1);
    expect(listed.relationships[0]?.affinity).toBe(-20);
  });

  it("default values are zero, and nothing is an allowed value", async () => {
    // Numberless affinity is zero, not "missing": if the field never arrived
    // and `undefined` landed in the database, relationship sums would give
    // `NaN`.
    const world = makeWorld(h, "relazioni-default");
    const a = makeCharacter(h, world.id, "Vera");
    const b = makeCharacter(h, world.id, "Michael");

    const response = await post(world.id, "relationships", {
      fromCharacterId: a,
      toCharacterId: b,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().relationship).toMatchObject({ affinity: 0, trust: 0, note: "" });
  });

  it("rejects a relationship not telling who relates whom", async () => {
    const world = makeWorld(h, "relazioni-incompleta");
    const a = makeCharacter(h, world.id, "Vera");

    expect((await post(world.id, "relationships", { fromCharacterId: a })).statusCode).toBe(400);
    expect((await post(world.id, "relationships", { affinity: 10 })).statusCode).toBe(400);
    expect(
      (
        await post(world.id, "relationships", {
          fromCharacterId: a,
          toCharacterId: a,
          affinity: 500,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("doesn't reshuffle already written relationships", async () => {
    const world = makeWorld(h, "relazioni-mio");
    const a = makeCharacter(h, world.id, "Vera");
    const b = makeCharacter(h, world.id, "Michael");
    await post(world.id, "relationships", { fromCharacterId: a, toCharacterId: b });

    const listed = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/relationships` })
    ).json<{ relationships: { fromCharacterId: string }[] }>();
    expect(listed.relationships.map((r) => r.fromCharacterId)).toEqual([a]);
  });

  // Defect found writing this file then fixed in `CastRepository`: the route
  // wrote `worldId` from the URL without checking both characters belonged to
  // that world. A client with a stale id after a fork would end up with a
  // relationship between another campaign's characters inside this cast, and
  // the relationship counted as "true" for the reading narrator.
  it("a relationship between another world's characters doesn't enter here", async () => {
    const world = makeWorld(h, "relazioni-inesistenti");
    const other = makeWorld(h, "relations-other-world");
    const c = makeCharacter(h, other.id, "Christine");
    const d = makeCharacter(h, other.id, "Vera");

    await post(world.id, "relationships", { fromCharacterId: c, toCharacterId: d });

    const listed = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/relationships` })
    ).json<{ relationships: unknown[] }>();
    expect(listed.relationships).toEqual([]);
  });
});
