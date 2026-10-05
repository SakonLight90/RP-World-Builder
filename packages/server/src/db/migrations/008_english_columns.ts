/**
 * Migration 008: English column names.
 *
 * Migrations 006 and 007 were written with Italian column names (`stato`,
 * `testo`, `errore`, `creato_il`, `finito_il` on `turns`; `campo`,
 * `valore_prima`, `valore_dopo`, `motivo` on `canon_edits`). The code now
 * speaks English, so the database does too. History is not rewritten: those
 * two files keep their original SQL, and this migration moves a live database
 * forward.
 *
 * Both tables are rebuilt instead of renamed with `ALTER TABLE ... RENAME
 * COLUMN`. The rename would have been shorter, but `turns` carries a CHECK
 * constraint that names `stato`, and the index `turns_mondo` names the world
 * in Italian too. Rebuilding the table lets the constraint, the column names
 * and the index name all change together, which is the same procedure SQLite
 * documents for any schema change that a rename cannot express.
 *
 * Data is copied column by column: nothing is dropped, and a turn that was
 * running when the process was killed stays running.
 */
export const ENGLISH_COLUMNS_SCHEMA = `
CREATE TABLE turns_renamed (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  prompt      TEXT NOT NULL,
  text        TEXT,
  error       TEXT,
  state       TEXT NOT NULL DEFAULT 'running'
                CHECK (state IN ('running', 'completed', 'failed')),
  created_at  TEXT NOT NULL,
  finished_at TEXT,
  locale      TEXT NOT NULL DEFAULT 'it'
);

INSERT INTO turns_renamed
  (id, world_id, prompt, text, error, state, created_at, finished_at, locale)
SELECT
  id, world_id, prompt, testo, errore, stato, creato_il, finito_il, locale
FROM turns;

DROP TABLE turns;
ALTER TABLE turns_renamed RENAME TO turns;

CREATE INDEX turns_world ON turns(world_id, created_at);

CREATE TABLE canon_edits_renamed (
  id           TEXT PRIMARY KEY,
  world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  entry_id     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  fields       TEXT NOT NULL,
  before_value TEXT NOT NULL,
  after_value  TEXT NOT NULL,
  reason       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL
);

INSERT INTO canon_edits_renamed
  (id, world_id, entry_id, subject, fields, before_value, after_value, reason, created_at)
SELECT
  id, world_id, entry_id, subject, campo, valore_prima, valore_dopo, motivo, created_at
FROM canon_edits;

DROP TABLE canon_edits;
ALTER TABLE canon_edits_renamed RENAME TO canon_edits;

CREATE INDEX IF NOT EXISTS idx_canon_edits_world
  ON canon_edits (world_id, created_at DESC);
`;
