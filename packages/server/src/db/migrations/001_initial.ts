/**
 * Migration 001: initial schema.
 *
 * Note on `canon_fts`: the `unicode61 remove_diacritics 2` tokenizer is not a
 * detail. Without `remove_diacritics` canon search fails on names
 * with accents or on accented foreign proper names, which are most
 * of the material we care about.
 */
export const INITIAL_SCHEMA = `
CREATE TABLE worlds (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  slug                   TEXT NOT NULL UNIQUE,
  base_locale            TEXT NOT NULL DEFAULT 'it',
  active_locale          TEXT NOT NULL DEFAULT 'it',
  description            TEXT NOT NULL DEFAULT '',
  canon_mode             TEXT NOT NULL DEFAULT 'strict',
  model                  TEXT NOT NULL,
  small_model            TEXT NOT NULL,
  reasoning_effort       TEXT NOT NULL DEFAULT 'default',
  chapter_threshold_ratio REAL NOT NULL DEFAULT 0.7,
  canon_budget_ratio     REAL NOT NULL DEFAULT 0.25,
  opencode_dir           TEXT NOT NULL,
  opencode_session_id    TEXT,
  is_template            INTEGER NOT NULL DEFAULT 0,
  template_author        TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE eras (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  start_year INTEGER,
  end_year   INTEGER,
  summary    TEXT NOT NULL DEFAULT '',
  UNIQUE (world_id, key)
);

CREATE TABLE bible (
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  section    TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (world_id, section)
);

CREATE TABLE canon_entries (
  id           TEXT PRIMARY KEY,
  world_id     TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  aliases      TEXT NOT NULL DEFAULT '[]',
  summary      TEXT NOT NULL DEFAULT '',
  facts        TEXT NOT NULL DEFAULT '[]',
  era          TEXT NOT NULL DEFAULT 'any',
  status       TEXT NOT NULL DEFAULT 'active',
  priority     INTEGER NOT NULL DEFAULT 0,
  tokens       INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL DEFAULT '',
  source_url   TEXT NOT NULL DEFAULT '',
  accessed_at  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX canon_entries_world ON canon_entries(world_id);
CREATE INDEX canon_entries_kind  ON canon_entries(world_id, kind);
CREATE INDEX canon_entries_era   ON canon_entries(world_id, era);

-- Canonical identity of an entry: reloading the corpus must be idempotent.
-- The same subject in different eras is two distinct entries.
CREATE UNIQUE INDEX canon_entries_identity ON canon_entries(world_id, subject, era);

CREATE VIRTUAL TABLE canon_fts USING fts5(
  subject,
  summary,
  facts,
  content='canon_entries',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER canon_entries_ai AFTER INSERT ON canon_entries BEGIN
  INSERT INTO canon_fts(rowid, subject, summary, facts)
  VALUES (new.rowid, new.subject, new.summary, new.facts);
END;

CREATE TRIGGER canon_entries_ad AFTER DELETE ON canon_entries BEGIN
  INSERT INTO canon_fts(canon_fts, rowid, subject, summary, facts)
  VALUES ('delete', old.rowid, old.subject, old.summary, old.facts);
END;

CREATE TRIGGER canon_entries_au AFTER UPDATE ON canon_entries BEGIN
  INSERT INTO canon_fts(canon_fts, rowid, subject, summary, facts)
  VALUES ('delete', old.rowid, old.subject, old.summary, old.facts);
  INSERT INTO canon_fts(rowid, subject, summary, facts)
  VALUES (new.rowid, new.subject, new.summary, new.facts);
END;

CREATE TABLE locations (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id   TEXT REFERENCES locations(id) ON DELETE SET NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',
  era         TEXT NOT NULL DEFAULT 'any'
);

CREATE INDEX locations_world ON locations(world_id);

CREATE TABLE characters (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  secret      TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '',
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  is_player   INTEGER NOT NULL DEFAULT 0,
  canonical   INTEGER NOT NULL DEFAULT 1,
  era         TEXT NOT NULL DEFAULT 'any',
  created_at  TEXT NOT NULL
);

CREATE INDEX characters_world ON characters(world_id);
CREATE INDEX characters_location ON characters(location_id);

CREATE TABLE relationships (
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  from_character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  to_character_id   TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  affinity          INTEGER NOT NULL DEFAULT 0,
  trust             INTEGER NOT NULL DEFAULT 0,
  note              TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (world_id, from_character_id, to_character_id)
);

CREATE TABLE chapters (
  id          TEXT PRIMARY KEY,
  world_id    TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  locale      TEXT NOT NULL DEFAULT 'it',
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  path        TEXT NOT NULL,
  token_start INTEGER NOT NULL DEFAULT 0,
  token_end   INTEGER NOT NULL DEFAULT 0,
  canon_refs  TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  UNIQUE (world_id, n)
);

CREATE TABLE canon_audit (
  id         TEXT PRIMARY KEY,
  world_id   TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  claim      TEXT NOT NULL,
  verdict    TEXT NOT NULL,
  canon_ref  TEXT NOT NULL DEFAULT '',
  suggestion TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX canon_audit_world ON canon_audit(world_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
