/*
 * A world's story: arcs and chapters.
 *
 * Arcs are the containers, chapters the content.
 */

import { readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { apiProblem } from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { ArcBody, ArcCloseBody } from "./schema.js";
import type { RouteScope } from "./scope.js";

export function registerStoryRoutes(app: FastifyInstance, scope: RouteScope): void {
  /**
   * A chapter file's path, only inside the world's folder.
   *
   * The path lives in the database and is read from disk here: a stale one would lead
   * outside the folder.
   */
  function chapterFile(worldDir: string, relative: string): string | null {
    const base = resolve(worldDir);
    const target = resolve(base, relative);
    if (target !== base && !target.startsWith(base + sep)) return null;
    return target;
  }

  /** A chapter's text, or `null` if the file is gone. */
  async function readChapterText(worldDir: string, relative: string): Promise<string | null> {
    const target = chapterFile(worldDir, relative);
    if (target === null) return null;
    try {
      return await readFile(target, "utf8");
    } catch {
      return null;
    }
  }

  /** Removes a chapter's file, without failing if it is already gone. */
  async function removeChapterFile(worldDir: string, relative: string): Promise<void> {
    const target = chapterFile(worldDir, relative);
    if (target === null) return;
    await rm(target, { force: true }).catch(() => undefined);
  }

  app.get("/api/worlds/:id/arcs", async (request) => {
    const { id } = request.params as { id: string };
    return {
      arcs: scope.arcs.list(id).map((arc) => ({
        ...arc,
        chapters: scope.arcs.chaptersIn(arc.id),
        remaining: scope.arcs.remainingCapacity(arc.id),
      })),
    };
  });

  app.post("/api/worlds/:id/arcs", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ArcBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    return { arc: scope.arcs.create(id, body.data) };
  });

  app.post("/api/worlds/:id/arcs/:arcId/close", async (request, reply) => {
    const { id, arcId } = request.params as { id: string; arcId: string };
    const body = ArcCloseBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    const arc = scope.arcs.get(arcId);
    if (!arc || arc.worldId !== id) return reply.code(404).send(apiProblem("arc.notFound"));
    if (arc.status === "closed") return reply.code(409).send(apiProblem("arc.alreadyClosed"));
    return { arc: scope.arcs.close(arcId, body.data) };
  });

  app.delete("/api/worlds/:id/arcs/:arcId", async (request, reply) => {
    const { id, arcId } = request.params as { id: string; arcId: string };
    const query = (request.query as { force?: string }).force ?? "";
    const arc = scope.arcs.get(arcId);
    if (!arc || arc.worldId !== id) return reply.code(404).send(apiProblem("arc.notFound"));
    /*
     * Without `force`, an arc containing chapters is left alone: deleting it
     * would detach the chapters silently and the arc's range would vanish with
     * them. With `force` the chapters stay in the world without an arc, and that is stated in the
     * confirmation because that is what really happens.
     */
    const chapters = scope.arcs.chaptersIn(arcId);
    if (chapters.length > 0 && query !== "true") {
      return reply.code(409).send({
        ...apiProblem("arc.hasChapters", { count: chapters.length }),
        chapters: chapters.length,
      });
    }
    return { removed: scope.arcs.remove(id, arcId) };
  });

  // --- chapters, context, turns -------------------------------------------

  app.get("/api/worlds/:id/chapters", async (request) => {
    const { id } = request.params as { id: string };
    return { chapters: scope.chapters.list(id) };
  });

  app.get("/api/worlds/:id/chapters/:n", async (request, reply) => {
    const { id, n } = request.params as { id: string; n: string };
    const chapterNumber = Number.parseInt(n, 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1)
      return reply.code(400).send(apiProblem("chapter.invalidNumber"));
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    const chapter = scope.chapters.get(id, chapterNumber);
    if (!chapter) return reply.code(404).send(apiProblem("chapter.notFound"));
    return { chapter, text: await readChapterText(world.opencodeDir, chapter.path) };
  });

  app.delete("/api/worlds/:id/chapters/:n", async (request, reply) => {
    const { id, n } = request.params as { id: string; n: string };
    const chapterNumber = Number.parseInt(n, 10);
    if (!Number.isInteger(chapterNumber) || chapterNumber < 1)
      return reply.code(400).send(apiProblem("chapter.invalidNumber"));
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    const chapter = scope.chapters.get(id, chapterNumber);
    if (!chapter) return reply.code(404).send(apiProblem("chapter.notFound"));

    /*
     * The row and the file go away together: one without the other is a ghost
     * chapter, either in the list or on disk. And the arc's range is
     * realigned, because "chapters 3–10" with 5 removed by hand is a number that
     * lies.
     */
    await removeChapterFile(world.opencodeDir, chapter.path);
    scope.chapters.remove(id, chapterNumber);
    if (chapter.arcId !== null) scope.arcs.refreshRange(chapter.arcId);
    return { ok: true };
  });
}
