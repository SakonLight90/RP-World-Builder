import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { World } from "@rpwb/shared";
import { DEFAULT_REASONING_EFFORT, EMPTY_STARTS } from "@rpwb/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ChapterSummary, closeChapter, reinsertPointer } from "../src/canon/chapterer.js";
import { probeOpencodeVersion, resolveOpencodeBinary } from "../src/opencode/binary.js";
import { OpencodeBridge } from "../src/opencode/bridge.js";
import { call } from "../src/opencode/client.js";
import {
  contextLimitFor,
  shouldCloseChapter,
  snapshot,
  splitRef,
} from "../src/opencode/context.js";
import { defaultNarratorModel, readModelCatalog } from "../src/opencode/models.js";
import { narratorFor } from "../src/opencode/narrator-adapter.js";
import { createSession, currentContextUsage, readMessages } from "../src/opencode/session.js";

/**
 * Every test below is independent from the others: it creates its own session,
 * its own turn, and verifies itself. Run a single one with
 * `npm run test:live:chapterer -- -t "name"`, and it must pass.
 *
 * The server is the only shared thing, and it's infrastructure like a database
 * connection: restarting it for every test would cost tens of seconds without
 * adding isolation, because no test sees the others' sessions.
 *
 * Only what **cannot be verified without a model** is kept here. Everything
 * else, from the chapter text to the carryover, is in `chapter-text.test.ts` and
 * costs twenty milliseconds instead of seventy seconds.
 */

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

const binary = await resolveOpencodeBinary();
const LIVE = process.env.RPWB_LIVE === "1";
const describeIfLive = binary === null || !LIVE ? describe.skip : describe;

