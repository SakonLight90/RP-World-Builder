import type { Database } from "better-sqlite3";
import { newId, nowIso, toStrOrNull } from "./common.js";

/**
 * How to read a turn.
 *
 * `running`, `completed` and `failed` are the three states the database accepts, and
 * they are the only three the backend writes. `stale` does not exist in the table: it is
 * a `running` older than `RUNNING_STALE_MS`, that is a turn nobody is
 * carrying forward. It is added here and not in a column because it comes from elapsed
 * time and not from a write, and a backend stopped halfway never passes anywhere
 * to mark it.
 */
export type TurnState = "running" | "completed" | "failed" | "stale";

export interface Turn {
  id: string;
  worldId: string;
  /** What the player wrote, or the narrator request. */
  prompt: string;
  /** The answer, if any. While the turn runs it is `null`. */
  text: string | null;
  /** Why it failed. While it has not failed it is `null`. */
  error: string | null;
  state: TurnState;
  createdAt: string;
  /** When it was closed. `null` while it runs, and also for a stale one. */
  finishedAt: string | null;
  locale: string;
}

/**
 * How long a live turn may last.
 *
 * The engine closes a turn after `180_000` ms, so past five minutes there is
 * nothing still writing it: the process that wrote it is gone,
 * or was never there. A `running` past this age is not shown as "is
 * writing" because that is what looked like a hang: an indicator that never
 * turns off and produces nothing.
 */
export const RUNNING_STALE_MS = 5 * 60_000;

interface TurnRow {
  id: string;
  world_id: string;
  prompt: string;
  text: string | null;
  error: string | null;
  /** The `CHECK` in the schema guarantees these three are the only values. */
  state: "running" | "completed" | "failed";
  created_at: string;
  finished_at: string | null;
  locale: string;
}

function toTurn(row: TurnRow, nowMs: number): Turn {
  return {
    id: row.id,
    worldId: row.world_id,
    prompt: row.prompt,
    text: toStrOrNull(row.text),
    error: toStrOrNull(row.error),
    state: stateOf(row, nowMs),
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    locale: row.locale,
  };
}

function stateOf(row: TurnRow, nowMs: number): TurnState {
  if (row.state !== "running") return row.state;
  // An unreadable date counts as old: it cannot be shown that the turn is
  // still alive, and saying "is writing" forever is exactly what this
  // table is here to avoid.
  const alive = nowMs - Date.parse(row.created_at) < RUNNING_STALE_MS;
  return alive ? "running" : "stale";
}

export class TurnRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Opens a turn.
   *
   * The row is born before starting to narrate, not after: that is what lets
   * the UI say "is writing" and reopen the tab without losing
   * the work. A turn born when the text is already ready is useless,
   * because by then the answer is already there.
   */
  start(worldId: string, prompt: string, locale: string): Turn {
    const row: Turn = {
      id: newId(),
      worldId,
      prompt,
      text: null,
      error: null,
      state: "running",
      createdAt: nowIso(),
      finishedAt: null,
      locale,
    };

    this.#db
      .prepare(
        `INSERT INTO turns (id, world_id, prompt, state, created_at, locale)
         VALUES (@id, @worldId, @prompt, 'running', @createdAt, @locale)`,
      )
      .run({
        id: row.id,
        worldId: row.worldId,
        prompt: row.prompt,
        createdAt: row.createdAt,
        locale: row.locale,
      });

    return row;
  }

  /** Closes the turn with the narrator answer. */
  complete(id: string, text: string): Turn | null {
    return this.#close(id, "completed", { text: text, error: null });
  }

  /**
   * Closes the turn with the reason it did not finish.
   *
   * The text of a failed turn is not saved: what the narrator had
   * started writing is half-done and not a text, and showing it as if it were the
   * answer would tell the opposite of what happened.
   */
  fail(id: string, problem: string): Turn | null {
    return this.#close(id, "failed", { text: null, error: problem });
  }

  #close(
    id: string,
    state: "completed" | "failed",
    values: { text: string | null; error: string | null },
  ): Turn | null {
    const finishedAt = nowIso();
    const changed = this.#db
      .prepare(
        `UPDATE turns SET state = @state, text = @text, error = @error, finished_at = @finishedAt
         WHERE id = @id`,
      )
      .run({ id, state, text: values.text, error: values.error, finishedAt: finishedAt }).changes;
    // Zero touched rows means the turn is gone, not that the answer
    // was lost: it is still useful to know, and returning `null` is the way
    // to avoid writing `finished_at` a second time on an already closed turn.
    return changed > 0 ? this.getById(id) : null;
  }

  /**
   * Removes a turn from the work history.
   *
   * It deletes only the row, not the conversation: what the narrator already
   * wrote in the opencode session stays there, because the session is the story and
   * this table is the work log. That is why the route aborts first
   * a still-running turn: removing the row while the narrator writes
   * would leave a job with nowhere to land.
   */
  remove(worldId: string, id: string): boolean {
    return (
      this.#db
        .prepare<[string, string]>("DELETE FROM turns WHERE world_id = ? AND id = ?")
        .run(worldId, id).changes > 0
    );
  }

  /** A single turn, and only if it belongs to that world. */
  get(worldId: string, id: string): Turn | null {
    const row = this.#db
      .prepare<[string, string], TurnRow>("SELECT * FROM turns WHERE world_id = ? AND id = ?")
      .get(worldId, id);
    return row === undefined ? null : toTurn(row, Date.now());
  }

  getById(id: string): Turn | null {
    const row = this.#db.prepare<[string], TurnRow>("SELECT * FROM turns WHERE id = ?").get(id);
    return row === undefined ? null : toTurn(row, Date.now());
  }

  /** The turns of the world, newest first. */
  list(worldId: string, limit = 30): Turn[] {
    return this.#db
      .prepare<[string, number], TurnRow>(
        `SELECT * FROM turns WHERE world_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(worldId, limit)
      .map((row) => toTurn(row, Date.now()));
  }

  /**
   * The turn the narrator is carrying forward right now, if any.
   *
   * `stale` is not a running turn: without this distinction the UI
   * would say "is writing" for a turn nobody is writing, which is the
   * hang it no longer wants to see.
   */
  active(worldId: string): Turn | null {
    const row = this.#db
      .prepare<[string], TurnRow>(
        "SELECT * FROM turns WHERE world_id = ? AND state = 'running' ORDER BY created_at DESC LIMIT 1",
      )
      .get(worldId);
    if (row === undefined) return null;
    const turn = toTurn(row, Date.now());
    return turn.state === "running" ? turn : null;
  }
}
