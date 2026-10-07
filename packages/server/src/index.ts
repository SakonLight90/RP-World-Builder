import { pathToFileURL } from "node:url";
import type { HealthReport, Settings } from "@rpwb/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { dbPath, ensureDir, resolveRoots } from "./config/paths.js";
import { DEFAULT_SETTINGS, loadSettings } from "./config/settings.js";
import { openDatabase } from "./db/connection.js";
import { corsHeaders, localOrigins, wantsPrivateNetwork } from "./http/cors.js";
import { registerRoutes } from "./http/routes.js";
import { configureLogLevel, log } from "./logging.js";
import { probeOpencodeVersion, resolveOpencodeBinary } from "./opencode/binary.js";
import { OpencodeBridge } from "./opencode/bridge.js";
import { CatalogCache } from "./opencode/catalog-cache.js";
import { defaultNarratorModel, narratorCandidates, restrictedModels } from "./opencode/models.js";
import {
  findNodeModules,
  inspectToolchain,
  probeNativeCompiler,
  type Toolchain,
  toolchainSummary,
} from "./toolchain.js";

export interface AppContext {
  dataDir: string;
  settings: Settings;
  bridge: OpencodeBridge | null;
  /** Why the bridge is unavailable. The wizard has to be able to show it. */
  bridgeError: string | null;
  binaryVersion: string | null;
  binaryPath: string | null;
  /** Which compiler the interface can use on this machine. */
  toolchain: Toolchain;
  /**
   * The model catalogue, read at most once in a few seconds.
   *
   * On the context because it belongs to the bridge: one bridge, one catalogue, shared by
   * the health report and `/api/models`, which a single page load asks for both.
   */
  catalog: CatalogCache;
}

const STARTUP_TIMEOUT_MS = 30_000;

/**
 * Lets the interface talk to the API, but only from this machine.
 *
 * The headers live in `http/cors.ts`, not here: the turn route writes them by hand to keep
 * the stream open, and two paths choosing headers on their own means the hand-written one
 * forgets them.
 */
function registerLocalCors(app: FastifyInstance, allowed: Set<string>): void {
  app.addHook("onRequest", async (request, reply) => {
    const headers = corsHeaders(
      request.headers.origin,
      wantsPrivateNetwork(request.headers),
      allowed,
    );
    if (headers !== null) {
      for (const [name, value] of Object.entries(headers)) reply.header(name, value);
    }

    if (request.method === "OPTIONS") {
      // Preflight: without an answer the verification request never goes out.
      await reply.code(request.headers.origin === undefined ? 400 : 204).send();
    }
  });
}

