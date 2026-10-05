import {
  CANON_ANY_ERA,
  type CanonAuditEntry,
  type CanonEdit,
  type CanonEntry,
  type CanonKind,
  type CanonStatus,
  type CanonVerdict,
  isEraActive,
  isInjectable,
} from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import {
  buildFtsQueryFromTerms,
  extractTerms,
  newId,
  nowIso,
  parseStringArray,
  stringify,
  toInt,
  toStr,
} from "./common.js";

/**
 * Threshold past which a term stops telling entries apart.
 * Both values are tuned for a human-sized corpus: a few
 * thousand entries.
 */
const COMMON_TERM_RATIO = 0.25;
const COMMON_TERM_MIN_DOCUMENTS = 6;

interface CanonRow {
  id: string;
  world_id: string;
  subject: string;
  kind: string;
  aliases: string;
  summary: string;
  facts: string;
  era: string;
  status: string;
  priority: number;
  tokens: number;
}

const COLUMNS = `
  id, world_id, subject, kind, aliases, summary, facts, era, status, priority, tokens
`;

function toEntry(row: CanonRow): CanonEntry {
  return {
    id: row.id,
    worldId: row.world_id,
    subject: row.subject,
    kind: row.kind as CanonKind,
    aliases: parseStringArray(row.aliases),
    summary: row.summary,
    facts: parseStringArray(row.facts),
    era: row.era,
    status: row.status as CanonStatus,
    priority: row.priority,
    tokens: row.tokens,
  };
}

export interface CanonQuery {
  worldId: string;
  /** Active eras of the world: an entry counts only when its own is among them. */
  activeEras: string[];
  /** In strict, `disputed` material stays out. */
  includeDisputed: boolean;
  kinds?: CanonKind[];
  limit?: number;
}

export interface SearchOptions extends CanonQuery {
  /** Raw player text: tokenized, not interpreted. */
  text: string;
  maxTokens?: number;
}