describeIfLive("chapterer at runtime", () => {
  let rootDir: string;
  let bridge: OpencodeBridge;
  let world: World;
  let model: string;

  beforeAll(async () => {
    if (!binary) return;
    rootDir = await mkdtemp(join(tmpdir(), "rpwb-chap-"));
    const port = await freePort();
    bridge = new OpencodeBridge({
      host: "127.0.0.1",
      port,
      baseUrl: null,
      startupTimeoutMs: 60_000,
      binary,
      primaryDirectory: rootDir,
    });
    if (!(await bridge.start())) {
      throw new Error(`bridge not started: ${bridge.status.error ?? "unknown error"}`);
    }
    model = defaultNarratorModel(await readModelCatalog(bridge.clientFor(rootDir)));
    world = {
      id: "w-test",
      name: "Prova",
      slug: "prova",
      baseLocale: "it",
      activeLocale: "it",
      description: "",
      canonMode: "strict",
      model,
      smallModel: model,
      reasoningEffort: DEFAULT_REASONING_EFFORT,
      chapterThresholdRatio: 0.7,
      contextLimit: null,
      canonBudgetRatio: 0.25,
      opencodeDir: rootDir,
      opencodeSessionId: null,
      libraries: [],
      starts: { ...EMPTY_STARTS },
      isTemplate: false,
      templateAuthor: null,
      createdAt: "2026-09-28",
      updatedAt: "2026-09-28",
    };
  });

  afterAll(async () => {
    await bridge?.stop();
    if (rootDir) await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** Own directory: one test's chapters must not land in another's. */
  let seq = 0;
  async function sandbox(): Promise<string> {
    seq += 1;
    const dir = join(rootDir, `t${seq}`);
    return dir;
  }

  async function turn(sessionId: string, text: string): Promise<void> {
    const { providerId, modelId } = splitRef(model);
    await call(() =>
      bridge.clientFor(rootDir).session.prompt({
        path: { id: sessionId },
        body: {
          model: { providerID: providerId, modelID: modelId },
          parts: [{ type: "text", text }],
        },
      }),
    );
  }

  // --- without generation: startup costs, not tokens ------------------------

  it("the binary declares its own version", async () => {
    if (!binary) return;
    expect(await probeOpencodeVersion(binary)).toMatch(/^\d+\.\d+/);
  });

  it("the freshly started server answers", async () => {
    const health = await bridge.health();
    expect(health.healthy).toBe(true);
  });

  it("the context limit comes from the provider, not from the configuration", async () => {
    const limit = await contextLimitFor(narratorFor(bridge.clientFor(rootDir)), model);
    expect(limit).toBeGreaterThan(1000);
  });

  it("a nonexistent model falls back to the reserve value", async () => {
    const limit = await contextLimitFor(
      narratorFor(bridge.clientFor(rootDir)),
      "opencode/non-esiste",
    );
    expect(limit).toBeGreaterThan(0);
  });

  it("without a declared model the turn doesn't start", async () => {
    // No default model: every platform prompt must declare one.
    const sessionId = await createSession(bridge.clientFor(rootDir), "senza modello");
    const result = await call<{ error?: unknown }>(() =>
      bridge.clientFor(rootDir).session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: "Di' solo: ok" }] },
      }),
    ).catch((error: unknown) => ({ error }));
    expect(result.error).toBeDefined();
  });

  it("an empty session occupies no context", async () => {
    const sessionId = await createSession(bridge.clientFor(rootDir), "vuota");
    const usage = currentContextUsage(await readMessages(bridge.clientFor(rootDir), sessionId));
    expect(usage.input).toBe(0);
  });

  it("the threshold doesn't fire with an empty session", async () => {
    const limit = await contextLimitFor(narratorFor(bridge.clientFor(rootDir)), model);
    const state = snapshot({
      world,
      contextLimit: limit,
      usage: currentContextUsage([]),
      chapterNumber: 1,
    });
    expect(shouldCloseChapter(state)).toBe(false);
  });

  it("reinserting the pointer produces no reply", async () => {
    const client = bridge.clientFor(rootDir);
    const sessionId = await createSession(client, "puntatore");
    const before = (await readMessages(client, sessionId)).length;

    await reinsertPointer(
      narratorFor(client),
      sessionId,
      4,
      {
        title: "The Depot",
        summary: "A long night.",
        notableEvents: [],
        canonRefs: [],
        introducedEntities: [],
      },
      "it",
    );

    const after = await readMessages(client, sessionId);
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]?.role).toBe("user");
    expect(after[after.length - 1]?.text).toContain("chapter 4");
  });

  it("the English pointer says the same thing", async () => {
    const client = bridge.clientFor(rootDir);
    const sessionId = await createSession(client, "pointer en");
    await reinsertPointer(
      narratorFor(client),
      sessionId,
      2,
      {
        title: "The Depot",
        summary: "A long night.",
        notableEvents: [],
        canonRefs: [],
        introducedEntities: [],
      },
      "en",
    );
    const messages = await readMessages(client, sessionId);
    expect(messages[messages.length - 1]?.text).toContain("Chapter 2 is closed");
  });

  // --- with one generation --------------------------------------------------

  it("a real turn occupies context and stays within the window", async () => {
    const client = bridge.clientFor(rootDir);
    const sessionId = await createSession(client, "a turn");
    await turn(sessionId, "Sei in una stanza vuota. Descrivila in due frasi.");

    const usage = currentContextUsage(await readMessages(client, sessionId));
    expect(usage.input).toBeGreaterThan(0);

    const limit = await contextLimitFor(narratorFor(client), model);
    const state = snapshot({ world, contextLimit: limit, usage, chapterNumber: 1 });
    expect(state.ratio).toBeGreaterThan(0);
    expect(state.ratio).toBeLessThan(1);
  });

  it("opencode's compaction doesn't reduce the context", async () => {
    // Measured behavior: `session.summarize` adds a summary message and leaves
    // the original turns, so the context grows. That's why the chapter cuts or
    // opens a new session instead of trusting it.
    const client = bridge.clientFor(rootDir);
    const sessionId = await createSession(client, "misura");
    await turn(
      sessionId,
      "Riscrivi in oltre 200 parole: la lampada tremolava e l'aria sapeva di polvere.",
    );
    const before = (await readMessages(client, sessionId)).length;

    const { providerId, modelId } = splitRef(model);
    await call(() =>
      client.session.summarize({
        path: { id: sessionId },
        body: { providerID: providerId, modelID: modelId },
      }),
    );

    expect((await readMessages(client, sessionId)).length).toBeGreaterThanOrEqual(before);
  }, 300_000);

  // --- with generation and the chapterer: the full path ---------------------

  it("closes the chapter and brings the context back to a small size", async () => {
    const client = bridge.clientFor(rootDir);
    const worldDir = await sandbox();
    const sessionId = await createSession(client, "campaign");

    // A single turn is enough for the chapterer and halves the cost: the coverage
    // that matters here is the turn -> chapter -> carryover path, not the length.
    await turn(
      sessionId,
      "Sei in Vault 12 davanti alla bacheca dei lavori, e chiedi a Vera della torretta Est.",
    );

    const chapters: ChapterSummary[] = [
      { n: 1, title: "The Awakening", summary: "The protagonist leaves the shelter." },
    ];

    const chapter = await closeChapter({
      narrator: narratorFor(client),
      world: { ...world, opencodeDir: worldDir },
      worldDir,
      sessionId,
      locale: "it",
      chapterNumber: 2,
      arcId: null,
      premise: "Sei un sopravvissuto dell'Appalachia nel 2287.",
      rules: "Questo mondo non ha magia.",
      canonSubjects: ["Vault 12", "Vera"],
      recentTurns: 2,
      chapters,
      tokenStart: 0,
      tokenEnd: 0,
    });

    // the file is there and keeps the original premise
    const text = await readFile(join(worldDir, chapter.path), "utf8");
    expect(text).toContain("chapter: 2");
    expect(text).toContain("Sei un sopravvissuto dell'Appalachia");
    expect(text).toContain("Questo mondo non ha magia");

    // the context is small again, whichever mechanism did it
    expect(chapter.sessionId).not.toBe("");
    expect(chapter.messagesAfter).toBeLessThan(chapter.messagesBefore);

    // and the session to use next knows what happened
    const after = await readMessages(client, chapter.sessionId);
    const last = after[after.length - 1]?.text ?? "";
    expect(
      last.includes("chapter 2") || last.includes("Chapter 2") || last.includes("The Awakening"),
    ).toBe(true);
  }, 300_000);
});
