/**
 * The machine, not the campaigns: available models and saved settings.
 *
 * It stays separate because it depends on no world: these are properties of
 * this installation, and mixing them with world routes suggested that a
 * model belonged to "that campaign".
 */

import { apiProblem } from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { loadSettings, saveSettings } from "../config/settings.js";
import {
  defaultNarratorModel,
  narratorCandidates,
  readModelCatalog,
  restrictedModels,
} from "../opencode/models.js";
import { SettingsBody } from "./schema.js";
import type { RouteScope } from "./scope.js";

export function registerSystemRoutes(app: FastifyInstance, scope: RouteScope): void {
  // --- models, settings, sharing ---------------------------------

  app.get("/api/models", async () => {
    if (!scope.bridge) return { free: [], narrator: [], restricted: [], default: null };
    const catalog = await readModelCatalog(scope.bridge.clientFor(scope.dataDir));
    const narrators = narratorCandidates(catalog);
    /*
     * The preferred model wins over the catalog default, if it really exists:
     * picking it in the UI and seeing it ignored would be a preference that
     * prefers nothing. If it is no longer in the catalog, fall back to the default
     * instead of offering a model that cannot be used.
     */
    const preferred = (await loadSettings(scope.dataDir)).preferredModel;
    const defaultModel =
      preferred !== null && narrators.some((model) => model.ref === preferred)
        ? preferred
        : defaultNarratorModel(catalog);
    return {
      free: catalog.free,
      narrator: narrators,
      restricted: restrictedModels(catalog),
      default: defaultModel,
      /*
       * This payload is not an error envelope but a list of models, so the
       * problem is spread into it and not nested under a key of its own: the
       * sentence stays in `problem`, where the interface has always read it, and
       * the code and its values arrive beside it. And when the catalog could be
       * read there is nothing to report: `null` says "empty", where a code would
       * have the wizard announcing a failure nobody had.
       */
      ...(catalog.problem === null
        ? { problem: null }
        : apiProblem("models.unavailable", { reason: catalog.problem })),
    };
  });

  app.get("/api/settings", async () => ({ settings: await loadSettings(scope.dataDir) }));

  app.put("/api/settings", async (request, reply) => {
    /*
     * This route used to accept any key and write it as a string into
     * a table nobody re-read: the server reads port, host and models
     * from the config file at startup. Writing "port" to the database
     * changed no port at all. Now it validates a closed list and saves to the real
     * file, so what is saved is what counts.
     */
    const body = SettingsBody.safeParse(request.body ?? {});
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    if (Object.keys(body.data).length === 0)
      return reply.code(400).send(apiProblem("settings.nothingToSave"));
    return { settings: await saveSettings(scope.dataDir, body.data) };
  });
}
