/*
 * HTTP route composition: each domain registers its own, only the order and shared
 * dependencies are decided here.
 *
 * Cross-cutting only: the check that the world exists, and the re-export of
 * `removeWorldDir` that tests use from here.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import { apiProblem } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import type { ProjectRoots } from "../config/paths.js";
import { registerCanonRoutes } from "./canon.js";
import { registerCastRoutes } from "./cast.js";
import { createScope } from "./scope.js";
import { registerStoryRoutes } from "./story.js";
import { registerSystemRoutes } from "./system.js";
import { registerTurnRoutes } from "./turns.js";
import { registerWorldRoutes, removeWorldDir } from "./worlds.js";

export interface RouteDeps {
  db: Database;
  /**
   * Project roots, resolved by `createApp`.
   *
   * Travelled here and not derived inside routes: a route recomputing the corpus root
   * would work from one folder and fail from another.
   */
  roots: ProjectRoots;
  /** Bridge to opencode. When absent, endpoints requiring it answer 503. */
  bridge: {
    /**
     * Starts that directory's opencode server if needed.
     * Always use it instead of `clientFor` for a world: the wrong client fails later
     * and namelessly.
     */
    ensureServer(directory: string): Promise<OpencodeClient>;
    clientFor(directory: string): OpencodeClient;
    /**
     * Stops that directory's server. Needed before removing the folder: on Windows a
     * file open in the process blocks deletion.
     */
    stopServer(directory: string): Promise<void>;
  } | null;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const scope = createScope(deps.db, deps.roots, deps.bridge);

  /*
   * A missing world is one condition, not eleven: without this check every writing
   * route ends in SQLITE_CONSTRAINT_FOREIGNKEY and answers 500 with the wrong cause.
   *
   * Here and not in every route, because a check repeated 11 times is missing the
   * twelfth. Creation goes through /api/worlds without :id.
   */
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/worlds/")) return;
    const { id } = request.params as { id?: unknown };
    if (typeof id !== "string" || id === "") return;
    if (!scope.worlds.get(id)) {
      // `apiProblem`, like every other route: two different shapes for the same
      // error would force the frontend to guess which one to read.
      return reply.code(404).send(apiProblem("world.notFound"));
    }
  });

  // The order is the old one: worlds, story, cast, canon, turns, system.
  // No routes overlap, but keeping it equal removes one reason
  // to wonder whether the split changed anything.
  registerWorldRoutes(app, scope);
  registerStoryRoutes(app, scope);
  registerCastRoutes(app, scope);
  registerCanonRoutes(app, scope);
  registerTurnRoutes(app, scope);
  registerSystemRoutes(app, scope);
}

export { removeWorldDir };
