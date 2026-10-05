/**
 * Arcs: an arc spans multiple chapters and closes into a **spine**.
 *
 * The problem they solve is context growth. Every closed chapter
 * injected in full at each new session grows the carryover with the
 * campaign, and that permanent memory is spent every turn for the rest
 * of the game.
 *
 * An arc solves the growth: when it closes, its chapters do not
 * disappear but merge into a spine of a few lines, saying
 * what happened and what changed. Permanent memory grows with the number
 * of **arcs**, which is slow, not with the number of chapters, which is fast.
 *
 * It is also the right place to keep branches: in a branching story the
 * useful question is not "what happened in chapter 12" but "which branch did we
 * take, and what made that branch different".
 */

export const ARC_STATUSES = ["open", "closed"] as const;

export type ArcStatus = (typeof ARC_STATUSES)[number];

export interface Arc {
  id: string;
  worldId: string;
  n: number;
  title: string;
  /** What the arc promises, in one line. */
  logline: string;
  /**
   * Compressed summary of the whole arc. Empty while the arc is open: it is
   * written on close, and that is the token saving.
   */
  spine: string;
  status: ArcStatus;
  firstChapter: number;
  lastChapter: number;
  canonRefs: string[];
  /** Estimated token cost of the carryover text. */
  tokens: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * An arc never exceeds ten chapters.
 *
 * It sets a pace and a cap: beyond that, the spine
 * would compress too much story and the arc chronology would lose the nuances
 * that make the carryover useful. An arc long enough to hold a phase
 * of play, short enough not to fill the context.
 */
export const MAX_CHAPTERS_PER_ARC = 10;

/** How many closed arcs are remembered in full in the carryover. */
export const CLOSED_ARCS_IN_CARRYOVER = 6;

/**
 * How many chapters of the open arc are remembered in full. The rest
 * compresses to one line: inside a current arc the fine-grained chronology is still
 * useful, but not at the cost of growing the prompt.
 */
export const BEATS_IN_CARRYOVER = 4;

export function isArcOver(arc: Pick<Arc, "firstChapter" | "lastChapter" | "status">): boolean {
  if (arc.status === "closed") return true;
  return arc.lastChapter - arc.firstChapter + 1 >= MAX_CHAPTERS_PER_ARC;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
