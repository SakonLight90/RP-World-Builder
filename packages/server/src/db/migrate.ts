import type { Database } from "better-sqlite3";
import { INITIAL_SCHEMA } from "./migrations/001_initial.js";
import { ARCS_SCHEMA } from "./migrations/002_arcs.js";
import { KEPT_MESSAGES_SCHEMA } from "./migrations/003_kept_messages.js";
import { LANGUAGES_SCHEMA } from "./migrations/004_world_libraries.js";
import { PLAYER_CHARACTER_SCHEMA } from "./migrations/005_player_character.js";
import { TURNS_SCHEMA } from "./migrations/006_turns.js";
import { CANON_EDITS_SCHEMA } from "./migrations/007_canon_edits.js";
import { ENGLISH_COLUMNS_SCHEMA } from "./migrations/008_english_columns.js";
import { CONTEXT_LIMIT_SCHEMA } from "./migrations/009_context_limit.js";
import { WORLD_STARTS_SCHEMA } from "./migrations/010_world_starts.js";

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrations live in code, not in separate `.sql` files: that way no
 * asset needs copying into the build and dist stays self-contained.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial", sql: INITIAL_SCHEMA },
  { version: 2, name: "arcs", sql: ARCS_SCHEMA },
  { version: 3, name: "kept-messages", sql: KEPT_MESSAGES_SCHEMA },
  { version: 4, name: "world-libraries", sql: LANGUAGES_SCHEMA },
  { version: 5, name: "player-character", sql: PLAYER_CHARACTER_SCHEMA },
  { version: 6, name: "turns", sql: TURNS_SCHEMA },
  { version: 7, name: "canon-edits", sql: CANON_EDITS_SCHEMA },
  { version: 8, name: "english-columns", sql: ENGLISH_COLUMNS_SCHEMA },
  { version: 9, name: "context-limit", sql: CONTEXT_LIMIT_SCHEMA },
  { version: 10, name: "world-starts", sql: WORLD_STARTS_SCHEMA },
];

const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS _migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`;

export function applyMigrations(db: Database, now: string): number {
  db.exec(CREATE_LEDGER);

  const applied = new Set(
    db
      .prepare<[], { version: number }>("SELECT version FROM _migrations")
      .all()
      .map((row) => row.version),
  );

  let count = 0;
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        now,
      );
    })();
    count += 1;
  }

  return count;
}

export function currentVersion(db: Database): number {
  const table = db
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'",
    )
    .get();
  if (!table) return 0;
  const row = db
    .prepare<[], { version: number | null }>("SELECT MAX(version) AS version FROM _migrations")
    .get();
  return row?.version ?? 0;
}
