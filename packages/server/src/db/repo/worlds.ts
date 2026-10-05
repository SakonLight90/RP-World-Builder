import {
  BIBLE_SECTIONS,
  type Bible,
  type BibleSection,
  DEFAULT_REASONING_EFFORT,
  EMPTY_BIBLE,
  type Era,
  type LibraryRequirement,
  type PlayerCharacter,
  REASONING_EFFORTS,
  type ReasoningEffort,
  WORLD_DEFAULTS,
  type World,
} from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { CanonRepository } from "./canon.js";
import { CastRepository } from "./cast.js";
import { newId, nowIso, toBool, toStr } from "./common.js";

interface WorldRow {
  id: string;
  name: string;
  slug: string;
  base_locale: string;
  active_locale: string;
  description: string;
  canon_mode: string;
  model: string;
  small_model: string;
  reasoning_effort: string;
  chapter_threshold_ratio: number;
  canon_budget_ratio: number;
  context_limit: number | null;
  opencode_dir: string;
  opencode_session_id: string | null;
  is_template: number;
  template_author: string | null;
  /** How many conversation messages the player chose to keep. */
  kept_messages: number;
  /** Requested lore libraries, serialised as JSON. */
  libraries: string;
  /**
   * The player character, serialised as JSON.
   *
   * Optional because the column arrives with a migration: on a database that
   * does not have it yet the field is simply absent, and it has to be read as
   * "no character" instead of making the row fail.
   */
  player_character?: string | null;
  created_at: string;
  updated_at: string;
}

interface EraRow {
  id: string;
  world_id: string;
  key: string;
  label: string;
  start_year: number | null;
  end_year: number | null;
  summary: string;
}

const WORLD_COLUMNS = `
  id, name, slug, base_locale, active_locale, description, canon_mode, model, small_model,
  reasoning_effort, chapter_threshold_ratio, canon_budget_ratio, context_limit, opencode_dir,
  opencode_session_id, is_template, template_author, libraries, created_at, updated_at
`;

const PLAYER_COLUMN = "player_character";

/**
 * The character column is added to `worlds` with a migration, so it is not
 * guaranteed: a database opened by a previous build has it only if the migrations
 * have run.
 *
 * So it is asked of the schema, once, instead of putting the column in the fixed
 * `SELECT`. The reason is that the `SELECT` is the way in for every world: if it
 * named a missing column it would not lose the character, which is an extra, but
 * it would lose the whole table, and a world that does not load cannot be told
 * apart from a world that does not exist.
 */
function playerColumn(db: Database): string {
  const present = db
    .prepare<[], { name: string }>("PRAGMA table_info(worlds)")
    .all()
    .some((column) => column.name === PLAYER_COLUMN);
  return present ? `, ${PLAYER_COLUMN}` : "";
}

function toWorld(row: WorldRow): World {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseLocale: row.base_locale,
    activeLocale: row.active_locale,
    description: row.description,
    canonMode: "strict",
    model: row.model,
    smallModel: row.small_model,
    reasoningEffort: toReasoning(row.reasoning_effort),
    chapterThresholdRatio: row.chapter_threshold_ratio,
    canonBudgetRatio: row.canon_budget_ratio,
    contextLimit: row.context_limit,
    opencodeDir: row.opencode_dir,
    opencodeSessionId: row.opencode_session_id,
    libraries: toLibraries(row.libraries),
    player: toPlayer(row.player_character),
    isTemplate: toBool(row.is_template),
    templateAuthor: row.template_author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReasoning(value: string): ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT;
}

/**
 * The `libraries` column is JSON when written, but on read it has to be an
 * array of valid objects: if the JSON is corrupted, or if the column holds
 * something that is not a list of requirements, the world still loads, without
 * libraries. Because a world without libraries is a legitimate state: it can be a
 * new world that requires none. It must not become a world that does not start
 * because a library broke.
 */
function toLibraries(raw: string): LibraryRequirement[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (item === null || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const id = entry.id;
      const version = entry.version;
      if (typeof id !== "string" || id === "") return [];
      if (typeof version !== "string" || version === "") return [];
      return [{ id, version, hash: typeof entry.hash === "string" ? entry.hash : "" }];
    });
  } catch {
    return [];
  }
}

