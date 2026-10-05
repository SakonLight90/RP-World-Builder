import type { TokenUsage, World } from "@rpwb/shared";
import { DEFAULT_REASONING_EFFORT, emptyTokenUsage } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import { ChapterDraftSchema } from "../src/canon/chapterer.js";
import {
  contextLimitFor,
  FALLBACK_CONTEXT_LIMIT,
  findModel,
  isNearOverflow,
  shouldCloseChapter,
  snapshot,
  splitRef,
} from "../src/opencode/context.js";
import type { Narrator } from "../src/opencode/narrator.js";
import { currentContextUsage, type StoredMessage } from "../src/opencode/session.js";
import { makeModel } from "./helpers/fixtures.js";

const WORLD: World = {
  id: "w1",
  name: "Prova",
  slug: "prova",
  baseLocale: "it",
  activeLocale: "it",
  description: "",
  canonMode: "strict",
  model: "opencode/space-bunny-free",
  smallModel: "opencode/mimo-v2.6-flash-free",
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  chapterThresholdRatio: 0.7,
  contextLimit: null,
  canonBudgetRatio: 0.25,
  opencodeDir: "/tmp/w1",
  opencodeSessionId: null,
  libraries: [],
  isTemplate: false,
  templateAuthor: null,
  createdAt: "2026-09-28",
  updatedAt: "2026-09-28",
};

function usage(input: number, output = 0): TokenUsage {
  return { input, output, reasoning: 0, cache: { read: 0, write: 0 } };
}

describe("model references", () => {
  it("splits provider and model", () => {
    expect(splitRef("opencode/space-bunny-free")).toEqual({
      providerId: "opencode",
      modelId: "space-bunny-free",
    });
  });

  it("a bar-less reference doesn't break", () => {
    expect(splitRef("modello")).toEqual({ providerId: "modello", modelId: "" });
  });

  it("finds the model in the catalog", () => {
    const catalog = { all: [makeModel({ ref: "opencode/a", contextLimit: 1 })] };
    expect(findModel(catalog, "opencode/a")?.contextLimit).toBe(1);
    expect(findModel(catalog, "opencode/inesistente")).toBeNull();
  });
});

describe("context state", () => {
  it("the footprint is input plus output, not all messages' sum", () => {
    const state = snapshot({
      world: WORLD,
      contextLimit: 1000,
      usage: usage(400, 100),
      chapterNumber: 2,
    });
    expect(state.tokensUsed).toBe(500);
  });

  it("read cache occupies window", () => {
    const state = snapshot({
      world: WORLD,
      contextLimit: 1000,
      usage: { ...usage(0), cache: { read: 600, write: 0 } },
      chapterNumber: 1,
    });
    expect(state.tokensUsed).toBe(600);
  });
  it("the chapter threshold is the configured fraction", () => {
    const state = snapshot({
      world: WORLD,
      contextLimit: 100_000,
      usage: usage(0),
      chapterNumber: 1,
    });
    expect(state.chapterThreshold).toBe(70_000);
    expect(state.canonBudgetTokens).toBe(25_000);
  });

  it("fallback limits are declared", () => {
    expect(FALLBACK_CONTEXT_LIMIT).toBeGreaterThan(0);
  });
});

describe("chapter closing", () => {
  it("fires past the threshold, not at exact halfway", () => {
    const base = {
      world: WORLD,
      contextLimit: 1000,
      chapterNumber: 1,
    };
    const low = snapshot({ ...base, usage: usage(690) });
    const high = snapshot({ ...base, usage: usage(710) });
    expect(shouldCloseChapter(low)).toBe(false);
    expect(shouldCloseChapter(high)).toBe(true);
  });

  it("a higher threshold needs more context", () => {
    const base = { contextLimit: 1000, usage: usage(800), chapterNumber: 1 };
    const severo = snapshot({ ...base, world: { ...WORLD, chapterThresholdRatio: 0.9 } });
    const leggero = snapshot({ ...base, world: { ...WORLD, chapterThresholdRatio: 0.5 } });
    expect(shouldCloseChapter(severo)).toBe(false);
    expect(shouldCloseChapter(leggero)).toBe(true);
  });

  it("the safety margin rings before full", () => {
    const state = snapshot({
      world: WORLD,
      contextLimit: 1000,
      usage: usage(910),
      chapterNumber: 1,
    });
    expect(isNearOverflow(state)).toBe(true);
    expect(shouldCloseChapter(state)).toBe(true);
  });
});

