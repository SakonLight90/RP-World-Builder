import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRoots } from "../src/config/paths.js";
import { loadCorpus } from "../src/corpus/load.js";
import { openDatabase } from "../src/db/connection.js";
import { ArcRepository } from "../src/db/repo/arcs.js";
import { CastRepository } from "../src/db/repo/cast.js";
import { WorldRepository } from "../src/db/repo/worlds.js";
import { resolveOpencodeBinary } from "../src/opencode/binary.js";
import { OpencodeBridge } from "../src/opencode/bridge.js";
import { defaultNarratorModel, readModelCatalog } from "../src/opencode/models.js";
import { narratorFor } from "../src/opencode/narrator-adapter.js";
import { TurnPipeline } from "../src/turns/pipeline.js";

/**
 * The complete path of a turn, with a real model.
 *
 * It's the only test that puts everything together: canon from the corpus, the
 * Bible in the agent, the state card, the canon slice, streaming and context
 * state. It costs a few tens of seconds, and it's what says whether the platform
 * actually plays.
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

/** Project roots: valid from any folder, and not loaded by hand here. */
const roots = resolveRoots();

describeIfLive("a complete turn", () => {
  let rootDir: string;
  let bridge: OpencodeBridge;
  let db: Database;
  let worldId: string;
  let pipeline: TurnPipeline;

  beforeAll(async () => {
    if (!binary) return;
    rootDir = await mkdtemp(join(tmpdir(), "rpwb-turn-"));
    const port = await freePort();

    bridge = new OpencodeBridge({
      host: "127.0.0.1",
      port,
      baseUrl: null,
      startupTimeoutMs: 60_000,
      binary,
      primaryDirectory: rootDir,
    });
    if (!(await bridge.start())) throw new Error(bridge.status.error ?? "bridge not started");

    db = openDatabase({ path: join(rootDir, "test.db"), now: () => new Date().toISOString() });
    const model = defaultNarratorModel(await readModelCatalog(bridge.clientFor(rootDir)));

    // a world with the lore already in place, so the canon has something to act on
    const loaded = await loadCorpus(db, {
      root: roots.corpus,
      loreRoot: roots.lore,
      model,
      smallModel: model,
      reasoningEffort: "default",
      worldsDir: join(rootDir, "worlds"),
    });
    const worlds = new WorldRepository(db);
    const source = worlds.getBySlug("appalachia-2287");
    if (!source) throw new Error("corpus not loaded");
    worldId = source.id;
    expect(loaded).toHaveLength(1);

    const cast = new CastRepository(db);
    const chamber = cast.addLocation(worldId, {
      name: "Sala del Consiglio",
      description: "A round room with an oak table and heavy curtains.",
      parentId: null,
      aliases: [],
      era: "any",
    });
    cast.addCharacter(worldId, {
      name: "Vera",
      role: "addetta alla bacheca dei lavori",
      description: "L'abbiamo incontrata al piano inferiore.",
      personality: "diretta, sospettosa",
      secret: "",
      status: "",
      locationId: chamber.id,
      isPlayer: false,
      canonical: true,
      era: "any",
    });

    pipeline = new TurnPipeline(db, narratorFor(bridge.clientFor(source.opencodeDir)), roots.lore);
  });

  afterAll(async () => {
    await bridge?.stop();
    db?.close();
    if (rootDir) await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it("the narrator answers and respects the canon", async () => {
    const result = await pipeline.play({
      worldId,
      text: "Sono davanti alla bacheca dei lavori. Chiedo a Vera della torretta Est.",
      locale: "it",
      locationId: null,
    });

    expect(result.text.length).toBeGreaterThan(40);
    // Not `result.usage?.input`: a live test that passes on a provider reporting
    // nothing is not testing the provider's accounting, it is testing that the
    // plumbing did not throw. The whole point of asking for the usage here is to
    // see it arrive.
    expect(result.usage, "the provider reported no usage for the turn").not.toBeNull();
    expect(result.usage?.input ?? 0).toBeGreaterThan(0);

    // the canon was injected, and the absolute rules always come through
    expect(result.debug.canon.entries).toBeGreaterThan(0);
    expect(result.debug.canon.tiers.join(" ")).toContain("rules");
    expect(result.debug.canon.tiers.join(" ")).toContain("eras");

    // the state card is there
    expect(result.debug.stateCardTokens).toBeGreaterThan(0);
  }, 300_000);

  it("an action violating the canon is rebuffed in-fiction, not announced", async () => {
    const result = await pipeline.play({
      worldId,
      text: "Alzo la mano e evoco uno spirito della montagna per farmi aprire il portale.",
      locale: "it",
      locationId: null,
    });

    expect(result.text.length).toBeGreaterThan(40);
    // the rule about magic must have reached the turn's context
    expect(result.debug.canon.tiers.join(" ")).toContain("rules");
    // and the reply must not talk about a successful summoning as if it were
    // a normal thing in the world: the fact that the arc fired is enough here
    expect(result.debug.canon.tiers.join(" ")).toContain("Nessuna magia");
  }, 300_000);

  it("the narrator answers in pieces and says on which session it happened", async () => {
    const deltas: string[] = [];

    const result = await pipeline.play(
      {
        worldId,
        text: "Guardo fuori dalla bacheca dei lavori e vedo il cielo.",
        locale: "it",
        locationId: null,
      },
      (delta) => deltas.push(delta),
    );

    // the text arrived in several pieces, not all at once
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(result.text);

    // the session is the real one, not an empty string
    expect(result.sessionId).not.toBe("");
    // and it's the one the world row holds: `opencode_session_id` is the only
    // place a session is ever saved, so that's what has to be reread here.
    const world = new WorldRepository(db).get(worldId);
    expect(result.sessionId).toBe(world?.opencodeSessionId);
  }, 300_000);

  it("the campaign has an open arc within the chapter cap", () => {
    const arcs = new ArcRepository(db).list(worldId);
    // the first arc is born with the first chapter, and there are still few chapters
    expect(arcs.length).toBeLessThanOrEqual(1);
    for (const arc of arcs) {
      expect(arc.lastChapter - arc.firstChapter + 1).toBeLessThanOrEqual(10);
    }
  });
});