/**
 * The `player_character` column is JSON when written, but on read it has to be a
 * character or nothing: if the JSON is corrupted, if it is not an object, or if
 * the name is missing, the world still loads, without a character. As with the
 * libraries, degrading is the right choice because a world without a character is
 * a legitimate state and is reached even with nothing broken.
 *
 * An empty or blank name is discarded for the same reason: it is not a
 * character, it is a half-filled field the narrator would end up completing with
 * an invented name.
 */
function toPlayer(raw: unknown): PlayerCharacter | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const entry = parsed as Record<string, unknown>;
    const name = toStr(entry.name).trim();
    if (name === "") return undefined;
    return {
      name,
      role: toStr(entry.role).trim(),
      description: toStr(entry.description).trim(),
    };
  } catch {
    return undefined;
  }
}

function toEra(row: EraRow): Era {
  return {
    key: row.key,
    label: row.label,
    ...(row.start_year === null ? {} : { startYear: row.start_year }),
    ...(row.end_year === null ? {} : { endYear: row.end_year }),
    summary: row.summary,
  };
}

export interface CreateWorldInput {
  name: string;
  slug: string;
  model: string;
  smallModel: string;
  reasoningEffort?: ReasoningEffort;
  /** The player's context window, or null to ask the provider. */
  contextLimit?: number | null;
  opencodeDir: string;
  baseLocale?: string;
  activeLocale?: string;
  description?: string;
  isTemplate?: boolean;
  templateAuthor?: string | null;
  /** Library requirements to set at creation. */
  libraries?: LibraryRequirement[];
  /** Player character to set at creation. */
  player?: PlayerCharacter;
  chapterThresholdRatio?: number;
  canonBudgetRatio?: number;
}

export class WorldRepository {
  readonly #db: Database;
  /** Suffix of the columns to read, decided once and reused. */
  #playerColumns: string | null = null;

  constructor(db: Database) {
    this.#db = db;
  }

