import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyTokenUsage } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRoots } from "../src/config/paths.js";
import { openMemory } from "../src/db/connection.js";
import { WorldRepository } from "../src/db/repo/worlds.js";
import type {
  EventSubscription,
  Narrator,
  NarratorPrompt,
  StoredMessage,
} from "../src/opencode/narrator.js";
import { TurnPipeline } from "../src/turns/pipeline.js";

/**
 * The narrator is replaceable.
 *
 * Here opencode working isn't proven: it's proven **even the pipeline doesn't
 * know it exists**. The fake below implements the contract with not one SDK
 * line, and the turn still runs, from the freshly opened session to the event
 * closing it. If the narrator changes tomorrow, this test immediately tells
 * the cost: nothing, if the contract is right.
 */

const LORE = resolveRoots().lore;

/**
 * A fake narrator: the whole contract, nothing else.
 *
 * Twenty lines, and they're the test's point: every method in here is one the
 * contract asks for, and none knows what an endpoint is.
 */
class FakeNarrator implements Narrator {
  /** Every received prompt, with the session it went to. */
  readonly requests: { sessionId: string; request: NarratorPrompt }[] = [];

  async contextLimit(): Promise<number | null> {
    return 128_000;
  }

  async createSession(): Promise<string> {
    return "ses_finta";
  }

  async sessionExists(): Promise<boolean> {
    return true;
  }

  async prompt(sessionId: string, request: NarratorPrompt): Promise<string> {
    this.requests.push({ sessionId, request });
    return "";
  }

  async messages(): Promise<StoredMessage[]> {
    return [];
  }

  async events(): Promise<EventSubscription> {
    return {
      events: (async function* () {
        yield {
          type: "message.part.updated",
          properties: {
            part: {
              sessionID: "ses_finta",
              messageID: "msg_finto",
              id: "prt_1",
              type: "text",
              text: "La porta cede.",
            },
          },
        };
        yield { type: "session.idle", properties: { sessionID: "ses_finta" } };
      })(),
      close: () => undefined,
    };
  }

  async abort(): Promise<void> {}

  async truncateTo(): Promise<void> {}

  async closeSession(): Promise<void> {}
}

let db: Database;
let worlds: WorldRepository;
let data: string;
let worldId: string;

beforeEach(async () => {
  db = openMemory();
  data = await mkdtemp(join(tmpdir(), "rpwb-narrator-"));
  worlds = new WorldRepository(db);
  worldId = worlds.create({
    name: "Prova",
    slug: "prova",
    model: "opencode/space-bunny-free",
    smallModel: "opencode/space-bunny-free",
    opencodeDir: join(data, "prova"),
  }).id;
});

afterEach(async () => {
  db.close();
  await rm(data, { recursive: true, force: true });
});

describe("a fake narrator", () => {
  it("runs a whole turn without knowing opencode exists", async () => {
    const narrator = new FakeNarrator();

    const result = await new TurnPipeline(db, narrator, LORE).play({
      worldId,
      text: "Apro la porta.",
      locale: "it",
      locationId: null,
    });

    // The turn finished, on the session the fake narrator declared.
    expect(result.sessionId).toBe("ses_finta");
    expect(result.text).toBe("La porta cede.");
    expect(result.usage).toEqual(emptyTokenUsage());
    // And the window is what it declared, not some server's.
    expect(result.debug.context.contextLimit).toBe(128_000);

    // Prompts arrived in pipeline order: context first, player action after.
    const [contextPrompt, actionPrompt] = narrator.requests;
    expect(contextPrompt?.request.delivery).toBe("no-reply");
    expect(contextPrompt?.request.text).toContain("## LANGUAGE");
    expect(actionPrompt?.request.delivery).toBe("fire-and-forget");
    expect(actionPrompt?.request.text).toBe("Apro la porta.");
    expect(actionPrompt?.request.modelRef).toBe("opencode/space-bunny-free");
    expect(contextPrompt?.sessionId).toBe("ses_finta");
  });

  it("a world without saved session opens a new one with its narrator", async () => {
    const narrator = new FakeNarrator();
    await new TurnPipeline(db, narrator, LORE).inspect(worldId);

    expect(worlds.get(worldId)?.opencodeSessionId).toBe("ses_finta");
  });
});
