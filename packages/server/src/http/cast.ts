/**
 * A world's cast: characters, places, relationships, and promotions.
 *
 * The world's vocabulary lives here next to the routes that use it: it is the only
 * source that knows whether a name is a place or a person, and keeping it close to
 * those who ask prevents classification and routes from diverging.
 */

import { apiProblem } from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { buildLexicon, decidePromotion, type LexiconTerm } from "../canon/lexicon.js";
import { CastScopeError, LocationParentError } from "../db/repo/cast.js";
import {
  CharacterBody,
  LocationBody,
  PromoteBody,
  RelationshipBody,
  RelationshipDeleteBody,
} from "./schema.js";
import type { RouteScope } from "./scope.js";

export function registerCastRoutes(app: FastifyInstance, scope: RouteScope): void {
  // --- cast ----------------------------------------------------------------

  app.get("/api/worlds/:id/characters", async (request) => {
    const { id } = request.params as { id: string };
    return { characters: scope.cast.listCharacters(id) };
  });

  app.post("/api/worlds/:id/characters", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = CharacterBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    return { character: scope.cast.addCharacter(id, body.data) };
  });

  app.patch("/api/worlds/:id/characters/:cid", async (request, reply) => {
    const { id, cid } = request.params as { id: string; cid: string };
    const body = CharacterBody.partial().safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    const character = scope.cast.updateCharacter(id, cid, body.data);
    if (!character) return reply.code(404).send(apiProblem("cast.characterNotFound"));
    return { character };
  });

  app.delete("/api/worlds/:id/characters/:cid", async (request, reply) => {
    const { id, cid } = request.params as { id: string; cid: string };
    if (!scope.cast.deleteCharacter(id, cid))
      return reply.code(404).send(apiProblem("cast.characterNotFound"));
    return { ok: true };
  });

  /**
   * The world's vocabulary, with the same rules used to read the narrator:
   * it is the only source that knows whether a name is a place or a person.
   *
   * Canon entries come in with their kind, because the corpus also brings
   * "Flatwoods Lookout", which is a place without yet being a `locations` row:
   * without the kind the classification would only say "it is in the
   * canon", which is not enough to refuse promotion to character.
   *
   * `listAll` and not `list`: `list` keeps only the active era's entries, so
   * a place known in another era would pass as unknown and
   * become a character. Classification is about what the name is, not
   * what holds now.
   */
  const lexiconOf = (scope: RouteScope, worldId: string): Map<string, LexiconTerm> =>
    buildLexicon({
      canonSubjects: scope.canon.listAll(worldId).map((entry) => ({
        id: entry.id,
        subject: entry.subject,
        aliases: entry.aliases,
        kind: entry.kind,
      })),
      characters: scope.cast.listCharacters(worldId).map((character) => ({
        id: character.id,
        name: character.name,
      })),
      locations: scope.cast.listLocations(worldId).map((location) => ({
        id: location.id,
        name: location.name,
        aliases: location.aliases,
      })),
    });

  /**
   * Promote to canon a name the narrator mentioned that the player
   * wants to keep. It is the only way the database grows during a
   * game, and it is always explicit.
   *
   * The lexicon classification is a filter, not a hint: the kind
   * requested by whoever promotes is compared against the kind the world knows, and if
   * they do not match the request is rejected. This exists because the real case happened
   * and the default did not stop it: "Flatwoods", which is a place, ended up among
   * characters together with "Michael", who is a person. From that moment the state
   * card looks for it among people and the narrator cites it as a person.
   */
  app.post("/api/worlds/:id/promote", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = PromoteBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));

    const input = body.data;

    // The comparison happens here and not only in the schema: a schema with a default
    // always accepts, so a wrong default causes damage and then fixes itself.
    // The rejection also carries the right kind, so whoever pressed can
    // retry with it without guessing.
    const verdict = decidePromotion(input.name, input.kind, lexiconOf(scope, id));
    if (!verdict.ok) {
      return reply.code(409).send({
        ...apiProblem("body.invalid", { detail: verdict.problem }),
        expected: verdict.expected,
      });
    }

    // "faction" and "item" are names the lexicon can recognize, but they have no
    // table to be written to. The previous default silently turned them into
    // characters, exactly the wrong entity this
    // endpoint was fixed to stop creating: here it says it cannot be done.
    if (input.kind !== "character" && input.kind !== "location") {
      return reply.code(400).send(apiProblem("cast.kindNotCreatable", { kind: input.kind }));
    }

    if (input.kind === "location") {
      return {
        promoted: scope.cast.addLocation(id, {
          name: input.name,
          description: input.description,
          parentId: input.locationId,
          aliases: [],
          era: input.era,
        }),
        kind: "location",
      };
    }

    const character = scope.cast.addCharacter(id, {
      name: input.name,
      role: input.role,
      description: input.description,
      personality: input.personality,
      secret: "",
      status: "",
      locationId: input.locationId,
      isPlayer: false,
      canonical: true,
      era: input.era,
    });
    return { promoted: character, kind: "character" };
  });

  app.get("/api/worlds/:id/locations", async (request) => {
    const { id } = request.params as { id: string };
    return { locations: scope.cast.listLocations(id) };
  });

  app.post("/api/worlds/:id/locations", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = LocationBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    return { location: scope.cast.addLocation(id, body.data) };
  });

  app.patch("/api/worlds/:id/locations/:lid", async (request, reply) => {
    const { id, lid } = request.params as { id: string; lid: string };
    const body = LocationBody.partial().safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    try {
      const location = scope.cast.updateLocation(id, lid, body.data);
      if (!location) return reply.code(404).send(apiProblem("cast.locationNotFound"));
      return { location };
    } catch (error) {
      if (!(error instanceof LocationParentError)) throw error;
      return reply.code(400).send(apiProblem(error.code));
    }
  });

  app.delete("/api/worlds/:id/locations/:lid", async (request, reply) => {
    const { id, lid } = request.params as { id: string; lid: string };
    /*
     * Characters in the place and children stay in place by construction: the
     * foreign key sets them to `NULL`, it does not delete them. Deleting a place never
     * deletes people, only geography.
     */
    if (!scope.cast.deleteLocation(id, lid))
      return reply.code(404).send(apiProblem("cast.locationNotFound"));
    return { ok: true };
  });

  app.get("/api/worlds/:id/relationships", async (request) => {
    const { id } = request.params as { id: string };
    return { relationships: scope.cast.listRelationships(id) };
  });

  app.post("/api/worlds/:id/relationships", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = RelationshipBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    try {
      return { relationship: scope.cast.setRelationship(id, { worldId: id, ...body.data }) };
    } catch (error) {
      if (!(error instanceof CastScopeError)) throw error;
      return reply.code(400).send(apiProblem("cast.characterOtherWorld", { role: error.role }));
    }
  });

  app.delete("/api/worlds/:id/relationships", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = RelationshipDeleteBody.safeParse(request.body ?? {});
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    if (!scope.cast.deleteRelationship(id, body.data.fromCharacterId, body.data.toCharacterId))
      return reply.code(404).send(apiProblem("cast.relationshipNotFound"));
    return { ok: true };
  });
}
