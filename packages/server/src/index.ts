import { pathToFileURL } from "node:url";
import type { HealthReport, Settings } from "@rpwb/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { dbPath, ensureDir, resolveRoots } from "./config/paths.js";
import { DEFAULT_SETTINGS, loadSettings } from "./config/settings.js";
import { openDatabase } from "./db/connection.js";
import { corsHeaders, localOrigins, wantsPrivateNetwork } from "./http/cors.js";
import { registerRoutes } from "./http/routes.js";
import { probeOpencodeVersion, resolveOpencodeBinary } from "./opencode/binary.js";
import { OpencodeBridge } from "./opencode/bridge.js";
import {
  defaultNarratorModel,
  narratorCandidates,
  readModelCatalog,
  restrictedModels,
} from "./opencode/models.js";
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
}

const STARTUP_TIMEOUT_MS = 30_000;

/**
/**
 * Lets the interface talk to the API, but only from this machine.
 *
 * The headers live in http/cors.ts, not here: the turn route writes the headers
 * by hand to keep the stream open, and if the two paths chose headers on their
 * own, the hand-written one would forget them. The preflight would pass and the
 * answer would arrive without them, which is the worst case: everything looks
 * fine and the browser blocks it anyway.
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
      // Preflight: without this the verification request never gets an answer.
      await reply.code(request.headers.origin === undefined ? 400 : 204).send();
    }
  });
}

export async function createApp(): Promise<{ app: FastifyInstance; context: AppContext }> {
  // The roots are resolved here, once, and then travel. The server can be started
  // from any folder: from the repository root, from any other one, from a service.
  // The roots do not change with `process.cwd()`.
  const roots = resolveRoots();
  const dataDir = roots.data;

  // The native binaries can sit at the root or nested in a workspace:
  // `node_modules` is searched by walking up, and they are tried to be loaded to
  // find out whether the interface can compile.
  const toolchain = inspectToolchain(probeNativeCompiler(...findNodeModules(import.meta.dirname)));
  await ensureDir(dataDir);
  const settings = await loadSettings(dataDir);
  const db = openDatabase({ path: dbPath(dataDir), now: () => new Date().toISOString() });

  const app = Fastify({ logger: { level: process.env.RPWB_LOG_LEVEL ?? "warn" } });
  const context: AppContext = {
    dataDir,
    settings,
    bridge: null,
    bridgeError: null,
    binaryVersion: null,
    binaryPath: null,
    toolchain,
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
      // The primary server serves models and health. The narrator agent is not
      // needed here: that lives in the world's folder, with its Bible, and for
      // opencode to see it a server has to have started from there.
      primaryDirectory: dataDir,
    });
    const started = await bridge.start();
    if (started) {
      context.bridge = bridge;
    } else {
      context.bridgeError = bridge.status.error ?? "Cannot start opencode";
    }
  }

  registerLocalCors(app, localOrigins());

  app.get("/api/health", async (): Promise<HealthReport> => healthReport(context));

  app.get("/api/setup/status", async () => ({
    setupCompleted: settings.setupCompleted,
    uiLocale: settings.uiLocale,
    dataDir,
    // The CPU decides which compiler can run. The wizard shows it, because
    // "it does not compile" without an explanation is the kind of error that makes
    // someone who does not know what SWC is lose an hour.
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

  const health = await context.bridge.health();
  const catalog = await readModelCatalog(context.bridge.clientFor(context.dataDir));

  return {
    healthy: health.healthy && catalog.free.length > 0,
    version: health.version ?? context.bridge.status.version,
    baseUrl: context.bridge.baseUrl,
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
  app.log.info(`RP World Builder on http://${context.settings.host}:${context.settings.port}`);
  app.log.info(toolchainSummary(context.toolchain));
  if (context.bridgeError) app.log.warn(context.bridgeError);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
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
