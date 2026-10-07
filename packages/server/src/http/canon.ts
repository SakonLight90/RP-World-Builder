/*
 * A world's canon: reading, searching, correcting, and history.
 *
 * Correcting and reading stay together because the correction route completes the existing
 * entry, and splitting them would hide that dependency.
 */

import { apiProblem, type CanonEntry } from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { CanonDeleteBody, CanonEditBody } from "./schema.js";
import type { RouteScope } from "./scope.js";

export function registerCanonRoutes(app: FastifyInstance, scope: RouteScope): void {
  // --- canon --------------------------------------------------------------

  app.get("/api/worlds/:id/canon", async (request) => {
    const { id } = request.params as { id: string };
    return {
      entries: scope.canon.list({ worldId: id, activeEras: [], includeDisputed: true }),
      health: scope.canon.health(id),
    };
  });

  app.get("/api/worlds/:id/canon/search", async (request) => {
    const { id } = request.params as { id: string };
    const query = (request.query as { q?: string }).q ?? "";
    if (query.trim() === "") return { results: [] };
    return {
      results: scope.canon.search({
        worldId: id,
        activeEras: [],
        includeDisputed: true,
        text: query,
        limit: 30,
      }),
    };
  });

  /**
   * Everything about a world that a name could refer to, in one answer.
   *
   * Each part searches what a reader would search: the canon by any word, the cast and the
   * places by name, role, description and aliases, the campaigns by name. The parts are
   * capped separately so one cannot crowd out the others, and the order is fixed: canon
   * first, because a canon entry carries facts and a campaign name is a navigation target.
   */
  app.get("/api/worlds/:id/search", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = (request.query as { q?: string }).q ?? "";
    const needle = query.trim();
    if (needle === "") return { canon: [], characters: [], locations: [] };

    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));

    // A campaign has only a name: a substring test, so "Fall" finds both Fallout worlds.
    const campaigns = scope.worlds
      .list()
      .filter((world) => world.name.toLowerCase().includes(needle.toLowerCase()))
      .slice(0, 5);

    return {
      canon: scope.canon.search({
        worldId: id,
        activeEras: [],
        includeDisputed: true,
        text: needle,
        limit: 10,
      }),
      characters: scope.cast.searchCharacters(id, needle, 10),
      locations: scope.cast.searchLocations(id, needle, 10),
      campaigns,
    };
  });

  /* --- canon editing --- */

  app.patch("/api/worlds/:id/canon/:entryId", async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };
    const body = CanonEditBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    const existing = scope.canon.get(id, entryId);
    if (!existing) return reply.code(404).send(apiProblem("canon.entryNotFound"));

    // Every correction leaves a trace: the audit records the new value next to the old one.
    const fields = body.data;
    const reasonBody = request.body as { reason?: unknown };
    const reason = typeof reasonBody.reason === "string" ? reasonBody.reason.slice(0, 1000) : "";
    const after = { ...existing, ...fields };

    // Recorded in `canon_edits` and not in the reviewer audit, which holds the model's verdicts
    // on a chapter's claims: a hand-made correction is not a verdict.
    scope.canon.addEdit({
      worldId: id,
      entryId,
      subject: after.subject,
      fields: Object.keys(fields).sort().join(", ") || "(no changes)",
      beforeValue: JSON.stringify(existing),
      afterValue: JSON.stringify(after),
      reason,
    });

    const written = scope.canon.update(id, entryId, after) ? 1 : 0;
    return { entry: scope.canon.get(id, entryId), written: written };
  });

  app.delete("/api/worlds/:id/canon/:entryId", async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };
    const existing = scope.canon.get(id, entryId);
    if (!existing) return reply.code(404).send(apiProblem("canon.entryNotFound"));

    const reasonResult = CanonDeleteBody.safeParse(request.body ?? {});
    const reason = reasonResult.success ? reasonResult.data.reason : "";
    scope.canon.addEdit({
      worldId: id,
      entryId,
      subject: existing.subject,
      fields: "(whole entry removed)",
      beforeValue: JSON.stringify(existing),
      afterValue: "null",
      reason,
    });

    return { removed: scope.canon.remove(id, entryId) };
  });

  app.post("/api/worlds/:id/canon/:entryId/undo", async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };
    if (!scope.canon.get(id, entryId))
      return reply.code(404).send(apiProblem("canon.entryNotFound"));

    /*
     * Undo restores a recorded "before" through the same `update` the correction used: one
     * code path writes canon, so an undo cannot produce a state the editor could not.
     *
     * The reversal is itself recorded, with what is on disk now as `beforeValue`, so the
     * trail stays symmetric.
     */
    const last = scope.canon
      .listEdits(id, 500)
      .find((edit) => edit.entryId === entryId && edit.afterValue !== "null");

    // Nothing to undo is not a failure: the entry is brand new or already rolled back, and the
    // caller wanted the entry it can already read.
    if (last === undefined) return { undone: false, entry: scope.canon.get(id, entryId) };

    let restored: CanonEntry;
    try {
      restored = JSON.parse(last.beforeValue) as CanonEntry;
    } catch {
      // A corrupted record must not stop the reader.
      return { undone: false, entry: scope.canon.get(id, entryId) };
    }

    const current = scope.canon.get(id, entryId);
    if (current === null) return reply.code(404).send(apiProblem("canon.entryNotFound"));

    scope.canon.addEdit({
      worldId: id,
      entryId,
      subject: restored.subject,
      fields: Object.keys(restored).sort().join(", ") || "(no changes)",
      beforeValue: JSON.stringify(current),
      afterValue: JSON.stringify(restored),
      reason: "",
    });

    return { undone: true, entry: scope.canon.update(id, entryId, restored) };
  });

  app.get("/api/worlds/:id/canon/edits", async (request) => {
    const { id } = request.params as { id: string };
    // `Number("")` is 0, not NaN: without this check an empty limit became 1 and the route
    // returned a single correction while looking like a full list.
    const query = (request.query as { q?: string }).q ?? "";
    const requested = Number(query);
    const limit = query.trim() !== "" && Number.isFinite(requested) ? requested : null;
    return {
      edits:
        limit === null
          ? scope.canon.listEdits(id)
          : scope.canon.listEdits(id, Math.max(1, Math.min(500, limit))),
    };
  });
}
