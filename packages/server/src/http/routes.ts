/**
 * HTTP route composition: each domain registers its own, only the
 * order and shared dependencies are decided here.
 *
 * Everything lived in this file — 1600 lines with every route and helper — and the
 * result was that touching turns also meant passing through canon. Now
 * each domain lives in its own module (`worlds`, `story`, `cast`, `canon`, `turns`,
 * `system`) and only what is truly cross-cutting stays here: the check that the
 * world exists and the re-export of `removeWorldDir`, which tests use from here.
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
   * They travel here and are not derived inside routes: a route recomputing
   * the corpus root on every request would work from one folder and
   * fail from another, and the symptom would be a 400 talking about libraries.
   */
  roots: ProjectRoots;
  /** Bridge to opencode. When absent, endpoints requiring it answer 503. */
  bridge: {
    /**
     * Starts the opencode server for that directory if needed and returns the
     * client. Always use it instead of `clientFor` for a world: the
     * "wrong" client does not fail at once, it fails later, and namelessly.
     */
    ensureServer(directory: string): Promise<OpencodeClient>;
    clientFor(directory: string): OpencodeClient;
    /**
     * Stops that directory's opencode server, if running. Needed when
     * the folder must be removed: on Windows a file open in the process blocks
     * deletion.
     */
    stopServer(directory: string): Promise<void>;
  } | null;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const scope = createScope(deps.db, deps.roots, deps.bridge);

  /*
   * A missing world is a single condition, not eleven: without this
   * check every writing route ends in SQLITE_CONSTRAINT_FOREIGNKEY and
   * answers 500 with the wrong cause too, leaking SQLite's internal message
   * to the client.
   *
   * It lives here and not in every route because a check repeated 11 times will
   * be missing the twelfth time. Creation is not involved: it goes through
   * /api/worlds without :id.
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