  /** The character column, or the empty string if the migration is not there. */
  #playerColumn(): string {
    this.#playerColumns ??= playerColumn(this.#db);
    return this.#playerColumns;
  }

  /** `worlds` columns, with the character's only if the migration created it. */
  #columns(): string {
    return `${WORLD_COLUMNS}${this.#playerColumn()}`;
  }

  create(input: CreateWorldInput): World {
    const now = nowIso();
    const id = newId();

    this.#db
      .prepare(
        `INSERT INTO worlds (
           id, name, slug, base_locale, active_locale, description, canon_mode, model,
           small_model, reasoning_effort, chapter_threshold_ratio, canon_budget_ratio, context_limit,
opencode_dir, opencode_session_id, is_template, template_author, kept_messages, libraries, created_at, updated_at
         ) VALUES (
            @id, @name, @slug, @baseLocale, @activeLocale, @description, 'strict', @model,
            @smallModel, @reasoningEffort, @chapterThresholdRatio, @canonBudgetRatio, @contextLimit, @opencodeDir,
             NULL, @isTemplate, @templateAuthor, -1, @libraries, @now, @now
           )`,
      )
      .run({
        id,
        name: input.name,
        slug: input.slug,
        baseLocale: input.baseLocale ?? "it",
        activeLocale: input.activeLocale ?? input.baseLocale ?? "it",
        description: input.description ?? "",
        model: input.model,
        smallModel: input.smallModel,
        reasoningEffort: input.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
        contextLimit: input.contextLimit ?? null,
        chapterThresholdRatio: input.chapterThresholdRatio ?? WORLD_DEFAULTS.chapterThresholdRatio,
        canonBudgetRatio: input.canonBudgetRatio ?? WORLD_DEFAULTS.canonBudgetRatio,
        opencodeDir: input.opencodeDir,
        isTemplate: input.isTemplate === true ? 1 : 0,
        templateAuthor: input.templateAuthor ?? null,
        libraries: JSON.stringify(input.libraries ?? []),
        now,
      });

    // The Bible starts empty but with all the sections present: the narrator has
    // to be able to rely on a fixed structure, not on keys that may be missing.
    for (const section of BIBLE_SECTIONS) {
      this.setBibleSection(id, section, "");
    }

    // The character is written with the same method the user will use, and not
    // inside the `INSERT`: a column in two places is a column that sooner or later
    // is forgotten in one of the two.
    if (input.player !== undefined) this.setPlayer(id, input.player);

    const world = this.get(id);
    if (!world) throw new Error("world not found after creation");
    return world;
  }

  get(id: string): World | null {
    const row = this.#db
      .prepare<[string], WorldRow>(`SELECT ${this.#columns()} FROM worlds WHERE id = ?`)
      .get(id);
    return row ? toWorld(row) : null;
  }

  /**
   * Sets the player character, or removes it with `null`.
   *
   * There is a dedicated method and not just an `update` field because the
   * character changes on its own, while everything else about the world changes
   * from the edit screen: forcing a re-read and rewrite of the whole world for a
   * name means that sooner or later nobody saves it.
   */
  setPlayer(id: string, player: PlayerCharacter | null): void {
    if (this.#playerColumn() === "") {
      throw new Error(
        "player_character column missing: the player character migration was not applied",
      );
    }
    this.#db
      .prepare("UPDATE worlds SET player_character = ?, updated_at = ? WHERE id = ?")
      .run(player === null ? null : JSON.stringify(player), nowIso(), id);
  }

  /**
   * How many conversation messages are left.
   *
   * `-1` means "all": "Delete" has never been pressed even once.
   */
  keptMessages(id: string): number {
    const row = this.#db
      .prepare<[string], { kept_messages: number }>("SELECT kept_messages FROM worlds WHERE id = ?")
      .get(id);
    return row?.kept_messages ?? -1;
  }

  /**
   * Sets how many messages to keep. `-1` means "all".
   *
   * The minimum of one only applies to positive numbers, and that distinction is
   * the whole problem: `Math.max(1, -1)` yields `1`, so the "all" bookmark was
   * never actually writable. A single conversation reset was enough to plant that
   * `1`, and from then on the transcript showed only the prologue forever: the
   * narrator answered, the session grew, and the UI looked like the prompt had
   * never gone out. The campaign moved on with nobody seeing it.
   */
  setKeptMessages(id: string, count: number): void {
    const value = count < 0 ? -1 : Math.max(1, count);
    this.#db
      .prepare("UPDATE worlds SET kept_messages = ?, updated_at = ? WHERE id = ?")
      .run(value, new Date().toISOString(), id);
  }

  getBySlug(slug: string): World | null {
    const row = this.#db
      .prepare<[string], WorldRow>(`SELECT ${this.#columns()} FROM worlds WHERE slug = ?`)
      .get(slug);
    return row ? toWorld(row) : null;
  }

  /**
   * The playable worlds, and only those.
   *
   * Excluding the templates is not fussiness: a template is the model you start
   * from, not a campaign. If it also ended up here it would appear twice in the
   * same answer, as a world and as a template, and in the "your worlds" page there
   * would be an entry that cannot be opened and whose reason for existing is
   * unclear.
   */
  list(): World[] {
    return this.#db
      .prepare<[], WorldRow>(
        `SELECT ${this.#columns()} FROM worlds WHERE is_template = 0 ORDER BY updated_at DESC`,
      )
      .all()
      .map(toWorld);
  }

  listTemplates(): World[] {
    return this.#db
      .prepare<[], WorldRow>(
        `SELECT ${this.#columns()} FROM worlds WHERE is_template = 1 ORDER BY name ASC`,
      )
      .all()
      .map(toWorld);
  }

  update(id: string, patch: Partial<Omit<World, "id" | "createdAt">>): World | null {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, updatedAt: nowIso() };

    this.#db
      .prepare(
        `UPDATE worlds SET
           name = @name, slug = @slug, base_locale = @baseLocale, active_locale = @activeLocale,
           description = @description, model = @model, small_model = @smallModel,
           reasoning_effort = @reasoningEffort,
           chapter_threshold_ratio = @chapterThresholdRatio, canon_budget_ratio = @canonBudgetRatio,
  context_limit = @contextLimit,
           opencode_dir = @opencodeDir, opencode_session_id = @opencodeSessionId,
is_template = @isTemplate, template_author = @templateAuthor,
            libraries = @libraries,
            updated_at = @updatedAt
          WHERE id = @id`,
      )
      .run({
        id,
        name: next.name,
        slug: next.slug,
        baseLocale: next.baseLocale,
        activeLocale: next.activeLocale,
        description: next.description,
        model: next.model,
        smallModel: next.smallModel,
        reasoningEffort: next.reasoningEffort,
        contextLimit: next.contextLimit,
        chapterThresholdRatio: next.chapterThresholdRatio,
        canonBudgetRatio: next.canonBudgetRatio,
        opencodeDir: next.opencodeDir,
        opencodeSessionId: next.opencodeSessionId,
        isTemplate: next.isTemplate ? 1 : 0,
        templateAuthor: next.templateAuthor,
        libraries: JSON.stringify(next.libraries),
        updatedAt: next.updatedAt,
      });

    // The character is not in the `UPDATE` above, which lists a column per item.
    // It has to be written only when it was explicitly asked for: an `update` of
    // the world's name must not zero out the protagonist, and an `update` without
    // a character must not touch it.
    if (patch.player !== undefined) this.setPlayer(id, patch.player);

    return this.get(id);
  }

  delete(id: string): boolean {
    return this.#db.prepare<[string]>("DELETE FROM worlds WHERE id = ?").run(id).changes > 0;
  }

  setBibleSection(worldId: string, section: BibleSection, body: string): void {
    this.#db
      .prepare(
        `INSERT INTO bible (world_id, section, body, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (world_id, section) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
      )
      .run(worldId, section, body, nowIso());
  }

  getBible(worldId: string): Bible {
    const rows = this.#db
      .prepare<[string], { section: string; body: string }>(
        "SELECT section, body FROM bible WHERE world_id = ?",
      )
      .all(worldId);

    const bible: Bible = { ...EMPTY_BIBLE };
    for (const row of rows) {
      if ((BIBLE_SECTIONS as readonly string[]).includes(row.section)) {
        bible[row.section as BibleSection] = toStr(row.body);
      }
    }
    return bible;
  }

  listEras(worldId: string): Era[] {
    return this.#db
      .prepare<[string], EraRow>("SELECT * FROM eras WHERE world_id = ? ORDER BY start_year ASC")
      .all(worldId)
      .map(toEra);
  }

  replaceEras(worldId: string, eras: Era[]): void {
    const insert = this.#db.prepare(
      `INSERT INTO eras (id, world_id, key, label, start_year, end_year, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (world_id, key) DO UPDATE SET
         label = excluded.label,
         start_year = excluded.start_year,
         end_year = excluded.end_year,
         summary = excluded.summary`,
    );

    this.#db.transaction(() => {
      /*
       * Eras whose key is not in the list are removed, not left behind. The name
       * promised a replacement and the code only did an upsert: removing "pre-war"
       * from the list changed nothing and the era stayed in the narrator's
       * context, which kept quoting it as if it were still active. A list of eras
       * that gets shorter must shorten the world too.
       */
      const tenute = eras.map((era) => era.key);
      if (tenute.length === 0) {
        this.#db.prepare(`DELETE FROM eras WHERE world_id = ?`).run(worldId);
      } else {
        const placeholders = tenute.map(() => "?").join(", ");
        this.#db
          .prepare(`DELETE FROM eras WHERE world_id = ? AND key NOT IN (${placeholders})`)
          .run(worldId, ...tenute);
      }

      for (const era of eras) {
        insert.run(
          newId(),
          worldId,
          era.key,
          era.label,
          era.startYear ?? null,
          era.endYear ?? null,
          era.summary,
        );
      }
    })();
  }

  /** Copies the world, the canon and the Bible: it is for forking a template. */
  clone(sourceId: string, overrides: Partial<CreateWorldInput>): World {
    const source = this.get(sourceId);
    if (!source) throw new Error("source world does not exist");

    const clone = this.create({
      name: overrides.name ?? `${source.name} (copy)`,
      slug: overrides.slug ?? `${source.slug}-copy`,
      model: overrides.model ?? source.model,
      smallModel: overrides.smallModel ?? source.smallModel,
      reasoningEffort: overrides.reasoningEffort ?? source.reasoningEffort,
      contextLimit: overrides.contextLimit ?? source.contextLimit,
      opencodeDir: overrides.opencodeDir ?? source.opencodeDir,
      baseLocale: overrides.baseLocale ?? source.baseLocale,
      activeLocale: overrides.activeLocale ?? source.activeLocale,
      description: overrides.description ?? source.description,
      isTemplate: false,
      chapterThresholdRatio: source.chapterThresholdRatio,
      canonBudgetRatio: source.canonBudgetRatio,
      // Requirements are copied by reference, not their contents: the clone asks
      // for the same library as the source, which stays unique and read-only. That
      // is the point of the whole mechanism: cloning a world does not clone the
      // lore.
      libraries: overrides.libraries ?? source.libraries,
      // The character, on the other hand, is not cloned. A template is the model
      // somebody starts from, and whoever starts declares their own protagonist:
      // without this, forking a template would carry around the name of whoever
      // wrote it, and the narrator would tell a stranger about a person they have
      // never met.
      player: overrides.player,
    });

    const bible = this.getBible(sourceId);
    for (const section of BIBLE_SECTIONS) {
      this.setBibleSection(clone.id, section, bible[section]);
    }
    this.replaceEras(clone.id, this.listEras(sourceId));
    this.#copyCanon(sourceId, clone.id);
    this.#copyCast(sourceId, clone.id);
    return clone;
  }

  /**
   * Copies the canon.
   *
   * It has to be done, otherwise a world created from a template is born with its
   * Bible and its eras but **zero canon entries**: everything looks ready and the
   * narrator has nothing to work from. It is the worst case, because it looks
   * like it works.
   */
  #copyCanon(sourceId: string, cloneId: string): void {
    // `listAll`, not `list`: `list` only keeps the entries of the active era, and
    // copying those would lose half the canon without anything flagging it.
    const entries = new CanonRepository(this.#db).listAll(sourceId);
    if (entries.length === 0) return;

    // The ids have to change: an id shared between two worlds makes a change to
    // one touch the other, and that is not immediately visible.
    const remap = new Map<string, string>();
    for (const entry of entries) {
      remap.set(entry.id, `${cloneId}-${entry.id}`);
    }

    this.#db.transaction(() => {
      new CanonRepository(this.#db).upsertMany(
        entries.map((entry) => ({
          ...entry,
          id: remap.get(entry.id) ?? entry.id,
          worldId: cloneId,
        })),
      );
    })();
  }

  /** Copies characters, places and relationships, recalculating the references. */
  #copyCast(sourceId: string, cloneId: string): void {
    const cast = new CastRepository(this.#db);

    const places = cast.listLocations(sourceId);
    const placeIds = new Map<string, string>();
    for (const place of places) {
      placeIds.set(
        place.id,
        cast.addLocation(cloneId, {
          name: place.name,
          description: place.description,
          aliases: [...place.aliases],
          era: place.era,
          // The parent is recalculated: if it has not been copied yet, it waits.
          // Places arrive in the order the database gives them, and it is not
          // guaranteed that a parent comes before its child.
          parentId: place.parentId === null ? null : (placeIds.get(place.parentId) ?? null),
        }).id,
      );
    }

    // If some parent was ahead of its child, a second round fixes it:
    // `addLocation` creates the place without a parent and it is then attached.
    for (const place of places) {
      if (place.parentId === null) continue;
      const child = placeIds.get(place.id);
      const parent = placeIds.get(place.parentId);
      if (child === undefined || parent === undefined) continue;
      cast.reparentLocation(cloneId, child, parent);
    }

    const people = cast.listCharacters(sourceId);
    const peopleIds = new Map<string, string>();
    for (const person of people) {
      peopleIds.set(
        person.id,
        cast.addCharacter(cloneId, {
          name: person.name,
          role: person.role,
          description: person.description,
          personality: person.personality,
          secret: person.secret,
          status: person.status,
          isPlayer: person.isPlayer,
          canonical: person.canonical,
          era: person.era,
          locationId: person.locationId === null ? null : (placeIds.get(person.locationId) ?? null),
        }).id,
      );
    }

    // Relationships are between characters: without recalculating the ids they
    // would point at characters of the starting world, which do not exist here.
    for (const relation of cast.listRelationships(sourceId)) {
      const from = peopleIds.get(relation.fromCharacterId);
      const to = peopleIds.get(relation.toCharacterId);
      if (from === undefined || to === undefined) continue;
      cast.setRelationship(cloneId, {
        worldId: cloneId,
        fromCharacterId: from,
        toCharacterId: to,
        affinity: relation.affinity,
        trust: relation.trust,
        note: relation.note,
      });
    }
  }
}
