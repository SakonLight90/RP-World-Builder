import { type Arc, type ArcStatus, isArcOver, MAX_CHAPTERS_PER_ARC } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { newId, nowIso, parseStringArray, stringify, toInt, toStr } from "./common.js";

interface ArcRow {
  id: string;
  world_id: string;
  n: number;
  title: string;
  logline: string;
  spine: string;
  status: string;
  first_chapter: number;
  last_chapter: number;
  canon_refs: string;
  tokens: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `
  id, world_id, n, title, logline, spine, status,
  first_chapter, last_chapter, canon_refs, tokens, created_at, updated_at
`;

function toArc(row: ArcRow): Arc {
  return {
    id: row.id,
    worldId: row.world_id,
    n: row.n,
    title: row.title,
    logline: row.logline,
    spine: row.spine,
    status: row.status as ArcStatus,
    firstChapter: row.first_chapter,
    lastChapter: row.last_chapter,
    canonRefs: parseStringArray(row.canon_refs),
    tokens: row.tokens,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArcRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  create(worldId: string, input: { title: string; logline?: string; firstChapter: number }): Arc {
    const now = nowIso();
    const id = newId();
    const n = this.nextNumber(worldId);

    this.#db
      .prepare(
        `INSERT INTO arcs (${COLUMNS}) VALUES (
           @id, @worldId, @n, @title, @logline, '', 'open',
           @firstChapter, @firstChapter, '[]', 0, @now, @now
         )`,
      )
      .run({
        id,
        worldId,
        n,
        title: input.title,
        logline: input.logline ?? "",
        firstChapter: input.firstChapter,
        now,
      });

    const arc = this.get(id);
    if (!arc) throw new Error("arc not found after creation");
    return arc;
  }

  get(id: string): Arc | null {
    const row = this.#db
      .prepare<[string], ArcRow>(`SELECT ${COLUMNS} FROM arcs WHERE id = ?`)
      .get(id);
    return row ? toArc(row) : null;
  }

  list(worldId: string): Arc[] {
    return this.#db
      .prepare<[string], ArcRow>(`SELECT ${COLUMNS} FROM arcs WHERE world_id = ? ORDER BY n ASC`)
      .all(worldId)
      .map(toArc);
  }

  /** The arc we are currently writing in. If there is none, the campaign has not started yet. */
  current(worldId: string): Arc | null {
    const row = this.#db
      .prepare<[string], ArcRow>(
        `SELECT ${COLUMNS} FROM arcs WHERE world_id = ? AND status = 'open' ORDER BY n DESC LIMIT 1`,
      )
      .get(worldId);
    return row ? toArc(row) : null;
  }

  nextNumber(worldId: string): number {
    const row = this.#db
      .prepare<[string], { n: number | null }>("SELECT MAX(n) AS n FROM arcs WHERE world_id = ?")
      .get(worldId);
    return toInt(row?.n) + 1;
  }

  /** The chapter just written belongs to this arc. */
  attachChapter(arcId: string, chapterNumber: number): void {
    this.#db
      .prepare("UPDATE arcs SET last_chapter = ?, updated_at = ? WHERE id = ? AND last_chapter < ?")
      .run(chapterNumber, nowIso(), arcId, chapterNumber);
  }

  /**
   * Closes the arc with the spine. This is the moment when the memory of its
   * chapters is compressed: from here on the arc goes into the carryover, not its
   * chapters.
   */
  close(arcId: string, input: { title?: string; spine: string; canonRefs?: string[] }): Arc | null {
    const arc = this.get(arcId);
    if (!arc) return null;

    const spine = input.spine.trim();
    const refs = input.canonRefs ?? arc.canonRefs;
    const title = input.title?.trim() || arc.title;
    const tokens = Math.ceil((title.length + spine.length) / 4);

    this.#db
      .prepare(
        `UPDATE arcs SET title = @title, spine = @spine, status = 'closed',
           canon_refs = @canonRefs, tokens = @tokens, updated_at = @now
         WHERE id = @id`,
      )
      .run({
        id: arcId,
        title,
        spine,
        canonRefs: stringify(refs),
        tokens,
        now: nowIso(),
      });

    return this.get(arcId);
  }

  /** Applies the spine to an already closed arc, if the model gave it afterwards. */
  setSpine(arcId: string, spine: string): Arc | null {
    const arc = this.get(arcId);
    if (!arc) return null;
    return this.close(arcId, { spine });
  }

  chaptersIn(arcId: string): { n: number; title: string; summary: string }[] {
    return this.#db
      .prepare<[string], { n: number; title: string; summary: string }>(
        "SELECT n, title, summary FROM chapters WHERE arc_id = ? ORDER BY n ASC",
      )
      .all(arcId)
      .map((row) => ({ n: row.n, title: toStr(row.title), summary: toStr(row.summary) }));
  }

  /**
   * Has the arc run out of the chapters it can hold? Then it has to be closed, or
   * anyway the next arc cannot extend beyond the ceiling.
   */
  needsClosing(arcId: string): boolean {
    const arc = this.get(arcId);
    return arc !== null && isArcOver(arc);
  }

  /** How many chapters are left before the arc has to close. */
  remainingCapacity(arcId: string): number {
    const arc = this.get(arcId);
    if (!arc) return MAX_CHAPTERS_PER_ARC;
    return Math.max(0, MAX_CHAPTERS_PER_ARC - (arc.lastChapter - arc.firstChapter + 1));
  }

  /**
   * Removes an arc.
   *
   * The chapters do not follow the arc on delete: they are written history, and
   * deleting them together with a container would be the quietest way to lose
   * content. They stay in the world without an arc until somebody reassigns them
   * or removes them by hand, one by one.
   */
  remove(worldId: string, id: string): boolean {
    const arc = this.get(id);
    if (!arc || arc.worldId !== worldId) return false;
    return (
      this.#db
        .prepare<[string, string]>("DELETE FROM arcs WHERE world_id = ? AND id = ?")
        .run(worldId, id).changes > 0
    );
  }

  /**
   * Realigns an arc's range to the chapters it actually has.
   *
   * It is needed when a chapter is removed by hand: `firstChapter` and
   * `lastChapter` would stay at the value from when the arc was written, and the
   * card would say "chapters 3–10" with 5 missing. A range that no longer
   * corresponds to anything is a number that lies.
   */
  refreshRange(arcId: string): void {
    const chapters = this.chaptersIn(arcId);
    const now = nowIso();
    if (chapters.length === 0) {
      this.#db
        .prepare("UPDATE arcs SET first_chapter = 0, last_chapter = 0, updated_at = ? WHERE id = ?")
        .run(now, arcId);
      return;
    }
    const numeri = chapters.map((chapter) => chapter.n);
    this.#db
      .prepare("UPDATE arcs SET first_chapter = ?, last_chapter = ?, updated_at = ? WHERE id = ?")
      .run(Math.min(...numeri), Math.max(...numeri), now, arcId);
  }
}
