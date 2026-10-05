/**
 * Migration 004: libraries required by the world.
 *
 * Requirements live in a JSON column, not in a row table. They are a
 * short list of references (`id`, `version`, `hash`) read all
 * together and edited all together: a separate table would
 * cost a join per use and an extra write path for data
 * never searched by single fields.
 *
 * The default is `'[]'`, not NULL, so `readWorlds` need not tell
 * "no requirements" apart from "row without column", which are the same thing
 * yet look like two.
 */
export const LANGUAGES_SCHEMA = `ALTER TABLE worlds ADD COLUMN libraries TEXT NOT NULL DEFAULT '[]';`;
