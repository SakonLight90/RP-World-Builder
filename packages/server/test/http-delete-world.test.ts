import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./helpers/http.js";
import { harness, harnessWorldDir, makeCharacter, makeWorld } from "./helpers/http.js";

/**
 * Deleting a world through the API.
 *
 * The folder-removing function is already tested alone; here the route is
 * tested, the part never exercised that can fail in two ways unit tests don't
 * see: it can say "deleted" without deleting the row, and can delete the row
 * **and** a folder that wasn't that world's.
 *
 * The second is why `removeWorldDir` exists: `opencodeDir` comes from the
 * database, and a world with a historic directory pointing elsewhere would
 * delete that. Here the shared library stands guard: if it disappears, the
 * test is broken not the route.
 */

let h: Harness;

const removeEntry = (id: string) => h.app.inject({ method: "DELETE", url: `/api/worlds/${id}` });

/** A world's folder, with the agent and its session inside. */
async function cartellaDi(h: Harness, slug: string): Promise<string> {
  const dir = harnessWorldDir(h, slug);
  await mkdir(join(dir, ".opencode", "agents"), { recursive: true });
  await writeFile(join(dir, ".opencode", "agents", "gm.md"), "---\ndescription: gm\n", "utf8");
  return dir;
}

/** A world with its folder on disk. */
async function worldOnDisk(nameOf: string) {
  const world = makeWorld(h, nameOf);
  await cartellaDi(h, world.slug);
  return world;
}

beforeEach(async () => {
  h = await harness({ withBridge: true });
});

afterEach(async () => {
  await h.close();
});

describe("deleting a world", () => {
  it("takes row and folder, and tells what it did", async () => {
    const world = await worldOnDisk("delete-completo");

    const response = await removeEntry(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, directoryRemoved: true });

    expect(h.worlds.get(world.id)).toBeNull();
    expect(existsSync(harnessWorldDir(h, world.slug))).toBe(false);
  });

  it("stops that world's server before touching disk", async () => {
    // On Windows a process holding open files in the folder keeps them, and
    // deletion fails with a permissions-looking error that's an open file.
    // Order is everything: stop, then delete.
    const world = await worldOnDisk("delete-ordine");

    await removeEntry(world.id);
    expect(h.fake.stopped).toEqual([harnessWorldDir(h, world.slug)]);
  });

  it("also takes what the world had inside", async () => {
    // `delete` cascade is on the database: without it, the world would reappear
    // with characters already inside and no trace of who they were.
    const world = await worldOnDisk("delete-cascata");
    makeCharacter(h, world.id, "Vera");
    makeCharacter(h, world.id, "Michael");

    await removeEntry(world.id);
    expect(h.cast.listCharacters(world.id)).toEqual([]);
  });

  it("doesn't touch another world's folder", async () => {
    const first = await worldOnDisk("delete-primo");
    const second = await worldOnDisk("delete-secondo");

    await removeEntry(first.id);
    expect(existsSync(harnessWorldDir(h, second.slug))).toBe(true);
    expect(h.worlds.get(second.id)).not.toBeNull();
  });

  it("a folder outside the worlds folder isn't deleted", async () => {
    // `opencodeDir` comes from the database and this route does a recursive
    // deletion: if the path points elsewhere, deleting that is unasked damage.
    // The world row vanishes anyway, and the response says the folder stayed:
    // two distinct facts, not one.
    const outside = join(h.data, "lore", "fallout");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "library.yaml"), "id: fallout\n", "utf8");

    const world = makeWorld(h, "delete-fuori-radice");
    h.worlds.update(world.id, { opencodeDir: outside });

    const response = await removeEntry(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, directoryRemoved: false });

    expect(h.worlds.get(world.id)).toBeNull();
    expect(existsSync(join(outside, "library.yaml"))).toBe(true);
  });

  it("a folder that's already gone isn't an error", async () => {
    // The world server may have already removed everything, or the world never
    // wrote anything. "It wasn't there" is an outcome the API must accept
    // without failing.
    const world = makeWorld(h, "delete-senza-cartella");

    const response = await removeEntry(world.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, directoryRemoved: true });
  });

  it("works even without opencode, and doesn't stop halfway", async () => {
    // The opencode server may not be installed, and a world must still be
    // deletable: a missing narrator isn't a reason to keep a world the user
    // decided to throw away.
    const withoutBridge = await harness();
    try {
      const world = makeWorld(withoutBridge, "delete-senza-ponte");
      await cartellaDi(withoutBridge, world.slug);

      const response = await withoutBridge.app.inject({
        method: "DELETE",
        url: `/api/worlds/${world.id}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, directoryRemoved: true });
      expect(withoutBridge.worlds.get(world.id)).toBeNull();
    } finally {
      await withoutBridge.close();
    }
  });
});

describe("when the world isn't there", () => {
  it("answers 404 and stops no server", async () => {
    const response = await removeEntry("world-does-not-exist");
    expect(response.statusCode).toBe(404);
    expect(response.json().problem).toBe("World not found");
    // Stopping a missing world's server would stop someone else's.
    expect(h.fake.stopped).toEqual([]);
  });

  it("deleting the same world twice deletes nothing else", async () => {
    const world = await worldOnDisk("delete-due-volte");
    await removeEntry(world.id);

    const second = await removeEntry(world.id);
    expect(second.statusCode).toBe(404);
  });
});
