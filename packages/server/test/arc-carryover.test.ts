import type { Arc } from "@rpwb/shared";
import { estimateTokens } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import { renderArcMemory } from "../src/canon/arc-memory.js";
import { buildCarryOverText, carryOverText } from "../src/canon/chapterer.js";

/**
 * Rounded check: functions are pure and do no I/O, so here only text shape
 * is checked, not a model.
 */

const arc = (n: number, first: number, last: number, status: Arc["status"]): Arc => ({
  id: `arc-${n}`,
  worldId: "w",
  n,
  title: `Arco ${n}`,
  logline: `logline ${n}`,
  spine: status === "closed" ? `spina ${n}` : "",
  status,
  firstChapter: first,
  lastChapter: last,
  canonRefs: [],
  tokens: 0,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});

const chapters = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    n: from + i,
    title: `Capitolo ${from + i}`,
    summary: `riassunto ${from + i}`,
  }));

describe("arc memory", () => {
  it("an open arc is not reduced to one line", () => {
    const text = renderArcMemory([{ arc: arc(1, 1, 6, "open"), chapters: chapters(1, 6) }], "it");
    expect(text).toContain("Arco 1");
    // chapters are still listed one by one: the arc isn't closed
    expect(text).toContain("Capitolo 6");
    expect(text).toContain("riassunto 6");
  });

  it("a closed arc enters as backbone and doesn't repeat its chapters", () => {
    const text = renderArcMemory(
      [{ arc: arc(1, 1, 10, "closed"), chapters: chapters(1, 10) }],
      "it",
    );
    expect(text).toContain("spina 1");
    expect(text).not.toContain("riassunto 7");
  });

  it("older closed arcs shrink to one line each", () => {
    const memories = Array.from({ length: 8 }, (_, i) => ({
      arc: arc(i + 1, i * 10 + 1, i * 10 + 10, "closed" as const),
      chapters: chapters(i * 10 + 1, i * 10 + 10),
    }));

    const text = renderArcMemory(memories, "it");
    // latest still have chapters, earliest don't
    expect(text).toContain("spina 8");
    expect(text).toContain("spina 7");
    expect(text).not.toContain("spina 1");
    expect(text).not.toContain("riassunto 3");
  });

  it("without arcs it invents nothing", () => {
    expect(renderArcMemory([], "it")).toBe("");
  });

  it("arc memory costs less than equivalent chapters", () => {
    const summaries = chapters(1, 10);
    const withArcs = estimateTokens(
      carryOverText(
        renderArcMemory([{ arc: arc(1, 1, 10, "closed"), chapters: summaries }], "it"),
        [],
      ),
    );
    const withoutArcs = estimateTokens(buildCarryOverText(summaries, "it"));

    expect(withArcs).toBeLessThan(withoutArcs);
  });

  it("in English the memory speaks English", () => {
    const text = renderArcMemory(
      [{ arc: arc(1, 1, 10, "closed"), chapters: chapters(1, 10) }],
      "en",
    );
    expect(text).toContain("This campaign continues");
    /*
     * The Italian marker stays Italian on purpose. This assertion is what proves
     * the two languages do not bleed into each other, so the string it looks for
     * has to be the one the Italian branch really produces: an English negative
     * would pass even if the renderer emitted both languages at once.
     */
    expect(text).not.toContain("Questa campagna continua");
  });
});
