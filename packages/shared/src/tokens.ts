/**
 * Token counting. OpenCode exposes per-message tokens; what matters
 * is the context footprint, that is how full the model
 * window is right now.
 */
export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
}

/**
 * Share of the context window taken by a message: input + cache
 * read + generated output. Reasoning and written cache do not take
 * persistent space in the next turn window.
 */
export function contextFootprint(usage: TokenUsage): number {
  return usage.input + usage.cache.read + usage.output;
}

/** Session context state, exposed by the API to the debug panel. */
export interface ContextState {
  model: string;
  contextLimit: number;
  tokensUsed: number;
  ratio: number;
  chapterThreshold: number;
  canonBudgetTokens: number;
  chapterNumber: number;
}

export function computeChapterThreshold(contextLimit: number, ratio: number): number {
  return Math.floor(contextLimit * ratio);
}

/**
 * Tokens for a piece of text, estimated.
 *
 * Four characters per token, which is the rule of thumb the canon slice already
 * uses. It is here and not only in the corpus because the context breakdown counts
 * the Bible with the same rule, and a breakdown whose parts are measured
 * differently from the total is a breakdown that cannot be added up.
 *
 * It is an estimate and stays one: real counting means a tokenizer, which means
 * depending on the model, which means the number changes with the narrator and
 * cannot be compared between two campaigns. Four characters per token is stable
 * and always wrong in the same direction.
 */
export function estimateTextTokens(text: string): number {
  return text === "" ? 0 : Math.ceil(text.length / 4);
}
