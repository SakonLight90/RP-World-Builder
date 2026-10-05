/**
 * Migration 002: arcs.
 *
 * 001 is left alone because it already ran on existing databases:
 * changing it would change nothing there and would break comparison across
 * different installs.
 */
export const ARCS_SCHEMA = `
CREATE TABLE arcs (
  id            TEXT PRIMARY KEY,
  world_id      TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  n             INTEGER NOT NULL,
  title         TEXT NOT NULL,
  logline       TEXT NOT NULL DEFAULT '',
  spine         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'open',
  first_chapter INTEGER NOT NULL DEFAULT 0,
  last_chapter  INTEGER NOT NULL DEFAULT 0,
  canon_refs    TEXT NOT NULL DEFAULT '[]',
  tokens        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (world_id, n)
);

CREATE INDEX arcs_world ON arcs(world_id, n);

ALTER TABLE chapters ADD COLUMN arc_id TEXT REFERENCES arcs(id) ON DELETE SET NULL;
CREATE INDEX chapters_arc ON chapters(arc_id);
`;
