/**
 * A world's canon: reading, searching, correcting, and history.
 *
 * Correcting and reading stay together because the correction route completes the
 * existing entry: splitting them into two different files would hide the fact that one
 * depends on the shape of the other.
 */

import { apiProblem } from "@rpwb/shared";
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

  /*
   * Canon editing.
   *
   * Reading existed but writing did not: `CanonRepository` already had `get`,
   * `remove`, `addAudit` and `listAudit`, and no route called them. The result
   * was that the canonicity audit was written to the database and unreachable,
   * and that a wrong canon fact could not be corrected anywhere:
   * you could only reset the campaign.
   */

  app.patch("/api/worlds/:id/canon/:entryId", async (request, reply) => {
    const { id, entryId } = request.params as { id: string; entryId: string };
    const body = CanonEditBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    const existing = scope.canon.get(id, entryId);
    if (!existing) return reply.code(404).send(apiProblem("canon.entryNotFound"));

    /*
     * Every correction leaves a trace. This is not a detail: `status` is
     * "disputed", and without knowing *who* decided what and *why*, a hand-corrected
     * canon and a wrong canon become indistinguishable to someone
     * reading the campaign six months later. The audit records the new value next to the
     * old one, not the new one alone.
     */
    const fields = body.data;
    const reasonBody = request.body as { reason?: unknown };
    const reason = typeof reasonBody.reason === "string" ? reasonBody.reason.slice(0, 1000) : "";
    const after = { ...existing, ...fields };

    /*
     * The correction stays in `canon_edits` and not in the reviewer audit: that one
     * records the model's verdicts on a chapter's claims, and a
     * hand-made correction is not a verdict. Mixing them would make it impossible
     * to ask how many facts were verified and how many were changed.
     */
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

  app.get("/api/worlds/:id/canon/edits", async (request) => {
    const { id } = request.params as { id: string };
    /*
     * `Number("")` is 0 and not NaN: without this check the empty string
     * became a zero limit, `Math.max` raised it to one, and the route
     * always returned a single correction. It looked like a full list and was not,
     * which is the worst way a list can lie.
     */
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
