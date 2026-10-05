import BetterSqlite3, { type Database } from "better-sqlite3";
import { applyMigrations, currentVersion } from "./migrate.js";

export interface OpenOptions {
  /** `:memory:` for tests. */
  path: string;
  now: () => string;
}

/**
 * WAL and `foreign_keys` are on by design: the second fails fast
 * on a broken reference instead of silently leaving orphan rows, and the
 * first allows concurrent reads while the chapterer writes.
 */
export function openDatabase(options: OpenOptions): Database {
  const db = new BetterSqlite3(options.path);

  db.pragma("foreign_keys = ON");
  if (options.path !== ":memory:") {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  db.pragma("busy_timeout = 5000");

  applyMigrations(db, options.now());
  return db;
}

export function databaseVersion(db: Database): number {
  return currentVersion(db);
}

/** Used by tests to get a clean database without touching disk. */
export function openMemory(now: () => string = () => new Date().toISOString()): Database {
  return openDatabase({ path: ":memory:", now });
}
