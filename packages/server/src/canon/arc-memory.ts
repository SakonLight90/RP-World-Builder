import { type Arc, BEATS_IN_CARRYOVER, CLOSED_ARCS_IN_CARRYOVER } from "@rpwb/shared";
import type { ChapterSummary } from "./chapterer.js";

/**
 * Memory carryover, rewritten around arcs.
 *
 * The earlier shape listed every chapter and injected the last five in full.
 * On a long campaign the permanent memory grew with the chapters — that is,
 * quickly — and the cost was paid on every turn.
 *
 * Here closed arcs enter as the **spine**: an arc, however many chapters it
 * holds, is worth one line in the context. Only the open arc keeps recent
 * chapters in full, and only the last ones. The total depends on the arcs,
 * not on the chapters.
 */

export interface ArcMemory {
  arc: Arc;
  /** Chapters of the arc, oldest first. */
  chapters: ChapterSummary[];
}

/**
 * `locale` is no longer read: the memory is written in English for every world.
 * It stays in the signature because the caller passes the world's language and
 * removing it would mean touching code outside this module.
 */
export function renderArcMemory(memories: ArcMemory[], _locale: string): string {
  if (memories.length === 0) return "";

  const open = memories.find((memory) => memory.arc.status === "open");
  const closed = memories.filter((memory) => memory.arc.status === "closed");

  // The oldest closed arcs shrink to one line each: after six arcs their exact
  // shape stops mattering, only that they are there.
  const condensed = closed.slice(0, Math.max(0, closed.length - CLOSED_ARCS_IN_CARRYOVER));
  const full = closed.slice(Math.max(0, closed.length - CLOSED_ARCS_IN_CARRYOVER));

  const lines: string[] = [];
  lines.push("This campaign continues. Here is what happened before, in order.");
  lines.push("");

  for (const memory of condensed) {
    lines.push(`- Arc ${memory.arc.n}: ${memory.arc.title}`);
  }

  for (const memory of full) {
    lines.push(
      `- Arc ${memory.arc.n}: ${memory.arc.title} (chapters ${memory.arc.firstChapter}-${memory.arc.lastChapter})`,
    );
    if (memory.arc.spine !== "") {
      lines.push(`  ${memory.arc.spine}`);
    }
  }

  if (open) {
    const beats = open.chapters.slice(-BEATS_IN_CARRYOVER);
    lines.push("");
    lines.push(`Arc ${open.arc.n} is still going: "${open.arc.title}".`);
    for (const beat of beats) {
      lines.push(`  - Chapter ${beat.n}: ${beat.title}`);
      if (beat.summary !== "") lines.push(`    ${beat.summary}`);
    }
  }

  lines.push("");
  lines.push("The canon and the world rules have not changed. Pick up from here.");

  return lines.join("\n");
}

/**
 * Cost of the arc-based carryover, in tokens.
 */
export function carryoverTokens(memories: ArcMemory[]): number {
  return Math.ceil(renderArcMemory(memories, "en").length / 4);
}

/**
 * What the cost would be **without arcs**, that is, injecting every chapter in
 * full. It is the comparison that turns the saving into a number instead of a
 * claim, and it feeds the debug panel.
 */
export function flatCarryoverTokens(chapters: ChapterSummary[]): number {
  return chapters.reduce(
    (sum, chapter) => sum + Math.ceil((chapter.title.length + chapter.summary.length) / 4),
    0,
  );
}

export interface CarryoverCost {
  /** Tokens with arcs. */
  withArcs: number;
  /** Tokens when injecting every chapter in full. */
  withoutArcs: number;
  /** How much is saved on every turn, for the rest of the campaign. */
  saved: number;
  savedRatio: number;
  arcs: number;
  chapters: number;
}

/**
 * The saving is permanent: memory is paid for on every turn, so the difference
 * is not a one-off but a per-turn cost avoided for the rest of the campaign.
 */
export function carryoverCost(memories: ArcMemory[]): CarryoverCost {
  const chapters = memories.flatMap((memory) => memory.chapters);
  const withArcs = carryoverTokens(memories);
  const withoutArcs = flatCarryoverTokens(chapters);
  return {
    withArcs,
    withoutArcs,
    saved: withoutArcs - withArcs,
    savedRatio: withoutArcs === 0 ? 0 : (withoutArcs - withArcs) / withoutArcs,
    arcs: memories.length,
    chapters: chapters.length,
  };
}
