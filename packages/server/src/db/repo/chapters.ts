import type { Chapter } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { newId, nowIso, parseStringArray, stringify, toInt, toStr } from "./common.js";

interface ChapterRow {
  id: string;
  world_id: string;
  n: number;
  locale: string;
  title: string;
  summary: string;
  path: string;
  token_start: number;
  token_end: number;
  canon_refs: string;
  arc_id: string | null;
  created_at: string;
}

function toChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    worldId: row.world_id,
    n: row.n,
    locale: row.locale,
    title: row.title,
    summary: toStr(row.summary),
    path: row.path,
    tokenStart: toInt(row.token_start),
    tokenEnd: toInt(row.token_end),
    canonRefs: parseStringArray(row.canon_refs),
    arcId: row.arc_id,
    createdAt: row.created_at,
  };
}

export interface ChapterInput {
  worldId: string;
  locale: string;
  title: string;
  summary: string;
  path: string;
  tokenStart: number;
  tokenEnd: number;
  canonRefs: string[];
  arcId: string | null;
}

export class ChapterRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** Chapter numbers grow and are unique per world. */
  nextNumber(worldId: string): number {
    const row = this.#db
      .prepare<[string], { n: number | null }>(
        "SELECT MAX(n) AS n FROM chapters WHERE world_id = ?",
      )
      .get(worldId);
    return toInt(row?.n) + 1;
  }

  add(input: ChapterInput): Chapter {
    const n = this.nextNumber(input.worldId);
    const row: Chapter = { ...input, n, id: newId(), createdAt: nowIso() };

    this.#db
      .prepare(
        `INSERT INTO chapters (
           id, world_id, n, locale, title, summary, path,
           token_start, token_end, canon_refs, arc_id, created_at
         ) VALUES (
           @id, @worldId, @n, @locale, @title, @summary, @path,
           @tokenStart, @tokenEnd, @canonRefs, @arcId, @createdAt
         )`,
      )
      .run({
        id: row.id,
        worldId: row.worldId,
        n: row.n,
        locale: row.locale,
        title: row.title,
        summary: row.summary,
        path: row.path,
        tokenStart: row.tokenStart,
        tokenEnd: row.tokenEnd,
        canonRefs: stringify(row.canonRefs),
        arcId: row.arcId,
        createdAt: row.createdAt,
      });

    return row;
  }

  list(worldId: string): Chapter[] {
    return this.#db
      .prepare<[string], ChapterRow>("SELECT * FROM chapters WHERE world_id = ? ORDER BY n ASC")
      .all(worldId)
      .map(toChapter);
  }

  latest(worldId: string): Chapter | null {
    const row = this.#db
      .prepare<[string], ChapterRow>(
        "SELECT * FROM chapters WHERE world_id = ? ORDER BY n DESC LIMIT 1",
      )
      .get(worldId);
    return row ? toChapter(row) : null;
  }

  get(worldId: string, n: number): Chapter | null {
    const row = this.#db
      .prepare<[string, number], ChapterRow>("SELECT * FROM chapters WHERE world_id = ? AND n = ?")
      .get(worldId, n);
    return row ? toChapter(row) : null;
  }

  remove(worldId: string, n: number): boolean {
    return (
      this.#db
        .prepare<[string, number]>("DELETE FROM chapters WHERE world_id = ? AND n = ?")
        .run(worldId, n).changes > 0
    );
  }
}
