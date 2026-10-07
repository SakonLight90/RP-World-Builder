import type { Character, Location, Relationship } from "@rpwb/shared";
import { errorFallback } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { newId, nowIso, parseStringArray, stringify, toBool, toInt } from "./common.js";

/**
 * A character used outside its own world.
 *
 * A dedicated error so the route can answer 400 instead of 500.
 */
export class CastScopeError extends Error {
  readonly #role: string;
  readonly #characterId: string;

  constructor(role: string, characterId: string, worldId: string) {
    super(`character ${role} (${characterId}) does not belong to world ${worldId}`);
    this.name = "CastScopeError";
    this.#role = role;
    this.#characterId = characterId;
  }

  get role(): string {
    return this.#role;
  }

  get characterId(): string {
    return this.#characterId;
  }
}

/**
 * A location whose parent cannot be what the caller asked for: a place inside itself or
 * inside its own descendant belongs to the world all right, it is the hierarchy that
 * makes no sense.
 *
 * Carries the code and not just the sentence, because the route sends it to the interface
 * and a free-form reason would be shown in English only.
 */
export class LocationParentError extends Error {
  readonly code:
    | "cast.locationSelfParent"
    | "cast.locationParentOtherWorld"
    | "cast.locationParentNested";

  constructor(code: LocationParentError["code"]) {
    super(errorFallback(code));
    this.name = "LocationParentError";
    this.code = code;
  }
}

interface LocationRow {
  id: string;
  world_id: string;
  name: string;
  description: string;
  parent_id: string | null;
  aliases: string;
  era: string;
}

interface CharacterRow {
  id: string;
  world_id: string;
  name: string;
  role: string;
  description: string;
  personality: string;
  secret: string;
  status: string;
  location_id: string | null;
  is_player: number;
  canonical: number;
  era: string;
  created_at: string;
}

interface RelationshipRow {
  world_id: string;
  from_character_id: string;
  to_character_id: string;
  affinity: number;
  trust: number;
  note: string;
}

function toLocation(row: LocationRow): Location {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    description: row.description,
    parentId: row.parent_id,
    aliases: parseStringArray(row.aliases),
    era: row.era,
  };
}

function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    worldId: row.world_id,
    name: row.name,
    role: row.role,
    description: row.description,
    personality: row.personality,
    secret: row.secret,
    status: row.status,
    locationId: row.location_id,
    isPlayer: toBool(row.is_player),
    canonical: toBool(row.canonical),
    era: row.era,
    createdAt: row.created_at,
  };
}

function toRelationship(row: RelationshipRow): Relationship {
  return {
    worldId: row.world_id,
    fromCharacterId: row.from_character_id,
    toCharacterId: row.to_character_id,
    affinity: row.affinity,
    trust: row.trust,
    note: row.note,
  };
}

