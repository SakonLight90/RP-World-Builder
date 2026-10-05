import type { ChapterDraft } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import type { ChapterSummary } from "../src/canon/chapterer.js";
import {
  buildCarryOverText,
  CARRY_FULL,
  ChapterDraftSchema,
  historyIncluding,
  renderChapter,
} from "../src/canon/chapterer.js";
import { makeWorld } from "./helpers/fixtures.js";

/**
 * All these tests run without opening a server and spending a token.
 *
 * It's the split that matters: chapter text and carryover logic don't need
 * the model, so they must not be verified through the model. A test taking 70
 * seconds to check a string never runs, and an unrun check is worth nothing.
 */

const DRAFT: ChapterDraft = {
  title: "The Depot",
  summary: "The protagonist enters the school and looks for supplies.",
  notableEvents: ["Trova del cibo in dispensa", "Sente un rumore al piano superiore"],
  canonRefs: ["Vault 12", "Fort Atlas"],
  introducedEntities: ["Brennan"],
};

function chapter(n: number, title: string, summary = ""): ChapterSummary {
  return { n, title, summary };
}

describe("chapter draft schema", () => {
  it("accepts essential fields and defaults the rest", () => {
    const parsed = ChapterDraftSchema.safeParse({ title: "The Depot", summary: "One night." });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.canonRefs).toEqual([]);
  });

  it("an empty object doesn't fail", () => {
    expect(ChapterDraftSchema.safeParse({}).success).toBe(true);
  });

  it("doesn't accept a non-object value", () => {
    expect(ChapterDraftSchema.safeParse("ciao").success).toBe(false);
  });
});

describe("story to carry", () => {
  it("appends the just-written chapter", () => {
    const history = historyIncluding([chapter(1, "Uno"), chapter(2, "Due")], chapter(3, "Tre"));
    expect(history.map((c) => c.n)).toEqual([1, 2, 3]);
  });

  it("doesn't duplicate the current chapter", () => {
    const history = historyIncluding([chapter(1, "Uno"), chapter(2, "Due")], chapter(2, "Due"));
    expect(history.map((c) => c.n)).toEqual([1, 2]);
  });

  it("gives a fallback title when the model didn't answer", () => {
    const history = historyIncluding([], chapter(4, ""));
    expect(history[0]?.title).toBe("Chapter 4");
  });

  it("the list stays empty only if there's nothing to carry", () => {
    expect(historyIncluding([], chapter(0, ""))).toHaveLength(1);
  });
});

describe("carryover text", () => {
  it("lists recent chapters in full", () => {
    const text = buildCarryOverText(
      [chapter(1, "Uno", "Riassunto uno."), chapter(2, "Due", "Riassunto due.")],
      "it",
    );
    expect(text).toContain("Chapter 1: Uno");
    expect(text).toContain("  Riassunto uno.");
    expect(text).toContain("Chapter 2: Due");
  });

  it("old chapters enter as title only, to keep context from growing", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      chapter(index + 1, `Titolo ${index + 1}`, "Riassunto."),
    );

    const text = buildCarryOverText(many, "it");

    // recent ones carry the summary
    expect(text).toContain("  Riassunto.");
    // the oldest doesn't
    expect(text).toContain("- Chapter 1: Titolo 1\n");
    expect(text).not.toContain("- Chapter 1: Titolo 1\n  Riassunto.");

    // text doesn't grow with chapter count
    const short = buildCarryOverText(many.slice(0, 3), "it");
    expect(text.length).toBeLessThan(short.length * 3);
  });

  it("the limit is adjustable", () => {
    const many = Array.from({ length: 9 }, (_, index) => chapter(index + 1, `T${index + 1}`, "R."));
    const text = buildCarryOverText(many, "it", 2);
    // with 2 full, only the last two have summaries
    const withSummary = text.split("\n").filter((line) => line.trim() === "R.").length;
    expect(withSummary).toBe(2);
    expect(CARRY_FULL).toBeGreaterThan(0);
  });

  it("declares the canon hasn't changed", () => {
    expect(buildCarryOverText([chapter(1, "Uno")], "it")).toContain(
      "The canon and the world rules have not changed",
    );
    expect(buildCarryOverText([chapter(1, "One")], "en")).toContain(
      "The canon and the world rules have not changed",
    );
  });

  it("in English changes language but not content", () => {
    const chapters = [chapter(1, "One", "A summary.")];
    const it = buildCarryOverText(chapters, "it");
    const en = buildCarryOverText(chapters, "en");
    expect(en).toContain("A summary.");
    expect(en).toContain("Chapter 1: One");
    expect(it).toContain("Chapter 1: One");
  });

  it("an empty summary leaves no blank lines", () => {
    const text = buildCarryOverText([chapter(1, "Uno", "")], "it");
    expect(text).not.toMatch(/\n\s*\n\s*-/);
  });
});

describe("chapter file", () => {
  const base = {
    n: 3,
    draft: DRAFT,
    world: makeWorld(),
    locale: "it",
    tokenStart: 100,
    tokenEnd: 200,
    premise: "Sei un sopravvissuto.",
    rules: "No magic.",
  };

  it("frontmatter carries number, world, language, tokens and refs", () => {
    const text = renderChapter(base);
    expect(text.startsWith("---")).toBe(true);
    expect(text).toContain("chapter: 3");
    expect(text).toContain("world: prova");
    expect(text).toContain("locale: it");
    expect(text).toContain('tokens: "100-200"');
    expect(text).toContain('canon_refs: ["Vault 12", "Fort Atlas"]');
  });

  it("initial context ends up inside the chapter", () => {
    const text = renderChapter(base);
    expect(text).toContain("## Initial context (never lost)");
    expect(text).toContain("Sei un sopravvissuto.");
    expect(text).toContain("No magic.");
  });

  it("events and refs have their own sections", () => {
    const text = renderChapter(base);
    expect(text).toContain("## Events");
    expect(text).toContain("- Trova del cibo in dispensa");
    expect(text).toContain("## Canon references");
    expect(text).toContain("- Vault 12");
  });

  it("introduced entities are recorded", () => {
    expect(renderChapter(base)).toContain("## Introduced entities");
  });

  it("an empty section leaves no hanging title", () => {
    const text = renderChapter({
      ...base,
      premise: "",
      rules: "",
      draft: { ...DRAFT, notableEvents: [], introducedEntities: [], canonRefs: [] },
    });
    expect(text).not.toContain("## Events");
    expect(text).not.toContain("## Canon references");
    // empty context isn't written anyway
    expect(text).not.toContain("**Premise**");
  });

  it("without a model title the chapter still has a name", () => {
    const text = renderChapter({ ...base, draft: { ...DRAFT, title: "" } });
    expect(text).toContain("# Chapter 3");
  });

  it("the file ends with a newline", () => {
    expect(renderChapter(base).endsWith("\n")).toBe(true);
  });
});
