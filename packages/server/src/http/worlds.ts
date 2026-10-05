/**
 * Worlds and their sharing: creating, reading, updating, deleting,
 * exporting, importing, and loading the corpus.
 *
 * It all lived in `routes.ts` with everything else: splitting it changes no line of
 * behavior, but now anyone looking for "what import does" opens a single file.
 */

import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  apiProblem,
  BIBLE_SECTIONS,
  type CanonEntry,
  type Character,
  type Era,
  type Location,
  REASONING_EFFORTS,
  type ReasoningEffort,
  type Relationship,
  type World,
} from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { worldsDir } from "../config/paths.js";
import { loadCorpus } from "../corpus/load.js";
import type { ArcRepository } from "../db/repo/arcs.js";
import { newId } from "../db/repo/common.js";
import { defaultNarratorModel, readModelCatalog } from "../opencode/models.js";
import { BibleBody, CreateWorldBody, EraBody, SelectStartBody, UpdateWorldBody } from "./schema.js";
import type { RouteScope } from "./scope.js";

/**
 * What happened to a world's folder.
 *
 * The three cases are separate because they need opposite answers. `outside` is
 * the path check doing its job: the folder is not ours to delete, and refusing
 * to delete the world because of it would leave a world that can never be
 * removed from the interface. `blocked` is a folder inside our own data
 * directory that Windows would not let go of, and that has to stop the delete:
 * going ahead leaves an invisible folder that no list will ever show again.
 */
export type WorldDirOutcome = "removed" | "outside" | "blocked";

/**
 * Deletes a world's folder, without touching anything else.
 *
 * The path check is not optional: `opencodeDir` comes from the database and here
 * `rm` is called recursively. Without the check, a world with a stale
 * directory pointing elsewhere would delete that one; without the special case
 * for the root, a world with `opencodeDir` set to the data dir would wipe
 * every other world's library.
 *
 * Retries exist for Windows: the world's server has been stopped, but the
 * system may not have released the files yet, and a single attempt would return
 * a folder that deletes itself a second later.
 */
export async function removeWorldDir(dir: string, dataDir: string): Promise<WorldDirOutcome> {
  const base = resolve(worldsDir(dataDir));
  const target = resolve(dir);
  if (!target.startsWith(base + sep)) return "outside";
  if (target === base) return "outside";

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await rm(target, { recursive: true, force: true });
      return "removed";
    } catch {
      if (attempt === 3) return "blocked";
      await new Promise((done) => setTimeout(done, 300 * (attempt + 1)));
    }
  }
  return "blocked";
}