/**
 * Escapes the two `LIKE` wildcards: unescaped, `_` matches every single-character name and
 * `%` the whole table, and both are ordinary text in a name. Escaping anything else would
 * make a literal backslash unsearchable for no gain.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class CastRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  // --- places ---------------------------------------------------------------

  addLocation(worldId: string, input: Omit<Location, "id" | "worldId">): Location {
    const id = newId();
    this.#db
      .prepare(
        `INSERT INTO locations (id, world_id, name, description, parent_id, aliases, era)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        worldId,
        input.name,
        input.description,
        input.parentId,
        stringify(input.aliases),
        input.era,
      );
    const location = this.getLocation(worldId, id);
    if (!location) throw new Error("location not found after creation");
    return location;
  }

  getLocation(worldId: string, id: string): Location | null {
    const row = this.#db
      .prepare<[string, string], LocationRow>(
        "SELECT * FROM locations WHERE world_id = ? AND id = ?",
      )
      .get(worldId, id);
    return row ? toLocation(row) : null;
  }

  listLocations(worldId: string): Location[] {
    return this.#db
      .prepare<[string], LocationRow>(
        "SELECT * FROM locations WHERE world_id = ? ORDER BY name ASC",
      )
      .all(worldId)
      .map(toLocation);
  }

  /**
   * Places matching `text` in name, description or aliases.
   *
   * Aliases are searched because the canon writes a place under one name and the player looks
   * for it under another.
   */
  searchLocations(worldId: string, text: string, limit = 20): Location[] {
    const needle = text.trim();
    if (needle === "") return [];
    const pattern = `%${escapeLike(needle)}%`;
    const rows = this.#db
      .prepare<[string, string, string, string, number], LocationRow>(
        `SELECT * FROM locations
         WHERE world_id = ?
           AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\')
         ORDER BY name ASC
         LIMIT ?`,
      )
      .all(worldId, pattern, pattern, pattern, limit);

    return rows.map(toLocation);
  }

  deleteLocation(worldId: string, id: string): boolean {
    return (
      this.#db
        .prepare<[string, string]>("DELETE FROM locations WHERE world_id = ? AND id = ?")
        .run(worldId, id).changes > 0
    );
  }

  /**
   * Fixes an existing place.
   *
   * The parent is validated here and not in the route: same world, not the place itself, not
   * one of its descendants. Without the three checks you get impossible geographies, which the
   * parent chain then walks forever.
   *
   * `null` when the place does not exist, so the route tells "missing" from "updated".
   */
  updateLocation(
    worldId: string,
    id: string,
    patch: Partial<Omit<Location, "id" | "worldId">>,
  ): Location | null {
    const current = this.getLocation(worldId, id);
    if (!current) return null;
    const next = { ...current, ...patch };

    if (next.parentId !== null) {
      if (next.parentId === id) {
        throw new LocationParentError("cast.locationSelfParent");
      }
      const parent = this.getLocation(worldId, next.parentId);
      if (!parent) {
        throw new LocationParentError("cast.locationParentOtherWorld");
      }
      // A parent below the moved place would make the child its own ancestor.
      if (this.locationAncestry(worldId, parent.id).some((avo) => avo.id === id)) {
        throw new LocationParentError("cast.locationParentNested");
      }
    }

    this.#db
      .prepare(
        `UPDATE locations SET
           name = @name, description = @description, parent_id = @parentId,
           aliases = @aliases, era = @era
         WHERE world_id = @worldId AND id = @id`,
      )
      .run({
        worldId,
        id,
        name: next.name,
        description: next.description,
        parentId: next.parentId,
        aliases: stringify(next.aliases),
        era: next.era,
      });

    return this.getLocation(worldId, id);
  }

  /**
   * Attaches a place to a parent, for the second pass of a world copy: the database does not
   * guarantee a parent before its child.
   */
  reparentLocation(worldId: string, id: string, parentId: string | null): void {
    this.#db
      .prepare<[string | null, string, string]>(
        "UPDATE locations SET parent_id = ? WHERE world_id = ? AND id = ?",
      )
      .run(parentId, worldId, id);
  }

  /** Parent chain: feeds the turn with the geographic context. */
  locationAncestry(worldId: string, id: string): Location[] {
    const chain: Location[] = [];
    let current = this.getLocation(worldId, id);
    const seen = new Set<string>();

    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.push(current);
      current = current.parentId === null ? null : this.getLocation(worldId, current.parentId);
    }
    return chain;
  }

  // --- characters -----------------------------------------------------------

  addCharacter(worldId: string, input: Omit<Character, "id" | "worldId" | "createdAt">): Character {
    const id = newId();
    this.#db
      .prepare(
        `INSERT INTO characters (
           id, world_id, name, role, description, personality, secret, status,
           location_id, is_player, canonical, era, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        worldId,
        input.name,
        input.role,
        input.description,
        input.personality,
        input.secret,
        input.status,
        input.locationId,
        input.isPlayer ? 1 : 0,
        input.canonical ? 1 : 0,
        input.era,
        nowIso(),
      );
    const character = this.getCharacter(worldId, id);
    if (!character) throw new Error("character not found after creation");
    return character;
  }

  getCharacter(worldId: string, id: string): Character | null {
    const row = this.#db
      .prepare<[string, string], CharacterRow>(
        "SELECT * FROM characters WHERE world_id = ? AND id = ?",
      )
      .get(worldId, id);
    return row ? toCharacter(row) : null;
  }

  listCharacters(worldId: string, options: { onlyCanonical?: boolean } = {}): Character[] {
    const rows =
      options.onlyCanonical === true
        ? this.#db
            .prepare<[string], CharacterRow>(
              "SELECT * FROM characters WHERE world_id = ? AND canonical = 1 ORDER BY name ASC",
            )
            .all(worldId)
        : this.#db
            .prepare<[string], CharacterRow>(
              "SELECT * FROM characters WHERE world_id = ? ORDER BY name ASC",
            )
            .all(worldId);
    return rows.map(toCharacter);
  }

  /**
   * Characters matching `text` in name, role or description.
   *
   * Three columns because a character is findable by any of the three things a reader knows:
   * who they are, what they do, how they look.
   */
  searchCharacters(worldId: string, text: string, limit = 20): Character[] {
    const needle = text.trim();
    if (needle === "") return [];
    const pattern = `%${escapeLike(needle)}%`;
    return this.#db
      .prepare<[string, string, string, string, number], CharacterRow>(
        `SELECT * FROM characters
         WHERE world_id = ?
           AND (name LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
         ORDER BY name ASC
         LIMIT ?`,
      )
      .all(worldId, pattern, pattern, pattern, limit)
      .map(toCharacter);
  }

  /** Characters on stage: those in the current place, excluding the player. */
  charactersAt(worldId: string, locationId: string): Character[] {
    return this.#db
      .prepare<[string, string], CharacterRow>(
        `SELECT * FROM characters
         WHERE world_id = ? AND location_id = ? AND canonical = 1
         ORDER BY name ASC`,
      )
      .all(worldId, locationId)
      .map(toCharacter);
  }

  updateCharacter(
    worldId: string,
    id: string,
    patch: Partial<Omit<Character, "id" | "worldId" | "createdAt">>,
  ): Character | null {
    const current = this.getCharacter(worldId, id);
    if (!current) return null;
    const next = { ...current, ...patch };

    this.#db
      .prepare(
        `UPDATE characters SET
           name = @name, role = @role, description = @description, personality = @personality,
           secret = @secret, status = @status, location_id = @locationId, is_player = @isPlayer,
           canonical = @canonical, era = @era
         WHERE world_id = @worldId AND id = @id`,
      )
      .run({
        worldId,
        id,
        name: next.name,
        role: next.role,
        description: next.description,
        personality: next.personality,
        secret: next.secret,
        status: next.status,
        locationId: next.locationId,
        isPlayer: next.isPlayer ? 1 : 0,
        canonical: next.canonical ? 1 : 0,
        era: next.era,
      });

    return this.getCharacter(worldId, id);
  }

  deleteCharacter(worldId: string, id: string): boolean {
    return (
      this.#db
        .prepare<[string, string]>("DELETE FROM characters WHERE world_id = ? AND id = ?")
        .run(worldId, id).changes > 0
    );
  }

  /**
   * Deletes **all** characters of a world and returns how many it had.
   *
   * Backs "Restart": a name wrongly promoted in the previous game would otherwise stay in the
   * new lineup with no way to remove it from chat.
   *
   * Relationships go away on their own through `ON DELETE CASCADE`.
   */
  deleteAllCharacters(worldId: string): number {
    const removed = this.#db
      .prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM characters WHERE world_id = ?")
      .get(worldId);
    this.#db.prepare<[string]>("DELETE FROM characters WHERE world_id = ?").run(worldId);
    return removed?.n ?? 0;
  }

  // --- relationships ------------------------------------------------------------

  setRelationship(worldId: string, input: Relationship): Relationship {
    // Both characters must belong to this world: the table constraint checks only that they
    // exist, so without this a relationship between characters of another game reaches this
    // lineup and the state card presents them as knowing each other.
    const lookup = this.#db.prepare(`SELECT id FROM characters WHERE id = ? AND world_id = ?`);
    for (const [role, characterId] of [
      ["from", input.fromCharacterId],
      ["to", input.toCharacterId],
    ] as const) {
      if (!lookup.get(characterId, worldId)) {
        throw new CastScopeError(role, characterId, worldId);
      }
    }

    this.#db
      .prepare(
        `INSERT INTO relationships (world_id, from_character_id, to_character_id, affinity, trust, note)
         VALUES (@worldId, @fromCharacterId, @toCharacterId, @affinity, @trust, @note)
         ON CONFLICT (world_id, from_character_id, to_character_id) DO UPDATE SET
           affinity = excluded.affinity,
           trust = excluded.trust,
           note = excluded.note`,
      )
      .run({
        worldId,
        fromCharacterId: input.fromCharacterId,
        toCharacterId: input.toCharacterId,
        affinity: toInt(input.affinity),
        trust: toInt(input.trust),
        note: input.note,
      });
    return input;
  }

  listRelationships(worldId: string): Relationship[] {
    return this.#db
      .prepare<[string], RelationshipRow>("SELECT * FROM relationships WHERE world_id = ?")
      .all(worldId)
      .map(toRelationship);
  }

  /** Relationships involving a character, in both directions. */
  relationshipsOf(worldId: string, characterId: string): Relationship[] {
    return this.#db
      .prepare<[string, string, string], RelationshipRow>(
        `SELECT * FROM relationships
         WHERE world_id = ?
           AND (from_character_id = ? OR to_character_id = ?)`,
      )
      .all(worldId, characterId, characterId)
      .map(toRelationship);
  }

  deleteRelationship(worldId: string, from: string, to: string): boolean {
    return (
      this.#db
        .prepare<[string, string, string]>(
          "DELETE FROM relationships WHERE world_id = ? AND from_character_id = ? AND to_character_id = ?",
        )
        .run(worldId, from, to).changes > 0
    );
  }
}
