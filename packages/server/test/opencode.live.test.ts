import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NARRATOR_MODEL } from "@rpwb/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeOpencodeVersion, resolveOpencodeBinary } from "../src/opencode/binary.js";
import { OpencodeBridge } from "../src/opencode/bridge.js";
import {
  defaultNarratorModel,
  isFreeModel,
  narratorCandidates,
  readModelCatalog,
  restrictedModels,
} from "../src/opencode/models.js";
import { createSession, currentContextUsage, readMessages } from "../src/opencode/session.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

const binary = await resolveOpencodeBinary();
const LIVE = process.env.RPWB_LIVE === "1";
// A test that talks to a model costs minutes: it only runs on request.
const describeIfBinary = binary === null || !LIVE ? describe.skip : describe;

describeIfBinary("opencode at runtime", () => {
  let dataDir: string;
  let bridge: OpencodeBridge;
  let port: number;

  beforeAll(async () => {
    if (!binary) return;
    dataDir = await mkdtemp(join(tmpdir(), "rpwb-it-"));
    port = await freePort();
    bridge = new OpencodeBridge({
      host: "127.0.0.1",
      port,
      baseUrl: null,
      startupTimeoutMs: 60_000,
      binary,
      primaryDirectory: dataDir,
    });
    const started = await bridge.start();
    if (!started) {
      throw new Error(`bridge not started: ${bridge.status.error ?? "unknown error"}`);
    }
  });

  afterAll(async () => {
    await bridge?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("the CLI answers with a version", async () => {
    if (!binary) return;
    const version = await probeOpencodeVersion(binary);
    expect(version).toMatch(/^\d+\.\d+/);
  });

  it("the freshly started server is healthy", async () => {
    const health = await bridge.health();
    expect(health.healthy).toBe(true);
    expect(health.version).toMatch(/^\d+\.\d+/);
  });

  it("detects the authenticated providers", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    expect(catalog.connectedProviders.length).toBeGreaterThan(0);
  });

  it("finds at least one free model and really declares it free", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    expect(catalog.free.length).toBeGreaterThan(0);

    for (const model of catalog.free) {
      expect(model.inputCost).toBe(0);
      expect(model.outputCost).toBe(0);
      expect(isFreeModel(model.inputCost, model.outputCost)).toBe(true);
    }

    // Free models must have a known context window, otherwise we can't compute
    // the chapter threshold.
    for (const model of catalog.free) {
      expect(model.contextLimit).toBeGreaterThan(0);
    }
  });

  it("free models are referenced as provider/model", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    for (const model of catalog.free) {
      expect(model.ref).toBe(`${model.providerId}/${model.modelId}`);
    }
  });

  it("sorts by descending context window", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    const sorted = narratorCandidates(catalog);
    for (let i = 1; i < sorted.length; i += 1) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (!previous || !current) continue;
      // the project default comes before everything else, then the context
      // ordering applies
      if (previous.ref === DEFAULT_NARRATOR_MODEL || current.ref === DEFAULT_NARRATOR_MODEL) {
        expect(previous.ref).toBe(DEFAULT_NARRATOR_MODEL);
        continue;
      }
      expect(previous.contextLimit).toBeGreaterThanOrEqual(current.contextLimit);
    }
  });

  it("narrator candidates don't train on prompts", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    for (const model of narratorCandidates(catalog)) {
      expect(model.trainsOnPrompts).toBe(false);
      expect(model.zeroRetention).toBe(true);
    }
  });

  it("models that keep the data stay available but separate", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    const candidates = new Set(narratorCandidates(catalog).map((model) => model.ref));
    for (const model of restrictedModels(catalog)) {
      expect(candidates.has(model.ref)).toBe(false);
    }
  });

  it("the default model is the project's one when it's available", async () => {
    const catalog = await readModelCatalog(bridge.clientFor(dataDir));
    const chosen = defaultNarratorModel(catalog);
    if (catalog.free.some((model) => model.ref === DEFAULT_NARRATOR_MODEL)) {
      expect(chosen).toBe(DEFAULT_NARRATOR_MODEL);
    }
    const model = catalog.all.find((entry) => entry.ref === chosen);
    expect(model?.trainsOnPrompts).toBe(false);
  });

  it("creates a session and rereads it", async () => {
    const client = bridge.clientFor(dataDir);
    const sessionId = await createSession(client, "prova integrazione");
    expect(sessionId).toMatch(/^ses_/);

    const messages = await readMessages(client, sessionId);
    expect(Array.isArray(messages)).toBe(true);
    // a freshly created session is empty, and the context count is zero
    expect(currentContextUsage(messages).input).toBe(0);
  });
});
