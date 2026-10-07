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
import { errorDetail, log } from "../logging.js";
import { defaultNarratorModel, readModelCatalog } from "../opencode/models.js";
import { BibleBody, CreateWorldBody, EraBody, SelectStartBody, UpdateWorldBody } from "./schema.js";
import type { RouteScope } from "./scope.js";

/**
 * What happened to a world's folder.
 *
 * `outside` is the path check refusing a folder that is not ours: the world is still
 * deleted, because refusing it would leave one that can never be removed. `blocked`
 * is a folder of ours that Windows still holds: the delete stops, because going
 * ahead leaves a folder no list will show again.
 */
export type WorldDirOutcome = "removed" | "outside" | "blocked";

/**
 * Deletes a world's folder, nothing else.
 *
 * The path check is required: `opencodeDir` comes from the database and `rm` is
 * recursive, and the root itself is refused so a world pointing at the data folder
 * cannot wipe every other world.
 *
 * Retried: on Windows the server is stopped but the files may not be released yet.
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

  /*
   * Chooses how the campaign begins.
   *
   * The two refusals become 400s with a code the interface can name: a lore-only start
   * and a start the world does not have are different sentences.
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
      // The two refusals are different mistakes and get different codes.
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

    // Stopped before touching disk: on Windows a process holding a file in the
    // folder keeps it, and the delete fails looking like a permissions problem.
    await scope.bridge?.stopServer(world.opencodeDir).catch(() => undefined);

    /*
     * Folder first, row second.
     *
     * The other order deletes the row while Windows still holds a file, and the world
     * can then never be deleted twice: every later attempt answers "not found" while
     * an invisible folder stays on disk. Failing here leaves the world listed and
     * deletable, and names the folder in the way.
     */
    const outcome = await removeWorldDir(world.opencodeDir, scope.dataDir);
    if (outcome === "blocked") {
      return reply.code(409).send(apiProblem("world.deleteBlocked", { path: world.opencodeDir }));
    }

    // `outside` was never ours to remove, so it does not stop the delete.
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

  /** Campaign export: everything that makes it reproducible. A file the user keeps. */
  app.get("/api/worlds/:id/export", async (request, reply) => {
    const { id } = request.params as { id: string };
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    /* Every section import can bring back, so a file from an older version
       still imports: a missing field is read as absent. */
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
      /* `listAll`, not `list`, which keeps only the active era. `disputed` and
       `non_canon` are included: they are the player's choices. */
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
     * Every setting is carried over, and the model above all: the file was written
     * with it, and substituting another changes who is writing without saying so. A
     * missing model is refused rather than defaulted.
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

    // Settings `create` does not take are applied right after, so the world
    // starts with the original's values.
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

    // Eras before cast: places and characters carry the era's key.
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
     * Places and characters get new ids and every reference is rewritten:
     * relationships point at character ids, and an id reused in the copy would make a
     * correction on one of the two touch the other.
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
    // The parent link is restored once all ids exist: reading it during
    // insertion would give a not-yet-valid `parentId`.
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
      // A relationship missing a character is skipped: importing the rest
      // is better than failing on a file that lost one.
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
        // Same: the canon is imported anyway.
      }
    }

    const entries = (body["canon"] as CanonEntry[] | undefined) ?? [];
    if (entries.length > 0) {
      /*
       * Every entry gets a new id: `upsertMany` uses the received value, so reusing
       * the original's would tie the two copies together, and an empty string would
       * make the second entry collide with the first.
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
      // The usual failure is a blocking problem in a template file, and it names no
      // world: the log does, or "validation failed" is not actionable.
      log.error("corpus.load.failed", { reason: errorDetail(error) });
      return reply.code(400).send(
        apiProblem("server.unexpected", {
          reason: errorDetail(error) ?? "unknown error",
        }),
      );
    }
  });
}
