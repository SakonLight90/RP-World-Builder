import type { CanonEntry } from "@rpwb/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanonRepository } from "../src/db/repo/canon.js";
import type { Harness } from "./helpers/http.js";
import { harness, makeWorld } from "./helpers/http.js";

/**
 * Routes correcting canon by hand.
 *
 * Before these routes canon reading existed and writing didn't: the
 * repository already had `get`, `remove` and audit methods, but no route
 * called them. The case justifying these tests is one and holds for all: an
 * unrecorded correction. The narrator keeps using the entry, the player swore
 * they changed it, and in a month nobody will know which of the two versions
 * is the real one. So every test here also checks the change stays in
 * `canon_edits`, not just that the entry changed.
 */

let h: Harness;

/** A minimal canon entry, so the route can correct it. */
function makeEntry(subject: string, extra: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id: "",
    worldId: "",
    subject,
    kind: "event",
    aliases: [],
    summary: "Sintesi iniziale.",
    facts: ["FATTO-1"],
    era: "any",
    status: "active",
    priority: 5,
    tokens: 40,
    ...extra,
  };
}

const patchEntry = (id: string, entryId: string, payload: unknown) =>
  h.app.inject({
    method: "PATCH",
    url: `/api/worlds/${id}/canon/${entryId}`,
    payload: payload as object,
  });

const removeEntry = (id: string, entryId: string, payload: unknown = {}) =>
  h.app.inject({
    method: "DELETE",
    url: `/api/worlds/${id}/canon/${entryId}`,
    payload: payload as object,
  });

const readEdits = (id: string) =>
  h.app.inject({ method: "GET", url: `/api/worlds/${id}/canon/edits` });

/**
 * Inserts an entry with the repository and returns the real id.
 *
 * Uses the repository and not a handwritten `INSERT`: table name
 * (`canon_entries`) and column shape are schema details, and a test
 * repeating them becomes a second schema to keep aligned.
 */
function insertEntry(worldId: string, entry: CanonEntry): string {
  // The writer generates the id: `upsertMany` doesn't invent it, and passing an
  // empty string makes the second entry collide with the first.
  const id = entry.id === "" ? crypto.randomUUID() : entry.id;
  new CanonRepository(h.db).upsertMany([{ ...entry, id, worldId }]);
  return (
    new CanonRepository(h.db).listAll(worldId).find((e) => e.subject === entry.subject)?.id ?? id
  );
}

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
});