export class CanonRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  upsertMany(entries: CanonEntry[]): number {
    const statement = this.#db.prepare(
      `INSERT INTO canon_entries (${COLUMNS})
       VALUES (
         @id, @worldId, @subject, @kind, @aliases, @summary, @facts, @era, @status,
         @priority, @tokens
       )
       ON CONFLICT (world_id, subject, era) DO UPDATE SET
         kind = excluded.kind,
         aliases = excluded.aliases,
         summary = excluded.summary,
         facts = excluded.facts,
         status = excluded.status,
         priority = excluded.priority,
         tokens = excluded.tokens`,
    );

    const run = this.#db.transaction((items: CanonEntry[]) => {
      for (const entry of items) {
        statement.run({
          id: entry.id,
          worldId: entry.worldId,
          subject: entry.subject,
          kind: entry.kind,
          aliases: stringify(entry.aliases),
          summary: entry.summary,
          facts: stringify(entry.facts),
          era: entry.era,
          status: entry.status,
          priority: entry.priority,
          tokens: entry.tokens,
        });
      }
      return items.length;
    });

    return run(entries);
  }

  /**
   * Fixes an existing entry by id.
   *
   * It takes `update` and not `upsertMany` because upsert conflicts on
   * (world, subject, era), that is on what identifies an entry **by
   * content**. Fixing the subject then found no conflict and
   * tried to insert a new row with the same id, which the database
   * refused: in practice the field the user fixes first was not
   * fixable. The id is the identity of the entry, and it is what gets written.
   *
   * Returns `false` when the entry does not exist, so the route tells "missing"
   * apart from "updated", which are different answers.
   */
  update(worldId: string, id: string, entry: CanonEntry): boolean {
    const outcome = this.#db
      .prepare(
        `UPDATE canon_entries SET
           subject = @subject,
           kind = @kind,
           aliases = @aliases,
           summary = @summary,
           facts = @facts,
           era = @era,
           status = @status,
           priority = @priority,
           tokens = @tokens
         WHERE id = @id AND world_id = @worldId`,
      )
      .run({
        id,
        worldId,
        subject: entry.subject,
        kind: entry.kind,
        aliases: stringify(entry.aliases),
        summary: entry.summary,
        facts: stringify(entry.facts),
        era: entry.era,
        status: entry.status,
        priority: entry.priority,
        tokens: entry.tokens,
      });
    return outcome.changes > 0;
  }

  list(query: CanonQuery): CanonEntry[] {
    const limit = query.limit ?? 500;
    const rows = this.#db
      .prepare<[string], CanonRow>(
        `SELECT ${COLUMNS} FROM canon_entries WHERE world_id = ? ORDER BY priority DESC, subject ASC`,
      )
      .all(query.worldId);

    return rows
      .map(toEntry)
      .filter((entry) => isEraActive(entry, query.activeEras))
      .filter((entry) => isInjectable(entry, query.includeDisputed))
      .filter((entry) => (query.kinds === undefined ? true : query.kinds.includes(entry.kind)))
      .slice(0, limit);
  }

  /**
   * Every entry of a world, with no era or status filters.
   *
   * `list` filters by active era, and that is right for the narrator context: it
   * needs what counts now. But **copying** a world needs more: asking for
   * "the active entries" copies half the canon unnoticed, because
   * the copy still looks full. And an entry marked `non_canon` or `disputed` stays an
   * entry: it is information, not junk.
   */
  listAll(worldId: string): CanonEntry[] {
    return this.#db
      .prepare<[string], CanonRow>(
        `SELECT ${COLUMNS} FROM canon_entries WHERE world_id = ? ORDER BY priority DESC, subject ASC`,
      )
      .all(worldId)
      .map(toEntry);
  }

  get(worldId: string, id: string): CanonEntry | null {
    const row = this.#db
      .prepare<[string, string], CanonRow>(
        `SELECT ${COLUMNS} FROM canon_entries WHERE world_id = ? AND id = ?`,
      )
      .get(worldId, id);
    return row ? toEntry(row) : null;
  }

  /**
   * Full-text search on raw text. `bm25` is negative and the more negative,
   * the more relevant the result: so sort ascending.
   */
  search(options: SearchOptions): CanonEntry[] {
    const match = this.#buildQuery(options.text, options.maxTokens);
    if (match === null) return [];

    const limit = options.limit ?? 12;
    const rows = this.#db
      .prepare<[string, string, number], CanonRow & { score: number }>(
        `SELECT e.id, e.world_id, e.subject, e.kind, e.aliases, e.summary, e.facts, e.era,
                e.status, e.priority, e.tokens,
                bm25(canon_fts) AS score
         FROM canon_fts
         JOIN canon_entries e ON e.rowid = canon_fts.rowid
         WHERE canon_fts MATCH ? AND e.world_id = ?
         ORDER BY score ASC
         LIMIT ?`,
      )
      .all(match, options.worldId, limit);

    return rows
      .map(toEntry)
      .filter((entry) => isEraActive(entry, options.activeEras))
      .filter((entry) => isInjectable(entry, options.includeDisputed));
  }

  /**
   * A stopword list is not enough: words like "uso" or "casa" are legitimate
   * content in one entry and junk in another, and a hand-written list
   * cannot tell the two cases apart.
   *
   * So before searching, drop terms showing up in too many entries:
   * they tell nothing apart and only pile up noise. Each count is an
   * indexed lookup on a small index, so the cost is negligible
   * next to a model call.
   */
  #buildQuery(text: string, maxTokens = 24): string | null {
    const terms = extractTerms(text, maxTokens);
    if (terms.length === 0) return null;

    const total = this.#db
      .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM canon_entries")
      .get();
    const corpusSize = toInt(total?.total);

    // On a small corpus the threshold must not drop everything: the limit is a
    // fraction of the total, with an absolute floor below which any
    // term goes through.
    const threshold = Math.max(
      COMMON_TERM_MIN_DOCUMENTS,
      Math.floor(corpusSize * COMMON_TERM_RATIO),
    );

    const count = this.#db.prepare<[string], { n: number }>(
      "SELECT COUNT(*) AS n FROM canon_fts WHERE canon_fts MATCH ?",
    );

    const distinctive: string[] = [];
    for (const term of terms) {
      if (toInt(count.get(`"${term}"`)?.n) <= threshold) distinctive.push(term);
    }

    // When the filter empties everything, a noisy query beats nothing: the
    // narrator ranking does not depend on search, but a turn with
    // no hold on canon would be worse than a few extra results.
    return buildFtsQueryFromTerms(distinctive.length > 0 ? distinctive : terms);
  }

  /** Entries explicitly named by the player: the most reliable channel. */
  findMentioned(worldId: string, text: string): CanonEntry[] {
    const rows = this.#db
      .prepare<[string], CanonRow>(`SELECT ${COLUMNS} FROM canon_entries WHERE world_id = ?`)
      .all(worldId);

    const haystack = text.toLowerCase();
    return rows.map(toEntry).filter((entry) => {
      const names = [entry.subject, ...entry.aliases];
      return names.some((name) => name !== "" && haystack.includes(name.toLowerCase()));
    });
  }

  remove(worldId: string, id: string): boolean {
    return (
      this.#db
        .prepare<[string, string]>("DELETE FROM canon_entries WHERE world_id = ? AND id = ?")
        .run(worldId, id).changes > 0
    );
  }

  countFor(worldId: string): number {
    const row = this.#db
      .prepare<[string], { total: number }>(
        "SELECT COUNT(*) AS total FROM canon_entries WHERE world_id = ?",
      )
      .get(worldId);
    return toInt(row?.total);
  }

  /**
   * Canon health: how many entries sit in an uncertain state. The detail that
   * tells how much of the canon is safe to narrate without asking questions.
   */
  health(worldId: string): {
    total: number;
    disputed: number;
    retconned: number;
  } {
    const row = this.#db
      .prepare<[string], { total: number; disputed: number; retconned: number }>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'disputed' THEN 1 ELSE 0 END) AS disputed,
           SUM(CASE WHEN status = 'retconned' THEN 1 ELSE 0 END) AS retconned
         FROM canon_entries WHERE world_id = ?`,
      )
      .get(worldId);

    return {
      total: toInt(row?.total),
      disputed: toInt(row?.disputed),
      retconned: toInt(row?.retconned),
    };
  }

  addAudit(entry: Omit<CanonAuditEntry, "id" | "createdAt">): CanonAuditEntry {
    const row: CanonAuditEntry = {
      ...entry,
      id: newId(),
      createdAt: nowIso(),
    };
    this.#db
      .prepare(
        `INSERT INTO canon_audit (id, world_id, chapter_id, claim, verdict, canon_ref, suggestion, created_at)
         VALUES (@id, @worldId, @chapterId, @claim, @verdict, @canonRef, @suggestion, @createdAt)`,
      )
      .run({ ...row, verdict: row.verdict as CanonVerdict });
    return row;
  }

  listAudit(worldId: string, limit = 50): CanonAuditEntry[] {
    return this.#db
      .prepare<
        [string, number],
        {
          id: string;
          world_id: string;
          chapter_id: string | null;
          claim: string;
          verdict: string;
          canon_ref: string;
          suggestion: string;
          created_at: string;
        }
      >(`SELECT * FROM canon_audit WHERE world_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(worldId, limit)
      .map((row) => ({
        id: row.id,
        worldId: row.world_id,
        chapterId: row.chapter_id,
        claim: toStr(row.claim),
        verdict: row.verdict as CanonVerdict,
        canonRef: toStr(row.canon_ref),
        suggestion: toStr(row.suggestion),
        createdAt: row.created_at,
      }));
  }

  // --- hand fixes -------------------------------------------------

  addEdit(edit: Omit<CanonEdit, "id" | "createdAt">): CanonEdit {
    const row: CanonEdit = { ...edit, id: newId(), createdAt: nowIso() };
    this.#db
      .prepare(
        `INSERT INTO canon_edits
           (id, world_id, entry_id, subject, fields, before_value, after_value, reason, created_at)
         VALUES (@id, @worldId, @entryId, @subject, @fields, @beforeValue, @afterValue, @reason, @createdAt)`,
      )
      .run(row);
    return row;
  }

  listEdits(worldId: string, limit = 50): CanonEdit[] {
    return this.#db
      .prepare<
        [string, number],
        {
          id: string;
          world_id: string;
          entry_id: string;
          subject: string;
          fields: string;
          before_value: string;
          after_value: string;
          reason: string;
          created_at: string;
        }
      >(`SELECT * FROM canon_edits WHERE world_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(worldId, limit)
      .map((row) => ({
        id: row.id,
        worldId: row.world_id,
        entryId: row.entry_id,
        subject: toStr(row.subject),
        fields: toStr(row.fields),
        beforeValue: toStr(row.before_value),
        afterValue: toStr(row.after_value),
        reason: toStr(row.reason),
        createdAt: row.created_at,
      }));
  }
}

export { CANON_ANY_ERA };