describe("context footprint from messages", () => {
  function assistant(input: number, output: number): StoredMessage {
    return {
      id: "m",
      role: "assistant",
      text: "",
      usage: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
      createdAt: 0,
    };
  }

  it("uses the last assistant message, not the sum", () => {
    const messages: StoredMessage[] = [
      assistant(1000, 100),
      assistant(1200, 150),
      assistant(1300, 200),
    ];
    expect(contextFootprintOf(currentContextUsage(messages))).toBe(1500);
  });

  it("ignores user messages", () => {
    const messages: StoredMessage[] = [
      assistant(1000, 100),
      { id: "u", role: "user", text: "ciao", usage: null, createdAt: 1 },
    ];
    expect(contextFootprintOf(currentContextUsage(messages))).toBe(1100);
  });

  it("an empty session occupies nothing", () => {
    expect(contextFootprintOf(currentContextUsage([]))).toBe(0);
    expect(contextFootprintOf(currentContextUsage([]))).toBe(emptyTokenUsage().input);
  });
});

function contextFootprintOf(usage: TokenUsage): number {
  return usage.input + usage.cache.read + usage.output;
}

describe("chapter draft", () => {
  it("accepts essential fields and defaults the rest", () => {
    const parsed = ChapterDraftSchema.safeParse({ title: "The Depot", summary: "One night." });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.canonRefs).toEqual([]);
      expect(parsed.data.introducedEntities).toEqual([]);
    }
  });

  it("an empty object makes an empty draft instead of failing", () => {
    const parsed = ChapterDraftSchema.safeParse({});
    expect(parsed.success).toBe(true);
  });
});
describe("the context window the player sets", () => {
  /*
   * The player knows which model they pay for and how large its window really
   * is; the provider sometimes declares nothing, and the fallback is a guess.
   * When they have said a number, that number decides when a chapter closes.
   */
  interface Asked extends Narrator {
    asked: string[];
  }

  const providerSays = (window: number | null, fails = false): Asked => {
    const asked: string[] = [];
    return {
      asked,
      async contextLimit(ref: string): Promise<number | null> {
        asked.push(ref);
        if (fails) throw new Error("the provider is down");
        return window;
      },
    } as unknown as Asked;
  };

  it("uses the number the player gave, without asking the provider", async () => {
    const narrator = providerSays(200_000);
    expect(await contextLimitFor(narrator, "opencode/space-bunny-free", 480_000)).toBe(480_000);
    expect(narrator.asked).toEqual([]);
  });

  it("asks the provider when the field was left on automatic", async () => {
    const narrator = providerSays(200_000);
    expect(await contextLimitFor(narrator, "opencode/space-bunny-free", null)).toBe(200_000);
    expect(narrator.asked).toEqual(["opencode/space-bunny-free"]);
  });

  it("treats zero as not set, because it would close the first chapter", async () => {
    const narrator = providerSays(200_000);
    expect(await contextLimitFor(narrator, "opencode/space-bunny-free", 0)).toBe(200_000);
    expect(narrator.asked).toEqual(["opencode/space-bunny-free"]);
  });

  it("falls back when neither the player nor the provider answers", async () => {
    expect(await contextLimitFor(providerSays(null), "opencode/x", null)).toBe(
      FALLBACK_CONTEXT_LIMIT,
    );
    expect(await contextLimitFor(providerSays(null, true), "opencode/x", null)).toBe(
      FALLBACK_CONTEXT_LIMIT,
    );
  });
});