describe("correcting a canon entry", () => {
  it("changes the sent field and leaves the rest as they were", async () => {
    const world = makeWorld(h, "canone-modifica");
    const id = insertEntry(world.id, makeEntry("Morganthown"));

    const response = await patchEntry(world.id, id, { summary: "Sintesi corretta." });

    expect(response.statusCode).toBe(200);
    const entry = response.json().entry as CanonEntry;
    expect(entry.summary).toBe("Sintesi corretta.");
    // The rest must not move: a partial correction zeroing the others
    // deletes information the narrator was using.
    expect(entry.facts).toEqual(["FATTO-1"]);
    expect(entry.priority).toBe(5);
    expect(entry.status).toBe("active");
  });

  it("records the before and after values", async () => {
    // That's the point of these tests. A changed entry without history leaves
    // player and narrator disagreeing about which version is right, with
    // nothing flagging it.
    const world = makeWorld(h, "canon-story");
    const id = insertEntry(world.id, makeEntry("Morganthown", { summary: "Versione sbagliata." }));

    await patchEntry(world.id, id, { summary: "Versione giusta.", status: "disputed" });

    const edits = readEdits(world.id).then(
      (r) =>
        r.json().edits as {
          subject: string;
          fields: string;
          beforeValue: string;
          afterValue: string;
        }[],
    );
    const rows = await edits;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe("Morganthown");
    expect(rows[0]?.fields).toBe("status, summary");
    expect(rows[0]?.beforeValue).toContain("Versione sbagliata.");
    expect(rows[0]?.afterValue).toContain("Versione giusta.");
  });

  it("two corrections on the same entry leave two history rows", async () => {
    const world = makeWorld(h, "canone-due-volte");
    const id = insertEntry(world.id, makeEntry("Morganthown"));

    const first = await patchEntry(world.id, id, { summary: "Before." });
    const second = await patchEntry(world.id, id, { summary: "Seconda." });
    // If the second save fails, without this check the test
    // would count one history row and give the false impression the
    // correction had been recorded twice.
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const rows = (await readEdits(world.id)).json().edits as { afterValue: string }[];
    expect(rows).toHaveLength(2);
    // The before value of the second correction must be the first's result:
    // that's what makes the chain rebuildable.
    expect(rows.some((r) => r.afterValue.includes("Before."))).toBe(true);
  });

  it("saves the correction reason", async () => {
    const world = makeWorld(h, "canone-motivo");
    const id = insertEntry(world.id, makeEntry("Morganthown"));

    await patchEntry(world.id, id, { summary: "X", reason: "The corpus says otherwise." });

    const rows = (await readEdits(world.id)).json().edits as { reason: string }[];
    expect(rows[0]?.reason).toBe("The corpus says otherwise.");
  });

  it("a missing field doesn't zero the others", async () => {
    // That's why the schema has no defaults: if `facts` had an empty-list
    // default, saving an entry's syntax would delete its facts.
    // Using `disputed` and not `non_canon` because a `non_canon` entry is excluded
    // from reading by construction: it would vanish from the list and the test
    // would pass without checking anything.
    const world = makeWorld(h, "canone-assenti");
    const id = insertEntry(world.id, makeEntry("Morganthown"));

    await patchEntry(world.id, id, { status: "disputed" });

    const entry = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/canon` })
    ).json().entries as CanonEntry[];
    const found = entry.find((e) => e.subject === "Morganthown");
    expect(found?.facts).toEqual(["FATTO-1"]);
    expect(found?.summary).toBe("Sintesi iniziale.");
  });

  it("renaming an entry corrects it instead of creating a second one", async () => {
    // Defect found writing this test. Canon upsert conflicts on
    // (world, subject, era): correcting the subject found no conflict and
    // tried inserting a new row with the same id, which the database
    // refused. In practice the subject couldn't be corrected, and it's the
    // field a user corrects first.
    const world = makeWorld(h, "canone-rinomina");
    const id = insertEntry(world.id, makeEntry("West Tek"));

    const response = await patchEntry(world.id, id, { subject: "West Tek Research Center" });

    expect(response.statusCode).toBe(200);
    const entry = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/canon` })
    ).json().entries as CanonEntry[];
    expect(entry.filter((e) => e.subject === "West Tek")).toHaveLength(0);
    const renamed = entry.filter((e) => e.subject === "West Tek Research Center");
    expect(renamed).toHaveLength(1);
    // Same entry: name changes, not identity.
    expect(renamed[0]?.id).toBe(id);
  });

  it("rejects a value the schema won't accept, writing nothing", async () => {
    const world = makeWorld(h, "canone-invalido");
    const id = insertEntry(world.id, makeEntry("Morganthown"));

    const response = await patchEntry(world.id, id, { status: "inventato" });

    expect(response.statusCode).toBe(400);
    const entry = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/canon` })
    ).json().entries as CanonEntry[];
    expect(entry.find((e) => e.subject === "Morganthown")?.status).toBe("active");
  });

  it("a missing entry answers 404 and records no correction", async () => {
    const world = makeWorld(h, "canone-mancante");

    const response = await patchEntry(world.id, "non-esiste", { summary: "X" });

    expect(response.statusCode).toBe(404);
    expect((await readEdits(world.id)).json().edits).toEqual([]);
  });
});

describe("removing a canon entry", () => {
  it("removes it from the world and records it as removed", async () => {
    const world = makeWorld(h, "canone-rimozione");
    const id = insertEntry(world.id, makeEntry("Sentries", { kind: "faction" }));

    const response = await removeEntry(world.id, id, { reason: "It does not exist in 2287." });

    expect(response.statusCode).toBe(200);
    expect(response.json().removed).toBe(true);
    const remaining = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${world.id}/canon` })
    ).json().entries as CanonEntry[];
    expect(remaining.find((e) => e.subject === "Sentries")).toBeUndefined();

    const rows = (await readEdits(world.id)).json().edits as {
      afterValue: string;
      reason: string;
    }[];
    expect(rows).toHaveLength(1);
    // The entry vanishes but history stays: if the same entry is remade
    // tomorrow, it must be clear it was removed on purpose, not lost.
    expect(rows[0]?.afterValue).toBe("null");
    expect(rows[0]?.reason).toBe("It does not exist in 2287.");
  });

  it("doesn't touch other worlds' entries", async () => {
    const other = makeWorld(h, "canon-other-world");
    const id = insertEntry(other.id, makeEntry("Sentries", { kind: "faction" }));

    await removeEntry(other.id, id);

    const good = makeWorld(h, "canon-good-world");
    insertEntry(good.id, makeEntry("Sentries", { kind: "faction" }));
    const entries = (
      await h.app.inject({ method: "GET", url: `/api/worlds/${good.id}/canon` })
    ).json().entries as CanonEntry[];
    expect(entries.find((e) => e.subject === "Sentries")).toBeDefined();
  });
});

describe("correction history", () => {
  it("is per world", async () => {
    const a = makeWorld(h, "story-a");
    const b = makeWorld(h, "story-b");
    const idA = insertEntry(a.id, makeEntry("Morganthown"));
    insertEntry(b.id, makeEntry("Morganthown"));

    await patchEntry(a.id, idA, { summary: "Only in world A." });

    // Same perimeter as characters and relationships: a wrong campaign's
    // correction must not show in the other's panel.
    expect((await readEdits(a.id)).json().edits).toHaveLength(1);
    expect((await readEdits(b.id)).json().edits).toEqual([]);
  });
});
