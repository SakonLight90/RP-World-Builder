/**
 * Migration 005: the player character.
 *
 * One JSON column, not a row table. The protagonist is one and only, read
 * all together and written all together: a separate table would cost
 * a join every turn for data never searched by single fields, and
 * would give two ways to say the same thing (one row, or none).
 *
 * The default is NULL, not `'{}'` or `''`. Between "no character" and "a
 * nameless character" lies a difference the narrator feels at once:
 * with NULL it has nothing to invent a protagonist from, with an empty
 * string it has a field to fill and fills it. NULL is also the only default
 * that does not lie: worlds created before this migration have no character,
 * and cannot have one.
 */
export const PLAYER_CHARACTER_SCHEMA = `
ALTER TABLE worlds ADD COLUMN player_character TEXT DEFAULT NULL;
`;
