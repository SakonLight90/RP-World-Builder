import type { HealthReport } from "@rpwb/shared";
import { ensureDir } from "./config/paths.js";
import { probeOpencodeVersion, resolveOpencodeBinary } from "./opencode/binary.js";
import { OpencodeBridge } from "./opencode/bridge.js";
import {
  defaultNarratorModel,
  narratorCandidates,
  readModelCatalog,
  restrictedModels,
} from "./opencode/models.js";

/**
 * The wizard must be able to show *why* the platform fails, so
 * inspection never throws: it gathers whatever it can and returns
 * the problem list.
 */
export async function inspect(dataDir: string, port: number, host: string): Promise<HealthReport> {
  await ensureDir(dataDir);

  const baseUrl = process.env["OPENCODE_BASE_URL"] ?? null;
  const binary = await resolveOpencodeBinary();

  if (!binary) {
    return {
      healthy: false,
      version: null,
      baseUrl: baseUrl ?? `http://${host}:${port}`,
      binary: { found: false, version: null, path: null },
      providers: [],
      freeModels: [],
      narratorModels: [],
      restrictedModels: [],
      defaultModel: null,
      problem: "opencode binary not found in PATH. Install opencode and restart.",
    };
  }

  const binaryVersion = await probeOpencodeVersion(binary);
  const bridge = new OpencodeBridge({
    host,
    port,
    baseUrl,
    startupTimeoutMs: 30_000,
    binary,
  });

  const started = await bridge.start();
  if (!started) {
    return {
      healthy: false,
      version: binaryVersion,
      baseUrl: bridge.baseUrl,
      binary: { found: true, version: binaryVersion, path: binary.path },
      providers: [],
      freeModels: [],
      narratorModels: [],
      restrictedModels: [],
      defaultModel: null,
      problem: bridge.status.error ?? "Cannot start opencode",
    };
  }

  const catalog = await readModelCatalog(bridge.clientFor(dataDir));
  await bridge.stop();

  return {
    healthy: catalog.free.length > 0,
    version: bridge.status.version ?? binaryVersion,
    baseUrl: bridge.baseUrl,
    binary: { found: true, version: binaryVersion, path: binary.path },
    providers: catalog.connectedProviders,
    freeModels: catalog.free.map((model) => model.ref),
    narratorModels: narratorCandidates(catalog).map((model) => model.ref),
    restrictedModels: restrictedModels(catalog).map((model) => model.ref),
    defaultModel: defaultNarratorModel(catalog),
    problem:
      catalog.problem ??
      (catalog.free.length === 0
        ? "No free model available among the authenticated providers"
        : null),
  };
}
