import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArcRepository } from "../src/db/repo/arcs.js";
import { ChapterRepository } from "../src/db/repo/chapters.js";
import { TurnRepository } from "../src/db/repo/turns.js";
import type { Harness } from "./helpers/http.js";
import { harness, makeCharacter, makeLocation, makeWorld } from "./helpers/http.js";

/**
 * Routes managing what already exists: places, relationships, arcs, chapters
 * and turns.
 *
 * Creating existed almost everywhere, but fixing and removing didn't: a wrong
 * place stayed wrong forever, a mistakenly born arc stayed open, and a failed
 * turn could only be hidden from screen. Here every UI-shown thing is proven
 * fixable or really removable, and removing takes nothing it shouldn't.
 */

let h: Harness;

const patchEntry = (url: string, payload: unknown) =>
  h.app.inject({ method: "PATCH", url, payload: payload as object });

const post = (url: string, payload: unknown) =>
  h.app.inject({ method: "POST", url, payload: payload as object });

const removeEntry = (url: string, payload?: unknown) =>
  h.app.inject({
    method: "DELETE",
    url,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
});

describe("places are fixed and removed", () => {
  it("renames without touching the rest", async () => {
    const world = makeWorld(h, "luoghi-rinomina");
    const place = makeLocation(h, world.id, "Freeside");

    const response = await patchEntry(`/api/worlds/${world.id}/locations/${place.id}`, {
      name: "Freeside Sud",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().location).toMatchObject({ name: "Freeside Sud", era: "any" });
  });

  it("moves a place under another in the same world", async () => {
    const world = makeWorld(h, "luoghi-sposta");
    const parent = makeLocation(h, world.id, "Mojave Wasteland");
    const child = makeLocation(h, world.id, "Freeside");

    const response = await patchEntry(`/api/worlds/${world.id}/locations/${child.id}`, {
      parentId: parent.id,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().location.parentId).toBe(parent.id);
  });

  it("rejects another world's parent, itself and descendants", async () => {
    // Three ways to break geography: a place inside itself makes no sense, one
    // inside a child loops forever, and one from another campaign lands in the
    // wrong place with nothing flagging it.
    const world = makeWorld(h, "luoghi-padre");
    const other = makeWorld(h, "luoghi-padre-altro");
    const parentElsewhere = makeLocation(h, other.id, "Mojave Wasteland");
    const parent = makeLocation(h, world.id, "Padre");
    const child = makeLocation(h, world.id, "Figlio", parent.id);

    expect(
      (
        await patchEntry(`/api/worlds/${world.id}/locations/${child.id}`, {
          parentId: parentElsewhere.id,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await patchEntry(`/api/worlds/${world.id}/locations/${child.id}`, { parentId: child.id }))
        .statusCode,
    ).toBe(400);
    expect(
      (await patchEntry(`/api/worlds/${world.id}/locations/${parent.id}`, { parentId: child.id }))
        .statusCode,
    ).toBe(400);
    // Nothing really moved.
    expect(h.cast.getLocation(world.id, child.id)?.parentId).toBe(parent.id);
  });

  it("removes the place but leaves people", async () => {
    // Deleting geography doesn't delete people: characters stay, placeless.
    // The opposite — vanished characters because a city was removed — would be
    // a loss no message could explain.
    const world = makeWorld(h, "luoghi-rimozione");
    const place = makeLocation(h, world.id, "Freeside");
    const vera = makeCharacter(h, world.id, "Vera", { locationId: place.id });

    const response = await removeEntry(`/api/worlds/${world.id}/locations/${place.id}`);

    expect(response.statusCode).toBe(200);
    expect(h.cast.getLocation(world.id, place.id)).toBeNull();
    expect(h.cast.getCharacter(world.id, vera)?.locationId).toBeNull();
  });

  it("a missing place answers 404", async () => {
    const world = makeWorld(h, "luoghi-mancanti");
    expect(
      (await patchEntry(`/api/worlds/${world.id}/locations/non-esiste`, { name: "X" })).statusCode,
    ).toBe(404);
    expect((await removeEntry(`/api/worlds/${world.id}/locations/non-esiste`)).statusCode).toBe(
      404,
    );
  });
});

describe("relationships are removed", () => {
  it("removes a relationship and leaves characters", async () => {
    const world = makeWorld(h, "relazioni-rimozione");
    const vera = makeCharacter(h, world.id, "Vera");
    const michael = makeCharacter(h, world.id, "Michael");
    h.cast.setRelationship(world.id, {
      worldId: world.id,
      fromCharacterId: vera,
      toCharacterId: michael,
      affinity: 10,
      trust: 10,
      note: "",
    });

    const response = await removeEntry(`/api/worlds/${world.id}/relationships`, {
      fromCharacterId: vera,
      toCharacterId: michael,
    });

    expect(response.statusCode).toBe(200);
    expect(h.cast.listRelationships(world.id)).toEqual([]);
    // People stay: the bond is removed, not the folk.
    expect(h.cast.getCharacter(world.id, vera)?.name).toBe("Vera");
  });

  it("removing the same relationship twice answers 404", async () => {
    const world = makeWorld(h, "relazioni-due-volte");
    const vera = makeCharacter(h, world.id, "Vera");
    const michael = makeCharacter(h, world.id, "Michael");

    const payload = { fromCharacterId: vera, toCharacterId: michael };
    await post(`/api/worlds/${world.id}/relationships`, payload);
    expect((await removeEntry(`/api/worlds/${world.id}/relationships`, payload)).statusCode).toBe(
      200,
    );
    expect((await removeEntry(`/api/worlds/${world.id}/relationships`, payload)).statusCode).toBe(
      404,
    );
  });
});

describe("arcs open, close and remove", () => {
  it("creates an arc from the title", async () => {
    const world = makeWorld(h, "archi-creazione");

    const response = await post(`/api/worlds/${world.id}/arcs`, {
      title: "La bacheca",
      logline: "Vera sistema gli annunci.",
      firstChapter: 1,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().arc).toMatchObject({ title: "La bacheca", status: "open", n: 1 });
  });

  it("closes an arc only with the backbone", async () => {
    // Without a spine it doesn't close: a closed arc without summary leaves a
    // memory hole, and compressed chapters vanish traceless.
    const world = makeWorld(h, "archi-chiusura");
    const arco = (
      await post(`/api/worlds/${world.id}/arcs`, { title: "La bacheca", firstChapter: 1 })
    ).json().arc as { id: string };

    expect(
      (await post(`/api/worlds/${world.id}/arcs/${arco.id}/close`, { spine: "" })).statusCode,
    ).toBe(400);

    const response = await post(`/api/worlds/${world.id}/arcs/${arco.id}/close`, {
      spine: "Vera sorted the notices and Morganthown breathes.",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().arc).toMatchObject({ status: "closed" });

    // Twice doesn't close: the second has nothing to compress.
    expect(
      (
        await post(`/api/worlds/${world.id}/arcs/${arco.id}/close`, {
          spine: "Another version.",
        })
      ).statusCode,
    ).toBe(409);
  });

  it("removes an empty arc touching nothing else", async () => {
    const world = makeWorld(h, "archi-rimozione");
    const arco = (
      await post(`/api/worlds/${world.id}/arcs`, { title: "Wrong", firstChapter: 1 })
    ).json().arc as { id: string };

    expect((await removeEntry(`/api/worlds/${world.id}/arcs/${arco.id}`)).statusCode).toBe(200);
    expect(new ArcRepository(h.db).list(world.id)).toEqual([]);
  });

  it("an arc with chapters isn't removed by mistake", async () => {
    // Deleting it would silently detach chapters: explicit confirmation is
    // needed, and chapters stay in the world anyway.
    const world = makeWorld(h, "archi-capitoli");
    const arco = (
      await post(`/api/worlds/${world.id}/arcs`, { title: "La bacheca", firstChapter: 1 })
    ).json().arc as { id: string };
    new ChapterRepository(h.db).add({
      worldId: world.id,
      locale: "it",
      title: "Primo",
      summary: "Si comincia.",
      path: "capitolo-001.md",
      tokenStart: 0,
      tokenEnd: 10,
      canonRefs: [],
      arcId: arco.id,
    });

    const response = await removeEntry(`/api/worlds/${world.id}/arcs/${arco.id}`);
    expect(response.statusCode).toBe(409);

    const forced = await h.app.inject({
      method: "DELETE",
      url: `/api/worlds/${world.id}/arcs/${arco.id}?force=true`,
    });
    expect(forced.statusCode).toBe(200);
    // Arc goes, chapter stays: a container is removed, not the story.
    expect(new ArcRepository(h.db).list(world.id)).toEqual([]);
    expect(new ChapterRepository(h.db).list(world.id)).toHaveLength(1);
  });
});

describe("chapters are read and removed", () => {
  it("reads text from the world file", async () => {
    const world = makeWorld(h, "capitoli-lettura");
    await mkdir(world.opencodeDir, { recursive: true });
    await writeFile(join(world.opencodeDir, "capitolo-001.md"), "# Primo\n\nSi comincia.", "utf8");
    new ChapterRepository(h.db).add({
      worldId: world.id,
      locale: "it",
      title: "Primo",
      summary: "Si comincia.",
      path: "capitolo-001.md",
      tokenStart: 0,
      tokenEnd: 10,
      canonRefs: [],
      arcId: null,
    });

    const response = await h.app.inject({
      method: "GET",
      url: `/api/worlds/${world.id}/chapters/1`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().chapter.title).toBe("Primo");
    expect(response.json().text).toContain("Si comincia.");
  });

  it("removes row and file together, and realigns the arc", async () => {
    // One without the other is a ghost chapter: either listed or on disk. And
    // the arc range must tell chapters it really has, not what it had before
    // one was hand-removed.
    const world = makeWorld(h, "capitoli-rimozione");
    await mkdir(world.opencodeDir, { recursive: true });
    const arco = (
      await post(`/api/worlds/${world.id}/arcs`, { title: "La bacheca", firstChapter: 1 })
    ).json().arc as { id: string };
    const chapters = new ChapterRepository(h.db);
    for (const n of [1, 2]) {
      await writeFile(join(world.opencodeDir, `capitolo-00${n}.md`), `# ${n}`, "utf8");
      chapters.add({
        worldId: world.id,
        locale: "it",
        title: `Capitolo ${n}`,
        summary: "",
        path: `capitolo-00${n}.md`,
        tokenStart: 0,
        tokenEnd: 10,
        canonRefs: [],
        arcId: arco.id,
      });
    }
    const archi = new ArcRepository(h.db);
    archi.attachChapter(arco.id, 1);
    archi.attachChapter(arco.id, 2);

    const response = await removeEntry(`/api/worlds/${world.id}/chapters/1`);
    expect(response.statusCode).toBe(200);
    expect(chapters.list(world.id).map((c) => c.n)).toEqual([2]);
    expect(archi.get(arco.id)).toMatchObject({ firstChapter: 2, lastChapter: 2 });
  });

  it("a missing chapter answers 404", async () => {
    const world = makeWorld(h, "capitoli-mancanti");
    expect(
      (await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/chapters/9` })).statusCode,
    ).toBe(404);
    expect((await removeEntry(`/api/worlds/${world.id}/chapters/9`)).statusCode).toBe(404);
  });
});

describe("turns are really removed", () => {
  it("removes a failed turn and it doesn't come back on refresh", async () => {
    // That was the "throw away" button's point: hiding from screen without
    // removing the row brought the turn back on first refresh, looking like
    // the button didn't work.
    const world = makeWorld(h, "turni-rimozione");
    const turns = new TurnRepository(h.db);
    const turn = turns.start(world.id, "Vera sorts the jobs board.", "it");
    turns.fail(turn.id, "The narrator did not answer.");

    const response = await removeEntry(`/api/worlds/${world.id}/turns/${turn.id}`);

    expect(response.statusCode).toBe(200);
    expect(turns.get(world.id, turn.id)).toBeNull();
    expect(turns.list(world.id)).toEqual([]);
  });

  it("a missing turn answers 404", async () => {
    const world = makeWorld(h, "turni-mancanti");
    expect((await removeEntry(`/api/worlds/${world.id}/turns/non-esiste`)).statusCode).toBe(404);
  });
});
