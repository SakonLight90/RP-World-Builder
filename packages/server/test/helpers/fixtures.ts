import type { ModelInfo, World } from "@rpwb/shared";
import { DEFAULT_REASONING_EFFORT } from "@rpwb/shared";

/**
 * World and model fixtures for tests.
 *
 * They live here because a hand-copied `World` object in three files is a
 * promise to forget a field: the first time one was added, all tests broke
 * together. A single place to update.
 */
export function makeWorld(patch: Partial<World> = {}): World {
  return {
    id: "w-test",
    name: "Prova",
    slug: "prova",
    baseLocale: "it",
    activeLocale: "it",
    description: "",
    canonMode: "strict",
    model: "opencode/space-bunny-free",
    smallModel: "opencode/space-bunny-free",
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    chapterThresholdRatio: 0.7,
    contextLimit: null,
    canonBudgetRatio: 0.25,
    opencodeDir: "/tmp/prova",
    opencodeSessionId: null,
    libraries: [],
    isTemplate: false,
    templateAuthor: null,
    createdAt: "2026-09-28",
    updatedAt: "2026-09-28",
    ...patch,
  };
}

export function makeModel(patch: Partial<ModelInfo> & Pick<ModelInfo, "ref">): ModelInfo {
  return {
    providerId: patch.ref.split("/")[0] ?? "opencode",
    modelId: patch.ref.split("/")[1] ?? patch.ref,
    name: patch.ref,
    contextLimit: 32_000,
    inputCost: 0,
    outputCost: 0,
    free: true,
    trainsOnPrompts: false,
    zeroRetention: true,
    privacyNote: "",
    admissibleByDefault: true,
    reasoning: true,
    ...patch,
  };
}
