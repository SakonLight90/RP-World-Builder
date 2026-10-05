/**
 * Migration 007: hand fixes to canon.
 *
 * Its own table, not a column on the entry, because an entry is fixed many
 * times and every fix must stay. With a "last edit" column you would
 * have the present picture and not the history, and in a long campaign the
 * question that really comes up is "when and why did this fact change".
 *
 * It does not reuse the check audit table: that one records the reviewer
 * **verdicts** on a chapter claim (`claim`, `verdict`, `canonRef`), and
 * a hand fix is not a verdict. Mixing them would make it impossible
 * to ask how many facts the model checked and how many a hand changed,
 * which are two numbers with very different weight.
 *
 * `valore_prima` and `valore_dopo` are raw JSON, not field by field: the shape
 * of the entry changes from one version to the next, and a fixed-column table
 * starts losing information at the first schema migration.
 */
export const CANON_EDITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS canon_edits (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  campo TEXT NOT NULL,
  valore_prima TEXT NOT NULL,
  valore_dopo TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canon_edits_world
  ON canon_edits (world_id, created_at DESC);
`;