export function registerWorldRoutes(app: FastifyInstance, scope: RouteScope): void {
  app.get("/api/worlds", async () => ({
    worlds: scope.worlds.list(),
    templates: scope.worlds.listTemplates().map((world) => ({
      id: world.id,
      name: world.name,
      slug: world.slug,
      description: world.description,
      templateAuthor: world.templateAuthor,
    })),
  }));

  app.get("/api/worlds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    return {
      world,
      bible: scope.worlds.getBible(id),
      eras: scope.worlds.listEras(id),
      arcs: scope.arcs.list(id),
      canonHealth: scope.canon.health(id),
    };
  });

  app.post("/api/worlds", async (request, reply) => {
    const body = CreateWorldBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));

    const { name, model, smallModel, reasoningEffort, baseLocale, description, fromTemplate } =
      body.data;

    if (fromTemplate !== undefined) {
      const source = scope.worlds.getBySlug(fromTemplate);
      if (!source) return reply.code(404).send(apiProblem("world.templateNotFound"));
      const clone = scope.worlds.clone(source.id, {
        name,
        slug: `${source.slug}-${Date.now().toString(36)}`,
        model,
        smallModel,
        reasoningEffort,
        baseLocale,
        opencodeDir: join(scope.roots.worlds, `${source.slug}-${Date.now().toString(36)}`),
      });
      if (description !== "") scope.worlds.update(clone.id, { description });
      return { world: scope.worlds.get(clone.id) };
    }

    const slug = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}-${Date.now().toString(36)}`;
    const world = scope.worlds.create({
      name,
      slug,
      model,
      smallModel,
      reasoningEffort,
      baseLocale,
      description,
      opencodeDir: join(scope.roots.worlds, slug),
    });
    return { world };
  });

  app.patch("/api/worlds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateWorldBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    const world = scope.worlds.update(id, body.data);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    return { world };
  });

  /**
   * Chooses how the campaign begins.
   *
   * Inside the chat, not at creation: the world is the setting and the start is the
   * way into it, so the choice belongs to the moment the player starts playing.
   * By then they can see the names of the scenarios, which is more than a creation
   * form could have shown them.
   *
   * The repository refuses a lore-only start and an id that is not in the list. Here
   * those become 400s with a code the interface can name, instead of a 500 with a
   * message that says what an exception said.
   */
  app.post("/api/worlds/:id/start", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));

    const body = SelectStartBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));

    try {
      const world = scope.worlds.selectStart(id, body.data.startId);
      if (!world) return reply.code(404).send(apiProblem("world.notFound"));
      return { world };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // The two refusals are separated because they are different mistakes: one is a
      // start the world does not have, the other is a start the player is not allowed
      // to begin. The interface names them differently.
      const lore = reason.includes("lore only");
      return reply
        .code(400)
        .send(apiProblem(lore ? "start.loreOnly" : "start.notFound", { detail: reason }));
    }
  });

  app.delete("/api/worlds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));

    // The server stops **before** touching disk. On Windows a process
    // holding open files inside the folder keeps them, and deletion
    // fails with an error that looks like permissions but is a still-open file.
    await scope.bridge?.stopServer(world.opencodeDir).catch(() => undefined);

    /*
     * The folder goes first, and the row second.
     *
     * The other order is what this used to do, and it produced a world that
     * could not be deleted twice: the row went away, the folder survived because
     * Windows still had a file open, the route answered `ok` without mentioning
     * it, and every later attempt came back "World not found" — while an
     * invisible folder kept taking up space in the data directory.
     *
     * Failing here instead is the better half-written state: the world is still
     * listed, still deletable, and the message says which folder is in the way
     * so the file holding it can be closed and the attempt repeated.
     */
    const outcome = await removeWorldDir(world.opencodeDir, scope.dataDir);
    if (outcome === "blocked") {
      return reply.code(409).send(apiProblem("world.deleteBlocked", { path: world.opencodeDir }));
    }

    // `delete` cascades in the database. A folder that was "outside" was never
    // ours to remove, so it must not stop the delete; "removed" means there is
    // nothing left on disk to point at.
    if (!scope.worlds.delete(id)) return reply.code(404).send(apiProblem("world.notFound"));

    return { ok: true, directoryRemoved: outcome === "removed" };
  });

  // --- bible, eras, arcs ------------------------------------------------

  app.put("/api/worlds/:id/bible", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = BibleBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));
    scope.worlds.setBibleSection(id, body.data.section, body.data.body);
    return { bible: scope.worlds.getBible(id), sections: BIBLE_SECTIONS };
  });

  app.put("/api/worlds/:id/eras", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!Array.isArray(request.body)) return reply.code(400).send(apiProblem("body.expectedList"));
    const parsed = EraBody.array().safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: parsed.error.issues[0]?.message ?? "" }));
    scope.worlds.replaceEras(id, parsed.data);
    return { eras: scope.worlds.listEras(id) };
  });

  /**
   * Campaign export: everything that makes it reproducible.
   * No account, no upload to a service: it is a file the user
   * keeps wherever they want, and it stays theirs.
   */
  app.get("/api/worlds/:id/export", async (request, reply) => {
    const { id } = request.params as { id: string };
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    /*
     * The section list is the same thing import knows how to bring back, and it is the
     * spot where a backup stayed wrong for months: export
     * wrote nine sections and import read five. A file exported from an older
     * version still imports, because missing fields are
     * treated as absent.
     */
    return {
      format: "rpwb-campaign",
      version: 1,
      exportedAt: new Date().toISOString(),
      world,
      bible: scope.worlds.getBible(id),
      eras: scope.worlds.listEras(id),
      arcs: scope.arcs.list(id),
      chapters: scope.chapters.list(id),
      characters: scope.cast.listCharacters(id),
      locations: scope.cast.listLocations(id),
      relationships: scope.cast.listRelationships(id),
      /*
       * `listAll` and not `list`: `list` keeps only the active era's entries, and
       * exporting those would make the copy lose part of the canon with nothing
       * reporting it. Including `disputed` and `non_canon`: they are the player's choices, and
       * a copy that drops them works with a different canon.
       */
      canon: scope.canon.listAll(id),
      canonEdits: scope.canon.listEdits(id, 200),
    };
  });

  app.post("/api/import", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    if (typeof body !== "object" || body === null || body["format"] !== "rpwb-campaign") {
      return reply.code(400).send(apiProblem("import.unrecognizedFile"));
    }
    const source = body["world"] as Record<string, unknown> | undefined;
    if (!source) return reply.code(400).send(apiProblem("import.noWorld"));

    const name = String(source["name"] ?? "Imported campaign");
    const slug = `${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}-${Date.now().toString(36)}`;

    /*
     * All of the world's settings are carried over, not just model and name.
     * The previous version copied three of them and left the rest at default
     * values: an imported campaign could then write in a different language
     * than the one it was played in, with different reasoning power,
     * and above all **without the required libraries**. The copy's narrator
     * would have worked with a different canon than the original's, and nobody
     * would have had a reason to notice.
     *
     * The model is the creator's, and the creator's is the player's: whoever
     * brought the campaign in is the one who chose the model that wrote it, and
     * that choice travels with the file. There is no fallback here on purpose.
     * There was `opencode/space-bunny-free`, and it was worse than a default
     * because it was a *silent* one: a campaign came in, the narrator was
     * already a different model from the one the file was written with, the
     * chapter checks ran on a different one again, and the only visible trace
     * was a line of explanatory text in a settings panel. A missing field falls
     * back to what the importer prefers and stays visible; a made-up model
     * quietly changes who is writing.
     */
    const inherited = String(source["model"] ?? "");
    if (inherited === "") {
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: "the campaign has no model" }));
    }
    const world = scope.worlds.create({
      name,
      slug,
      model: inherited,
      smallModel: String(source["smallModel"] ?? inherited),
      baseLocale: String(source["baseLocale"] ?? "it"),
      description: String(source["description"] ?? ""),
      opencodeDir: join(scope.roots.worlds, slug),
      libraries: Array.isArray(source["libraries"]) ? (source["libraries"] as never[]) : [],
    });

    // Settings that `create` does not take are carried over right after: the world
    // must immediately have the original's values, not defaults until the first
    // save.
    scope.worlds.update(world.id, {
      player: (source["player"] as World["player"]) ?? undefined,
      activeLocale: String(source["activeLocale"] ?? source["baseLocale"] ?? "it"),
      reasoningEffort: (REASONING_EFFORTS.includes(source["reasoningEffort"] as ReasoningEffort)
        ? source["reasoningEffort"]
        : "default") as ReasoningEffort,
      chapterThresholdRatio: Number(source["chapterThresholdRatio"] ?? 0.6),
      canonBudgetRatio: Number(source["canonBudgetRatio"] ?? 0.25),
      opencodeSessionId: null,
    });
    // `kept_messages` is not among `World`'s fields: it has a dedicated method.
    scope.worlds.setKeptMessages(world.id, -1);

    const bible = body["bible"] as Record<string, string> | undefined;
    if (bible) {
      for (const section of BIBLE_SECTIONS) {
        scope.worlds.setBibleSection(world.id, section, bible[section] ?? "");
      }
    }

    // Eras before cast: places and characters carry the era's name,
    // and without the row to hook onto the link is not recreated.
    const eras = (body["eras"] as Era[] | undefined) ?? [];
    if (eras.length > 0) {
      scope.worlds.replaceEras(
        world.id,
        eras.map((era) => ({
          key: String(era["key"] ?? "era"),
          label: String(era["label"] ?? "Era"),
          startYear: era["startYear"] === null ? undefined : Number(era["startYear"] ?? 0),
          endYear: era["endYear"] === null ? undefined : Number(era["endYear"] ?? 0),
          summary: String(era["summary"] ?? ""),
        })),
      );
    }

    /*
     * Places and characters have their own ids, and relationships point at them by id.
     * Copying without accounting for that would produce relationships pointing to
     * nonexistent characters, which the database constraint rejects: import would fail for
     * a file that is perfectly valid. So an
     * old id -> new id map is kept and every reference is rewritten.
     */
    const newPlaces = new Map<string, string>();
    for (const location of (body["locations"] as Location[] | undefined) ?? []) {
      const createdPlace = scope.cast.addLocation(world.id, {
        name: String(location["name"] ?? "Location"),
        description: String(location["description"] ?? ""),
        parentId: null,
        aliases: Array.isArray(location["aliases"]) ? location["aliases"] : [],
        era: String(location["era"] ?? "any"),
      });
      if (typeof location["id"] === "string") newPlaces.set(location["id"], createdPlace.id);
    }
    // The place-to-parent-place link is restored later, once all new ids
    // exist: reading it during insertion would give a not-yet-valid `parentId`.
    for (const location of (body["locations"] as Location[] | undefined) ?? []) {
      const createdPlaceId = newPlaces.get(location["id"]);
      const parent = location["parentId"];
      if (createdPlaceId !== undefined && typeof parent === "string") {
        scope.cast.reparentLocation(world.id, createdPlaceId, newPlaces.get(parent) ?? null);
      }
    }

    const newPeople = new Map<string, string>();
    for (const character of (body["characters"] as Character[] | undefined) ?? []) {
      const createdCharacter = scope.cast.addCharacter(world.id, {
        name: String(character["name"] ?? "Character"),
        role: String(character["role"] ?? ""),
        description: String(character["description"] ?? ""),
        personality: String(character["personality"] ?? ""),
        secret: String(character["secret"] ?? ""),
        status: String(character["status"] ?? ""),
        locationId:
          typeof character["locationId"] === "string"
            ? (newPlaces.get(character["locationId"]) ?? null)
            : null,
        isPlayer: character["isPlayer"] === true,
        canonical: character["canonical"] !== false,
        era: String(character["era"] ?? "any"),
      });
      if (typeof character["id"] === "string") newPeople.set(character["id"], createdCharacter.id);
    }

    for (const relationship of (body["relationships"] as Relationship[] | undefined) ?? []) {
      const from = newPeople.get(relationship["fromCharacterId"]);
      const to = newPeople.get(relationship["toCharacterId"]);
      // A relationship without both characters is skipped, not failed: if
      // a file lost a character, importing everything else is better.
      if (!from || !to) continue;
      try {
        scope.cast.setRelationship(world.id, {
          worldId: world.id,
          fromCharacterId: from,
          toCharacterId: to,
          affinity: Number(relationship["affinity"] ?? 0),
          trust: Number(relationship["trust"] ?? 0),
          note: String(relationship["note"] ?? ""),
        });
      } catch {
        // Same reason as above: the canon is imported anyway.
      }
    }

    const entries = (body["canon"] as CanonEntry[] | undefined) ?? [];
    if (entries.length > 0) {
      /*
       * Every entry gets a new id. `upsertMany` does not generate them and uses the
       * received value: passing the original's id would reuse the same id in the
       * copy, and a correction made on one of the two would touch the other with
       * nothing reporting it. With an empty string, instead, the second entry
       * would collide with the first and the whole import would fail on a valid file.
       */
      scope.canon.upsertMany(
        entries.map((entry) => ({ ...entry, worldId: world.id, id: newId() })),
      );
    }

    const importedArcs =
      (body["arcs"] as
        | (ReturnType<ArcRepository["list"]>[number] & { chapters?: { n: number }[] })[]
        | undefined) ?? [];
    for (const arc of importedArcs) {
      const createdArc = scope.arcs.create(world.id, {
        title: String(arc["title"] ?? "Arc"),
        logline: typeof arc["logline"] === "string" ? arc["logline"] : "",
        firstChapter: Number(arc["firstChapter"] ?? 1),
      });
      for (const chapter of (arc["chapters"] as { n: number }[] | undefined) ?? []) {
        scope.arcs.attachChapter(createdArc.id, Number(chapter["n"] ?? 0));
      }
      if (typeof arc["spine"] === "string" && arc["spine"] !== "") {
        scope.arcs.setSpine(createdArc.id, arc["spine"]);
      }
    }

    const corrections =
      (body["canonEdits"] as
        | { entryId: string; subject: string; fields: string; reason: string; createdAt: string }[]
        | undefined) ?? [];
    for (const correction of corrections) {
      scope.canon.addEdit({
        worldId: world.id,
        entryId: String(correction["entryId"] ?? ""),
        subject: String(correction["subject"] ?? ""),
        fields: String(correction["fields"] ?? ""),
        beforeValue: "",
        afterValue: "",
        reason: String(correction["reason"] ?? ""),
      });
    }

    return { world: scope.worlds.get(world.id) };
  });

  app.post("/api/corpus/load", async (_request, reply) => {
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));
    try {
      const model = defaultNarratorModel(
        await readModelCatalog(scope.bridge.clientFor(scope.dataDir)),
      );
      const loaded = await loadCorpus(scope.db, {
        root: scope.roots.corpus,
        loreRoot: scope.roots.lore,
        model,
        smallModel: model,
        reasoningEffort: "default",
        worldsDir: scope.roots.worlds,
      });
      return { loaded: loaded.map((entry) => ({ slug: entry.slug, entries: entry.entries })) };
    } catch (error) {
      return reply.code(400).send(
        apiProblem("server.unexpected", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
}
