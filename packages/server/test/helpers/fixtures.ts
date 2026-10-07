import type { ModelInfo, StartsState, World } from "@rpwb/shared";
import { DEFAULT_REASONING_EFFORT, EMPTY_STARTS } from "@rpwb/shared";

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
    /*
     * Empty and not undefined, because on the real `World` it is never absent: a
     * world with no starts is a world with none, not a world whose column has not
     * been migrated yet. A fixture that defaulted to `undefined` would let a test
     * read `world.starts.list` without a guard and pass here while production
     * always hands over a real object.
     */
    starts: { ...EMPTY_STARTS },
    isTemplate: false,
    templateAuthor: null,
    createdAt: "2026-09-28",
    updatedAt: "2026-09-28",
    ...patch,
  };
}

/**
 * A world with playable starts, for the tests that need to choose one.
 *
 * Two of them, and one lore-only on purpose: the third exists so the tests can
 * check that a game nobody can play stays out of the selector and cannot be
 * selected, which is the rule that keeps a library from turning into a list of
 * campaigns that begin nowhere.
 */
export function makeStarts(patch: Partial<StartsState> = {}): StartsState {
  return {
    list: [
      {
        id: "new-vegas",
        name: "Fallout: New Vegas",
        game: "new-vegas",
        playable: true,
        narration: "Goodsprings. You wake on the floor with a hole in your head.",
      },
      {
        id: "fallout-76",
        name: "Fallout 76",
        game: "fallout-76",
        playable: true,
        narration: "Flatwoods. The saloon is quiet and the proprietress is watching you.",
      },
      {
        id: "fallout-1",
        name: "Fallout",
        game: "fallout-1",
        playable: false,
        narration: "",
      },
    ],
    selectedId: null,
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
    // A free fixture model bills nothing for its cache either, and it says so with
    // a zero rather than leaving them out: a turn priced by this fixture costs 0.00
    // and is counted in the money total, which is the case a real free model
    // produces and the one worth having a fixture for.
    cacheReadCost: 0,
    cacheWriteCost: 0,
    free: true,
    trainsOnPrompts: false,
    zeroRetention: true,
    privacyNote: "",
    admissibleByDefault: true,
    reasoning: true,
    ...patch,
  };
}
