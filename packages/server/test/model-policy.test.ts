import type { ModelInfo } from "@rpwb/shared";
import { DEFAULT_NARRATOR_MODEL, isAdmissibleByDefault, modelPolicy } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import {
  defaultNarratorModel,
  type ModelCatalog,
  narratorCandidates,
  restrictedModels,
} from "../src/opencode/models.js";
import { makeModel } from "./helpers/fixtures.js";

function model(patch: Parameters<typeof makeModel>[0]): ModelInfo {
  return makeModel(patch);
}

function catalog(...models: ModelInfo[]): ModelCatalog {
  const free = models.filter((entry) => entry.free);
  return {
    all: models,
    free,
    connectedProviders: ["opencode"],
    problem: null,
  };
}

describe("model policy", () => {
  it("a prompt-training endpoint isn't automatically suitable", () => {
    const policy = modelPolicy("opencode/muse-spark-1.3-contributor-free");
    expect(policy.trainsOnPrompts).toBe(true);
    expect(isAdmissibleByDefault("opencode/muse-spark-1.3-contributor-free")).toBe(false);
  });

  it("a zero-retention endpoint is suitable", () => {
    expect(isAdmissibleByDefault(DEFAULT_NARRATOR_MODEL)).toBe(true);
    expect(modelPolicy(DEFAULT_NARRATOR_MODEL).zeroRetention).toBe(true);
  });

  it("an unknown model isn't chosen alone", () => {
    // Doubt counts as "no": recommending an endpoint storing unknown data
    // means exposing players' stories.
    expect(isAdmissibleByDefault("opencode/modello-che-non-conosciamo")).toBe(false);
  });

  it("NVIDIA trial endpoints aren't automatically suitable", () => {
    expect(isAdmissibleByDefault("opencode/nemotron-3-ultra-free")).toBe(false);
  });
});

describe("narrator choice", () => {
  it("the project default comes first", () => {
    const c = catalog(
      model({ ref: "opencode/altro-free", contextLimit: 200_000 }),
      model({ ref: DEFAULT_NARRATOR_MODEL, contextLimit: 32_000 }),
    );
    const candidates = narratorCandidates(c);
    expect(candidates[0]?.ref).toBe(DEFAULT_NARRATOR_MODEL);
  });

  it("the wider window doesn't beat the default", () => {
    // It was the previous heuristic, and it's wrong: a large context doesn't
    // improve a story and says nothing about privacy.
    const c = catalog(
      model({ ref: "opencode/mostruoso-free", contextLimit: 900_000 }),
      model({ ref: DEFAULT_NARRATOR_MODEL, contextLimit: 32_000 }),
    );
    expect(narratorCandidates(c).map((m) => m.ref)).toEqual([
      DEFAULT_NARRATOR_MODEL,
      "opencode/mostruoso-free",
    ]);
  });

  it("data-storing models don't enter candidates", () => {
    const c = catalog(
      model({
        ref: "opencode/muse-spark-1.3-contributor-free",
        trainsOnPrompts: true,
        zeroRetention: false,
        admissibleByDefault: false,
      }),
      model({ ref: DEFAULT_NARRATOR_MODEL }),
    );
    const candidates = narratorCandidates(c).map((m) => m.ref);
    expect(candidates).not.toContain("opencode/muse-spark-1.3-contributor-free");
    expect(candidates).toContain(DEFAULT_NARRATOR_MODEL);
  });

  it("data-storing minis stay available, but separate", () => {
    const c = catalog(
      model({
        ref: "opencode/muse-spark-1.3-contributor-free",
        trainsOnPrompts: true,
        admissibleByDefault: false,
      }),
      model({ ref: DEFAULT_NARRATOR_MODEL }),
    );
    expect(restrictedModels(c).map((m) => m.ref)).toEqual([
      "opencode/muse-spark-1.3-contributor-free",
    ]);
  });

  it("if no model is zero-retention one is still used, but not declared fit", () => {
    const c = catalog(
      model({ ref: "opencode/solo-contaminato", zeroRetention: false, admissibleByDefault: false }),
    );
    // The game must still work: the choice can't prevent playing, but
    // awareness stays exposed
    expect(narratorCandidates(c)).toHaveLength(1);
    expect(defaultNarratorModel(c)).toBe("opencode/solo-contaminato");
  });

  it("without free models the declared default stands", () => {
    const c: ModelCatalog = {
      all: [model({ ref: "opencode/a-paid", free: false, inputCost: 1, outputCost: 2 })],
      free: [],
      connectedProviders: ["opencode"],
      problem: "nessun modello gratis",
    };
    expect(defaultNarratorModel(c)).toBe(DEFAULT_NARRATOR_MODEL);
  });
});
