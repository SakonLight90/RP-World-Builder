import type { ContextState, ModelInfo, TokenUsage, World } from "@rpwb/shared";
import { computeChapterThreshold, contextFootprint } from "@rpwb/shared";
import type { Narrator } from "./narrator.js";

/** Safety limit when the server does not declare the model's window. */
export const FALLBACK_CONTEXT_LIMIT = 128_000;

export function findModel(catalog: { all: ModelInfo[] }, ref: string): ModelInfo | null {
  return catalog.all.find((model) => model.ref === ref) ?? null;
}

export function splitRef(ref: string): { providerId: string; modelId: string } {
  const index = ref.indexOf("/");
  if (index <= 0) return { providerId: ref, modelId: "" };
  return { providerId: ref.slice(0, index), modelId: ref.slice(index + 1) };
}

/**
 * The context limit is read from the provider at runtime and is not written in
 * config: free models come and go, and a wrong window in config would close
 * chapters too early or too late.
 *
 * It asks the narrator and keeps the doubt: a window the provider does not
 * declare and a request that does not go through give the same answer, that is
 * the fallback value. They are two different failures for the caller and for the
 * campaign there is no difference: the chapter closes when it should.
 */
export async function contextLimitFor(
  narrator: Narrator,
  ref: string,
  override: number | null = null,
): Promise<number> {
  /*
   * The player's number wins over the provider's, and that is the whole point
   * of asking them. A free model and a paid one on the same account can differ
   * by an order of magnitude, a plan decides how large the window really is, and
   * a provider that does not declare one leaves the campaign on a fallback that
   * is a guess. The player is the only one who knows which of those they are
   * in, so when they have said a number, asking the provider again would be
   * answering a question they already answered.
   *
   * A zero override is treated as "not set" rather than "no context at all":
   * zero would divide by zero in the chapter threshold and close the chapter on
   * the first turn, which is a crash wearing a number.
   */
  if (override !== null && override > 0) return override;
  try {
    return (await narrator.contextLimit(ref)) ?? FALLBACK_CONTEXT_LIMIT;
  } catch {
    // carry on with the fallback value
    return FALLBACK_CONTEXT_LIMIT;
  }
}

export function snapshot(options: {
  world: World;
  contextLimit: number;
  usage: TokenUsage;
  chapterNumber: number;
}): ContextState {
  const tokensUsed = contextFootprint(options.usage);
  return {
    model: options.world.model,
    contextLimit: options.contextLimit,
    tokensUsed,
    ratio: options.contextLimit === 0 ? 1 : tokensUsed / options.contextLimit,
    chapterThreshold: computeChapterThreshold(
      options.contextLimit,
      options.world.chapterThresholdRatio,
    ),
    canonBudgetTokens: Math.floor(options.contextLimit * options.world.canonBudgetRatio),
    chapterNumber: options.chapterNumber,
  };
}

/**
 * The chapter closes *before* the context is full, not after: it is the point of
 * the whole mechanism. Once the threshold is passed the chapter is written and
 * compacted, so the working session becomes small again and the narrator's
 * quality does not degrade with campaign length.
 */
export function shouldCloseChapter(state: ContextState): boolean {
  return state.tokensUsed >= state.chapterThreshold;
}

/**
 * Safety margin for the emergency compaction round: if the chapterer did not
 * fire for some reason, the next turn must not fail on a full context.
 */
export function isNearOverflow(state: ContextState): boolean {
  return state.tokensUsed >= Math.floor(state.contextLimit * 0.9);
}