export async function createApp(): Promise<{ app: FastifyInstance; context: AppContext }> {
  // Resolved here, once, and then travel: the roots do not depend on `process.cwd()`.
  const roots = resolveRoots();
  const dataDir = roots.data;

  // The native binaries can sit at the root or nested in a workspace, so `node_modules` is
  // searched by walking up, and they are tried to be loaded to see whether the interface can
  // compile.
  const toolchain = inspectToolchain(probeNativeCompiler(...findNodeModules(import.meta.dirname)));
  await ensureDir(dataDir);
  const settings = await loadSettings(dataDir);
  const db = openDatabase({ path: dbPath(dataDir), now: () => new Date().toISOString() });

  // One level for both loggers: with two defaults, `RPWB_LOG_LEVEL=info` gives half the story
  // and "nothing was logged" means "the half that was not configured".
  const level = configureLogLevel();
  const app = Fastify({ logger: { level } });
  const context: AppContext = {
    dataDir,
    settings,
    bridge: null,
    bridgeError: null,
    binaryVersion: null,
    binaryPath: null,
    toolchain,
    // A placeholder, replaced below once the bridge exists. Building it here would mean
    // a cache over a bridge that is not there yet.
    catalog: new CatalogCache(() => {
      throw new Error("opencode is not available");
    }),
  };

  const binary = await resolveOpencodeBinary();
  if (!binary) {
    context.bridgeError =
      "opencode binary not found in PATH. Install opencode, then restart the platform.";
  } else {
    context.binaryPath = binary.path;
    context.binaryVersion = await probeOpencodeVersion(binary);
    const bridge = new OpencodeBridge({
      host: settings.host,
      port: settings.opencodePort,
      baseUrl: process.env.OPENCODE_BASE_URL ?? settings.opencodeBaseUrl,
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
      binary,
      // The primary server serves models and health. The narrator agent lives in the world's
      // folder, with its Bible, and needs a server started from there.
      primaryDirectory: dataDir,
    });
    const started = await bridge.start();
    if (started) {
      context.bridge = bridge;
    } else {
      context.bridgeError = bridge.status.error ?? "Cannot start opencode";
    }
  }

  // Built after the bridge, because a cache that cannot read is worse than no cache.
  context.catalog = new CatalogCache(() => {
    const current = context.bridge;
    if (current === null) throw new Error("opencode is not available");
    return current.clientFor(dataDir);
  });

  registerLocalCors(app, localOrigins());

  app.get("/api/health", async (): Promise<HealthReport> => healthReport(context));

  app.get("/api/setup/status", async () => ({
    setupCompleted: settings.setupCompleted,
    uiLocale: settings.uiLocale,
    dataDir,
    // The wizard shows the toolchain: "it does not compile" without an explanation is the kind
    // of error that costs an hour.
    toolchain,
  }));

  app.get("/api/config/defaults", async () => DEFAULT_SETTINGS);

  registerRoutes(app, { db, roots, bridge: context.bridge });

  app.addHook("onClose", async () => {
    await context.bridge?.stop();
    db.close();
  });

  return { app, context };
}

/** Uses the bridge already started: it must not open a second one. */
async function healthReport(context: AppContext): Promise<HealthReport> {
  const baseUrl = `http://${context.settings.host}:${context.settings.opencodePort}`;

  if (!context.bridge) {
    return {
      healthy: false,
      version: context.binaryVersion,
      baseUrl,
      binary: { found: false, version: null, path: null },
      providers: [],
      freeModels: [],
      narratorModels: [],
      restrictedModels: [],
      defaultModel: null,
      problem: context.bridgeError ?? "opencode not available",
    };
  }

  // A local, because the narrowing above does not survive into a closure.
  const bridge = context.bridge;
  const health = await bridge.health();
  // Shared with `/api/models`: a page load asks for both.
  const catalog = await context.catalog.get();

  return {
    healthy: health.healthy && catalog.free.length > 0,
    version: health.version ?? bridge.status.version,
    baseUrl: bridge.baseUrl,
    binary: {
      found: true,
      version: context.binaryVersion,
      path: context.binaryPath,
    },
    providers: catalog.connectedProviders,
    freeModels: catalog.free.map((model) => model.ref),
    narratorModels: narratorCandidates(catalog).map((model) => model.ref),
    restrictedModels: restrictedModels(catalog).map((model) => model.ref),
    defaultModel: defaultNarratorModel(catalog),
    problem: health.healthy
      ? catalog.problem
      : `opencode server unreachable: ${health.error ?? "health check failed"}`,
  };
}

export async function start(): Promise<FastifyInstance> {
  const { app, context } = await createApp();

  await app.listen({ port: context.settings.port, host: context.settings.host });
  log.info("server.listening", {
    url: `http://${context.settings.host}:${context.settings.port}`,
  });
  log.info(toolchainSummary(context.toolchain));

  // At `warn`: this is the one line that says what to back up and what to delete, and it is
  // read by somebody who does not yet know what is wrong.
  log.warn("data.directory", { path: context.dataDir });

  // The failure a fresh install hits first, logged with what to do about it.
  if (context.bridgeError) log.warn("narrator.unavailable", { reason: context.bridgeError });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      // Why a turn was left half written: a reader who stopped the process mid-narration needs to
      // know it was them and not a crash.
      log.info("server.stopping", { signal });
      void app.close().then(() => process.exit(0));
    });
  }

  return app;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  start().catch((error: unknown) => {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${text}\n`);
    process.exit(1);
  });
}
