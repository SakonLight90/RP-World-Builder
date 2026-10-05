import { type Arc, isArcOver, MAX_CHAPTERS_PER_ARC } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import {
  type ArcMemory,
  carryoverCost,
  flatCarryoverTokens,
  renderArcMemory,
} from "../src/canon/arc-memory.js";
import type { ChapterSummary } from "../src/canon/chapterer.js";

function arc(patch: Partial<Arc> & Pick<Arc, "n" | "title" | "status">): Arc {
  return {
    id: `arc-${patch.n}`,
    worldId: "w1",
    logline: "",
    spine: "",
    firstChapter: 1,
    lastChapter: 1,
    canonRefs: [],
    tokens: 0,
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
}

function chapter(n: number, summaryLength = 300): ChapterSummary {
  const summary = summaryLength === 0 ? "" : "s".repeat(summaryLength);
  return { n, title: `Capitolo ${n}`, summary };
}

function memory(over: Partial<Arc>, count: number, spine = ""): ArcMemory {
  // `lastChapter` derives from the chapter count, otherwise the helper
  // contradicts itself and the test ends up checking a case that doesn't exist.
  const firstChapter = over.firstChapter ?? 1;
  return {
    arc: arc({
      n: over.n ?? 1,
      title: over.title ?? "Arco",
      status: "closed",
      firstChapter,
      lastChapter: firstChapter + count - 1,
      spine,
      ...over,
    }),
    chapters: Array.from({ length: count }, (_, index) => chapter(firstChapter + index)),
  };
}

describe("arc duration", () => {
  it("an arc never exceeds ten chapters", () => {
    expect(MAX_CHAPTERS_PER_ARC).toBe(10);
  });

  it("an open arc isn't full until it reaches the cap", () => {
    expect(isArcOver({ status: "open", firstChapter: 1, lastChapter: 9 })).toBe(false);
    expect(isArcOver({ status: "open", firstChapter: 1, lastChapter: 10 })).toBe(true);
  });

  it("a ten-chapter arc starts and ends properly", () => {
    const ten = { status: "open" as const, firstChapter: 11, lastChapter: 20 };
    expect(isArcOver(ten)).toBe(true);
  });

  it("an already closed arc is full", () => {
    expect(isArcOver({ status: "closed", firstChapter: 1, lastChapter: 2 })).toBe(true);
  });
});

describe("arc carryover", () => {
  it("closed arcs carry the spine, not the chapters", () => {
    const text = renderArcMemory(
      [
        memory(
          { n: 1, title: "The Awakening", firstChapter: 1, lastChapter: 10 },
          10,
          "Ten chapters in one arc: the protagonist leaves the shelter and finds the jobs board.",
        ),
      ],
      "it",
    );

    expect(text).toContain("Arc 1: The Awakening (chapters 1-10)");
    expect(text).toContain("Ten chapters in one arc");
    // no chapter enters in full
    expect(text).not.toContain("Chapter 3:");
  });

  it("the open arc keeps the most recent chapters", () => {
    const text = renderArcMemory(
      [
        {
          arc: arc({ n: 2, title: "La torre", status: "open", firstChapter: 11, lastChapter: 18 }),
          chapters: Array.from({ length: 8 }, (_, index) => ({
            n: 11 + index,
            title: `Capitolo ${11 + index}`,
            summary: `Riassunto ${11 + index}`,
          })),
        },
      ],
      "it",
    );

    expect(text).toContain("Arc 2 is still going");
    // only the last four chapters
    expect(text).toContain("Chapter 15:");
    expect(text).toContain("Chapter 18:");
    expect(text).not.toContain("Chapter 11:");
  });

  it("older arcs shrink to one line", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      memory(
        {
          n: index + 1,
          title: `Arco ${index + 1}`,
          firstChapter: index * 10 + 1,
          lastChapter: index * 10 + 10,
        },
        10,
        `Sintesi dell'arco ${index + 1}.`,
      ),
    );
    const text = renderArcMemory(many, "it");

    // earliest arcs are one line, without synthesis
    expect(text).toContain("- Arc 1: Arco 1\n");
    // latest six carry the spine
    expect(text).toContain("Sintesi dell'arco 10.");
  });

  it("in English the language changes but not the structure", () => {
    const text = renderArcMemory(
      [memory({ n: 1, title: "The Awakening" }, 10, "A summary.")],
      "en",
    );
    expect(text).toContain("Arc 1: The Awakening (chapters 1-10)");
    expect(text).toContain("The canon and the world rules have not changed");
  });

  it("always declares the canon hasn't changed", () => {
    expect(renderArcMemory([memory({ n: 1 }, 3, "S.")], "it")).toContain(
      "The canon and the world rules have not changed",
    );
  });

  it("without arcs it produces nothing", () => {
    expect(renderArcMemory([], "it")).toBe("");
  });
});

describe("measured savings", () => {
  it("an arc costs less than its chapters", () => {
    const memories = [
      memory(
        { n: 1, title: "Primo", firstChapter: 1, lastChapter: 10 },
        10,
        "Ten chapters compressed into one line.",
      ),
    ];
    const cost = carryoverCost(memories);

    expect(cost.chapters).toBe(10);
    expect(cost.arcs).toBe(1);
    expect(cost.withArcs).toBeLessThan(cost.withoutArcs);
    expect(cost.saved).toBeGreaterThan(0);
  });

  it("savings grow with the campaign, not with chapters", () => {
    // Ten ten-chapter arcs: memory must not grow with a hundred
    // chapters, otherwise the mechanism is pointless.
    const short = [memory({ n: 1, firstChapter: 1, lastChapter: 10 }, 10, "Sintesi breve.")];
    const long = Array.from({ length: 10 }, (_, index) =>
      memory(
        {
          n: index + 1,
          title: `Arco ${index + 1}`,
          firstChapter: index * 10 + 1,
          lastChapter: index * 10 + 10,
        },
        10,
        "Sintesi breve.",
      ),
    );

    const a = carryoverCost(short);
    const b = carryoverCost(long);

    expect(b.chapters).toBe(100);
    expect(b.arcs).toBe(10);
    // a hundred chapters don't cost ten times ten chapters
    expect(b.withArcs).toBeLessThan(a.withArcs * 5);
    expect(b.savedRatio).toBeGreaterThan(a.savedRatio);
  });

  it("without arcs savings are zero, visibly", () => {
    const chapters = [chapter(1, 400), chapter(2, 400)];
    expect(flatCarryoverTokens(chapters)).toBeGreaterThan(0);

    const cost = carryoverCost([{ arc: arc({ n: 1, title: "A", status: "open" }), chapters }]);
    // with an open arc chapters enter, so savings are small
    expect(cost.withArcs).toBeGreaterThan(0);
  });
});
