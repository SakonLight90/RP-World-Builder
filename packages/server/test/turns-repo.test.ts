import type { Database } from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openMemory } from "../src/db/connection.js";
import { TURNS_SCHEMA } from "../src/db/migrations/006_turns.js";
import { RUNNING_STALE_MS, TurnRepository } from "../src/db/repo/turns.js";
import { WorldRepository } from "../src/db/repo/worlds.js";

/**
 * A turn is a row, and the row is the truth.
 *
 * Before, a turn was a held-open HTTP request: closing the tab also closed the
 * narrator, and nothing remained telling whether it was working or stopped.
 * Here the row is proven to tell the three needed things, and a forgotten
 * `running` doesn't pass for a live turn.
 *
 * Schema is applied by hand only when missing, not with `openMemory` alone:
 * until the migration is registered in `db/migrate.ts` a new database has no
 * table, and tests must still run. When registration lands, the line below
 * does nothing and the table is the right one.
 */

let db: Database;
let worlds: WorldRepository;
let turns: TurnRepository;
let worldId: string;

beforeEach(() => {
  db = openMemory();
  const tabella = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='turns'",
    )
    .get();
  if (tabella === undefined) db.exec(TURNS_SCHEMA);
  worlds = new WorldRepository(db);
  turns = new TurnRepository(db);
  worldId = worlds.create({
    name: "Prova",
    slug: "prova",
    model: "opencode/space-bunny-free",
    smallModel: "opencode/space-bunny-free",
    opencodeDir: "/tmp/prova",
  }).id;
});

/** Ages a turn as much as wanted, as time would. */
function invecchia(id: string, ms: number): void {
  const when = new Date(Date.now() - ms).toISOString();
  db.prepare("UPDATE turns SET created_at = ? WHERE id = ?").run(when, id);
}

describe("a turn being born", () => {
  it("starts ongoing, with no text nor error", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    expect(turn.state).toBe("running");
    expect(turn.prompt).toBe("Apro la porta.");
    expect(turn.text).toBeNull();
    expect(turn.error).toBeNull();
    expect(turn.finishedAt).toBeNull();
    expect(turn.locale).toBe("it");
  });

  it("and is immediately the world's ongoing turn", () => {
    const turn = turns.start(worldId, "Guardo fuori.", "it");

    expect(turns.active(worldId)?.id).toBe(turn.id);
  });

  it("a world without turns has no ongoing turn", () => {
    expect(turns.active(worldId)).toBeNull();
    expect(turns.list(worldId)).toEqual([]);
  });

  it("can't open a turn in a missing world", () => {
    expect(() => turns.start("world-does-not-exist", "Chi sei?", "it")).toThrow();
  });
});

describe("a turn succeeding", () => {
  it("closes with text and end hour", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    const closed = turns.complete(turn.id, "La porta cede con un rumore secco.");

    expect(closed?.state).toBe("completed");
    expect(closed?.text).toBe("La porta cede con un rumore secco.");
    expect(closed?.error).toBeNull();
    expect(closed?.finishedAt).not.toBeNull();
  });

  it("and is no longer the ongoing turn", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    turns.complete(turn.id, "La porta cede.");

    expect(turns.active(worldId)).toBeNull();
  });

  it("closed text rereads from the row, not anyone's memory", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    turns.complete(turn.id, "La porta cede.");

    // Another instance, another connection: what the page sees reopening, and
    // it must give the same text.
    const reread = new TurnRepository(db).get(worldId, turn.id);
    expect(reread?.text).toBe("La porta cede.");
    expect(reread?.state).toBe("completed");
  });
});

describe("a turn failing", () => {
  it("closes with the reason, and without text", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    const closed = turns.fail(turn.id, "The narrator did not answer within the expected time");

    expect(closed?.state).toBe("failed");
    expect(closed?.error).toBe("The narrator did not answer within the expected time");
    // What the narrator started writing isn't an answer, and writing it here
    // would tell the opposite of what happened.
    expect(closed?.text).toBeNull();
    expect(closed?.finishedAt).not.toBeNull();
  });

  it("and is no longer the ongoing turn", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    turns.fail(turn.id, "Stream interrupted before the turn ended");

    expect(turns.active(worldId)).toBeNull();
  });

  it("closing a missing turn raises nothing", () => {
    // Means that turn already closed: retrying would write the same end hour
    // twice.
    expect(turns.complete("non-esiste", "Too late")).toBeNull();
  });
});

describe("the turn list", () => {
  it("goes newest to oldest", () => {
    const first = turns.start(worldId, "Primo.", "it");
    const second = turns.start(worldId, "Secondo.", "it");
    const third = turns.start(worldId, "Terzo.", "it");

    // Three rows can share the hour: order can't depend on it.
    const stessaOra = "2026-10-01T10:00:00.000Z";
    db.prepare("UPDATE turns SET created_at = ?").run(stessaOra);

    expect(turns.list(worldId).map((t) => t.id)).toEqual([third.id, second.id, first.id]);
  });

  it("a closed turn stays listed with its outcome", () => {
    const failed = turns.start(worldId, "Fallirà.", "it");
    turns.fail(failed.id, "Errore del provider");
    const succeeded = turns.start(worldId, "Riuscirà.", "it");
    turns.complete(succeeded.id, "La luce torna.");

    const listed = turns.list(worldId);
    expect(listed.map((t) => t.state)).toEqual(["completed", "failed"]);
    expect(listed[1]?.error).toBe("Errore del provider");
  });

  it("doesn't mix worlds", () => {
    const other = worlds.create({
      name: "Altro",
      slug: "altro",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: "/tmp/altro",
    });
    turns.start(worldId, "Qui.", "it");
    turns.start(other.id, "Là.", "it");

    expect(turns.list(worldId).map((t) => t.prompt)).toEqual(["Qui."]);
    expect(turns.list(other.id).map((t) => t.prompt)).toEqual(["Là."]);
  });

  it("a deleted world takes its turns away", () => {
    turns.start(worldId, "Qui.", "it");
    worlds.delete(worldId);

    expect(turns.list(worldId)).toEqual([]);
  });
});

describe("the halfway-left turn", () => {
  it("an old running isn't an ongoing turn", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    invecchia(turn.id, RUNNING_STALE_MS + 60_000);

    // The halfway-restarted backend case: nobody writing, and saying "writing"
    // here is the indicator that never turns off.
    expect(turns.get(worldId, turn.id)?.state).toBe("stale");
    expect(turns.active(worldId)).toBeNull();
  });

  it("but a just-born running is alive", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");

    expect(turns.get(worldId, turn.id)?.state).toBe("running");
    expect(turns.active(worldId)?.id).toBe(turn.id);
  });

  it("a stale carries no text and doesn't lie about being done", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    invecchia(turn.id, RUNNING_STALE_MS + 1);

    const stale = turns.get(worldId, turn.id);
    expect(stale?.text).toBeNull();
    // No invented end hour nobody wrote.
    expect(stale?.finishedAt).toBeNull();
  });

  it("a closed turn never ages", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    turns.complete(turn.id, "La porta cede.");
    invecchia(turn.id, 24 * 60 * 60 * 1000);

    expect(turns.get(worldId, turn.id)?.state).toBe("completed");
    expect(turns.get(worldId, turn.id)?.text).toBe("La porta cede.");
  });

  it("a failed turn never ages", () => {
    const turn = turns.start(worldId, "Apro la porta.", "it");
    turns.fail(turn.id, "Stream interrupted before the turn ended");
    invecchia(turn.id, 24 * 60 * 60 * 1000);

    expect(turns.get(worldId, turn.id)?.state).toBe("failed");
  });
});
