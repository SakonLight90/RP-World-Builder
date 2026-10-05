import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/config/settings.js";
import { createApp } from "../src/index.js";

/**
 * Routes living in `createApp`, not `routes.ts`.
 *
 * The three the UI calls first of all: wizard state, starting settings and
 * platform health. They don't have one test each, and health is what the
 * wizard watches to decide whether it can go on: answering something false,
 * the user sees "all good" while the narrator isn't there.
 *
 * The opencode binary is replaced with a nonexistent one. Not a shortcut:
 * starting opencode here would mean a real server, a free port and a test
 * passing only on a machine having it installed. The route must know how to
 * answer even when opencode is missing, and that's exactly what's tested.
 *
 * Data folder is temp: `createApp` writes the database and config file there,
 * and a test writing into the system data folder would leave user stuff behind.
 */

vi.mock("../src/opencode/binary.js", async (original) => ({
  ...(await original<typeof import("../src/opencode/binary.js")>()),
  resolveOpencodeBinary: async () => null,
  probeOpencodeVersion: async () => null,
}));

/**
 * The compiler probe is replaced with a fixed outcome.
 *
 * The real probe starts a child process for every installed native binary and
 * changes outcome machine to machine: here the route is proven to **carry**
 * the verdict and explanation, not that this machine has a CPU knowing
 * certain instructions. The real probe is already tested where it belongs,
 * `toolchain.test.ts`.
 */
vi.mock("../src/toolchain.js", async (original) => ({
  ...(await original<typeof import("../src/toolchain.js")>()),
  probeNativeCompiler: () => ({
    outcome: "failed",
    binary: "swc-prova",
    problem: "caricamento rifiutato",
  }),
}));

let app: FastifyInstance;
let data: string;
let previousData: string | undefined;
let previousLog: string | undefined;

const get = (url: string) => app.inject({ method: "GET", url });

beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), "rpwb-piattaforma-"));
  previousData = process.env.RPWB_DATA_DIR;
  previousLog = process.env.RPWB_LOG_LEVEL;
  process.env.RPWB_DATA_DIR = data;
  process.env.RPWB_LOG_LEVEL = "silent";
  ({ app } = await createApp());
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(data, { recursive: true, force: true });
  if (previousData === undefined) delete process.env.RPWB_DATA_DIR;
  else process.env.RPWB_DATA_DIR = previousData;
  if (previousLog === undefined) delete process.env.RPWB_LOG_LEVEL;
  else process.env.RPWB_LOG_LEVEL = previousLog;
});

describe("platform health", () => {
  it("declares unhealthy when opencode is unavailable", async () => {
    // "Don't know" isn't an option: the wizard uses this field to decide
    // whether to show the next step, and a true `healthy` with a missing
    // narrator leads the user to write a scene nobody will tell.
    const response = await get("/api/health");
    expect(response.statusCode).toBe(200);

    const health = response.json<{
      healthy: boolean;
      binary: { found: boolean };
      problem: string | null;
    }>();
    expect(health.healthy).toBe(false);
    expect(health.binary.found).toBe(false);
    // And it says why, with a fixable reason, not a generic error.
    expect(health.problem).toContain("opencode");
    expect(health.problem).not.toBe("");
  });

  it("doesn't promise models it couldn't ask for", async () => {
    // An empty catalog is right, but a catalog holding the project default
    // would suggest that model is ready when nobody checked it.
    const health = (await get("/api/health")).json<{
      providers: unknown[];
      freeModels: unknown[];
      narratorModels: unknown[];
      defaultModel: string | null;
    }>();
    expect(health.providers).toEqual([]);
    expect(health.freeModels).toEqual([]);
    expect(health.narratorModels).toEqual([]);
    expect(health.defaultModel).toBeNull();
  });

  it("tells where the narrator should be, even when missing", async () => {
    // The address comes from settings, not the bridge: it's the config the
    // user must compare with what's running.
    const health = (await get("/api/health")).json<{ baseUrl: string }>();
    expect(health.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe("wizard state", () => {
  it("on a fresh install says setup isn't done", async () => {
    const response = await get("/api/setup/status");
    expect(response.statusCode).toBe(200);

    const state = response.json<{ setupCompleted: boolean; uiLocale: string; dataDir: string }>();
    expect(state.setupCompleted).toBe(false);
    expect(state.uiLocale).toBe("en");
    expect(state.dataDir).toBe(data);
  });

  it("tells which compiler the UI can use, and why", async () => {
    // "Can't compile" without explanation is the hour-wasting error for those
    // not knowing a WebAssembly compiler exists: so the route carries the
    // verdict, the unloadable binary and the copyable remedy.
    const toolchain = (await get("/api/setup/status")).json<{
      toolchain: {
        compiler: string;
        fix: string | null;
        consequence: string;
        probe: { outcome: string; binary: string };
      };
    }>().toolchain;

    expect(toolchain.compiler).toBe("wasm");
    expect(toolchain.probe.binary).toBe("swc-prova");
    expect(toolchain.consequence).toContain("swc-prova");
    expect(toolchain.consequence).toContain("caricamento rifiutato");
    expect(toolchain.fix).toContain("@next/swc-wasm-nodejs");
  });
});

describe("starting settings", () => {
  it("are the project-declared ones, without the data folder inside", async () => {
    // `dataDir` in defaults is an empty string for consistency: UI must read
    // the real folder from wizard state, not defaults, otherwise it would show
    // a folder that isn't the one.
    const response = await get("/api/config/defaults");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(DEFAULT_SETTINGS);
    expect(response.json().dataDir).toBe("");
  });

  it("the server port and opencode's are two different ports", async () => {
    // The two numbers a user configures, and swapping them swaps the roles:
    // the wizard ends up saying the server is missing while opencode started.
    const corpi = (await get("/api/config/defaults")).json<{
      port: number;
      opencodePort: number;
      host: string;
    }>();
    expect(corpi.port).toBe(DEFAULT_SETTINGS.port);
    expect(corpi.opencodePort).not.toBe(corpi.port);
    expect(corpi.host).toBe("127.0.0.1");
  });
});

describe("application construction", () => {
  it("writes the database where told, not in the user folder", async () => {
    // Isolation check, not the route's: if `RPWB_DATA_DIR` never arrived, the
    // test would write where the user keeps campaigns.
    expect(existsSync(join(data, "rpwb.db"))).toBe(true);
  });

  it("also mounts world routes, not just wizard ones", async () => {
    // `createApp` is where everything mounts: if `registerRoutes` never ran,
    // the wizard would work and the platform wouldn't, the worst case to
    // diagnose.
    const response = await get("/api/worlds");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ worlds: [], templates: [] });
  });
});
