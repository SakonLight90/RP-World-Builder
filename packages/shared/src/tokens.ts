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
