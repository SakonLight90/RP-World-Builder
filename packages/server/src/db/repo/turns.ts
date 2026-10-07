import type { TokenUsage } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { newId, nowIso, toStrOrNull } from "./common.js";

/**
 * How to read a turn.
 *
 * `running`, `completed` and `failed` are what the database accepts and the only
 * things the backend writes. `stale` is not a column: it is a `running` older than
 * `RUNNING_STALE_MS`, computed on read because it comes from elapsed time and a
 * backend stopped halfway never passes anywhere to mark it.
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
  /**
   * What the turn consumed, or `null` while it runs and when the provider reported
   * nothing.
   *
   * A whole `TokenUsage`, so the cache split is never lost: a provider that reads back
   * its cache spends far less than `input` alone suggests. `null` is a real state and
   * not an empty usage, because a turn that reported nothing and a turn that cost
   * nothing must not look the same on a bill.
   */
  usage: TokenUsage | null;
  /** What the turn cost in the provider's currency, or `null` if not priced. */
  cost: number | null;
}

/**
 * How long a live turn may last.
 *
 * Past five minutes nothing is still writing it. A `running` older than this is not
 * shown as "is writing": an indicator that never turns off and produces nothing is
 * what looked like a hang.
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
  /** Null when the provider reported nothing. All six are null together. */
  input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  turn_cost: number | null;
}

/**
 * The usage of a row, or nothing.
 *
 * Null when the first number is missing and not a zeroed usage: the provider reports
 * usage as one block or not at all, and reading a partial report as zero puts a real
 * input cost next to a made-up output.
 */
function toUsage(row: TurnRow): TokenUsage | null {
  if (row.input_tokens === null || row.output_tokens === null) return null;
  return {
    input: row.input_tokens,
    output: row.output_tokens,
    // The cache figures are optional even when the main pair is there: a model with
    // no cache is not a model with a zero cache bill.
    reasoning: row.reasoning_tokens ?? 0,
    cache: { read: row.cache_read_tokens ?? 0, write: row.cache_write_tokens ?? 0 },
  };
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
    usage: toUsage(row),
    cost: row.turn_cost,
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
   * Born before narrating starts, so the UI can say "is writing" and the tab can be
   * reopened without losing the work.
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
      // A running turn has no usage yet: the provider has not reported it, and a
      // zero here would be a figure about a turn that has not happened.
      usage: null,
      cost: null,
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

  /**
   * Closes the turn with the narrator answer.
   *
   * The usage is written here and not at the start because it does not exist until the
   * turn has finished: a number written earlier would be a guess about a call that
   * has not happened. Optional, and a turn closed without it is one whose provider
   * reported nothing.
   */
  complete(id: string, text: string, usage?: TokenUsage | null, cost?: number | null): Turn | null {
    return this.#close(id, "completed", { text: text, error: null, usage, cost });
  }

  /**
   * Closes the turn with the reason it did not finish.
   *
   * The text of a failed turn is not saved: what the narrator had started writing is
   * half-done, and showing it as the answer would say the opposite of what happened.
   *
   * The usage is passed here too: a turn that failed after the model ran is the
   * expensive one, and a total over completed turns only would report it as free.
   */
  fail(id: string, problem: string, usage?: TokenUsage | null, cost?: number | null): Turn | null {
    return this.#close(id, "failed", { text: null, error: problem, usage, cost });
  }

  #close(
    id: string,
    state: "completed" | "failed",
    values: {
      text: string | null;
      error: string | null;
      usage?: TokenUsage | null;
      cost?: number | null;
    },
  ): Turn | null {
    const finishedAt = nowIso();
    const usage = values.usage ?? null;
    const changed = this.#db
      .prepare(
        `UPDATE turns SET state = @state, text = @text, error = @error, finished_at = @finishedAt,
            input_tokens = @input, output_tokens = @output, reasoning_tokens = @reasoning,
            cache_read_tokens = @cacheRead, cache_write_tokens = @cacheWrite, turn_cost = @cost
         WHERE id = @id`,
      )
      .run({
        id,
        state,
        text: values.text,
        error: values.error,
        finishedAt,
        // A null usage writes six nulls, not six zeroes. See `toUsage`: the
        // difference between "the provider said nothing" and "it cost nothing" is
        // the difference between a total that is honest and one that looks complete.
        input: usage?.input ?? null,
        output: usage?.output ?? null,
        reasoning: usage?.reasoning ?? null,
        cacheRead: usage?.cache.read ?? null,
        cacheWrite: usage?.cache.write ?? null,
        cost: values.cost ?? null,
      }).changes;
    // Zero touched rows means the turn is gone, not that the answer was lost: returning
    // `null` avoids writing `finished_at` a second time on a closed turn.
    return changed > 0 ? this.getById(id) : null;
  }

  /**
   * What a campaign has cost.
   *
   * Two numbers because they are not equal: `tokens` is everything the model saw and
   * wrote, `cost` is what the provider charged. They diverge on every turn that read
   * the cache, so one number alone makes a large context look expensive or a paid
   * model look cheap.
   *
   * `cost` sums only the priced turns, and `costCovered` says how many that is: the
   * interface shows it beside the total so a partial sum is not read as the whole.
   */
  spendSummary(worldId: string): {
    turns: number;
    reported: number;
    tokens: TokenUsage;
    cost: number | null;
    costCovered: number;
  } {
    const row = this.#db
      .prepare<
        [string],
        {
          turns: number;
          reported: number;
          input: number | null;
          output: number | null;
          reasoning: number | null;
          cache_read: number | null;
          cache_write: number | null;
          cost: number | null;
          priced: number;
        }
      >(
        `SELECT COUNT(*) AS turns,
                SUM(CASE WHEN input_tokens IS NOT NULL THEN 1 ELSE 0 END) AS reported,
                SUM(input_tokens) AS input, SUM(output_tokens) AS output,
                SUM(reasoning_tokens) AS reasoning,
                SUM(cache_read_tokens) AS cache_read,
                SUM(cache_write_tokens) AS cache_write,
                SUM(turn_cost) AS cost,
                SUM(CASE WHEN turn_cost IS NOT NULL THEN 1 ELSE 0 END) AS priced
         FROM turns
         WHERE world_id = ? AND state != 'running'`,
      )
      .get(worldId);

    return {
      turns: row?.turns ?? 0,
      reported: row?.reported ?? 0,
      tokens: {
        input: row?.input ?? 0,
        output: row?.output ?? 0,
        reasoning: row?.reasoning ?? 0,
        cache: { read: row?.cache_read ?? 0, write: row?.cache_write ?? 0 },
      },
      cost: row?.cost ?? null,
      costCovered: row?.priced ?? 0,
    };
  }

  /**
   * Removes a turn from the work history.
   *
   * Only the row, not the conversation: the session is the story and this table is the
   * work log. That is why the route aborts a running turn first: removing the row
   * while the narrator writes leaves a job with nowhere to land.
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

  /** The turn the narrator is carrying forward. `stale` does not count. */
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
