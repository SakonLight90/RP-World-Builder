import type { CanonEntry, Era } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import { buildCanonSlice, type CanonTier, MANDATORY_TIERS } from "../src/canon/inject.js";
import { renderCanonSlice, summarizeSlice } from "../src/canon/render.js";

let counter = 0;

function entry(patch: Partial<CanonEntry> & Pick<CanonEntry, "subject" | "kind">): CanonEntry {
  counter += 1;
  return {
    id: `e${counter}`,
    worldId: "w1",
    aliases: [],
    summary: "Riassunto.",
    facts: [],
    era: "any",
    status: "active",
    priority: 10,
    tokens: 20,
    ...patch,
  };
}

const ERA_2287: Era = { key: "2287", label: "Appalachia 2287", summary: "L'epoca del gioco." };

function base(overrides: Partial<Parameters<typeof buildCanonSlice>[0]> = {}) {
  return {
    // Active era is a mandatory tier: left out by default here and checked in
    // the dedicated test, so other tests stay readable.
    activeEras: [] as Era[],
    entries: [] as CanonEntry[],
    playerText: "",
    budgetTokens: 1000,
    presentCharacterNames: [] as string[],
    locationChain: [] as CanonEntry[],
    ...overrides,
  };
}

describe("canon slice", () => {
  it("without canon produces no text", () => {
    const slice = buildCanonSlice(base());
    expect(slice.entries).toHaveLength(0);
    expect(renderCanonSlice(slice)).toBe("");
  });

  it("rules always enter, even with zero budget", () => {
    const slice = buildCanonSlice(
      base({
        entries: [entry({ subject: "Nessuna magia", kind: "rule", tokens: 500 })],
        budgetTokens: 0,
      }),
    );
    expect(slice.entries.map((e) => e.subject)).toEqual(["Nessuna magia"]);
    expect(slice.overBudget).toBe(true);
  });

  it("the search tier respects budget, mandatory tiers don't", () => {
    const entries = [
      entry({ subject: "Regola", kind: "rule", tokens: 100 }),
      entry({ subject: "A", kind: "item", tokens: 60 }),
      entry({ subject: "B", kind: "item", tokens: 60 }),
      entry({ subject: "C", kind: "item", tokens: 60 }),
    ];
    const slice = buildCanonSlice(base({ entries, budgetTokens: 220 }));

    // The rule enters and alone eats half the budget; search gets cut.
    expect(slice.entries[0]?.subject).toBe("Regola");
    expect(slice.tokens).toBeLessThanOrEqual(220);
    const search = slice.reports.find((r) => r.tier === "search");
    expect(search?.dropped).toBeGreaterThan(0);
    expect(search?.reason).toBe("budget");
    expect(slice.truncated).toBe(true);
  });

  it("tier order is rules, eras, scene, place, cited, search", () => {
    const rules = entry({ subject: "Regola", kind: "rule" });
    const present = entry({ subject: "Vera", kind: "character" });
    const place = entry({ subject: "Vault 12", kind: "location" });
    const cited = entry({ subject: "Nuka-Cola", kind: "item" });

    const slice = buildCanonSlice(
      base({
        activeEras: [ERA_2287],
        entries: [cited, place, present, rules],
        presentCharacterNames: ["vera"],
        locationChain: [place],
        playerText: "cerco una nuka-cola",
        searchLimit: 10,
        maxEntriesPerTier: 10,
      }),
    );

    expect(slice.tiers).toEqual(["rules", "eras", "present", "location", "mentioned"]);
  });
  it("an entry appears once, in its highest tier", () => {
    // A rule explicitly cited by the player must stay in the `rules` tier and
    // not appear twice in context.
    const magic = entry({
      subject: "Nessuna magia",
      kind: "rule",
      aliases: ["magia"],
    });
    const slice = buildCanonSlice(
      base({ entries: [magic], playerText: "uso la magia", maxEntriesPerTier: 10 }),
    );
    expect(slice.entries.filter((e) => e.subject === "Nessuna magia")).toHaveLength(1);
    expect(slice.tiers[0]).toBe("rules");
  });

  it("on-stage characters are recognized by alias and case-insensitively", () => {
    const vera = entry({
      subject: "Vera",
      kind: "character",
      aliases: ["la signora della bacheca"],
    });
    const slice = buildCanonSlice(
      base({ entries: [vera], presentCharacterNames: ["la signora della bacheca"] }),
    );
    expect(slice.tiers).toContain("present");
  });

  it("recognizes a subject mention with or without accents", () => {
    const city = entry({ subject: "Città della Luce", kind: "location" });
    const withAccents = buildCanonSlice(
      base({ entries: [city], playerText: "vado a città della luce" }),
    );
    expect(withAccents.tiers).toContain("mentioned");

    const without = buildCanonSlice(
      base({ entries: [city], playerText: "vado a citta della luce" }),
    );
    expect(without.tiers).toContain("mentioned");
  });

  it("in strict excludes disputed and non_canon", () => {
    const slice = buildCanonSlice(
      base({
        entries: [
          entry({ subject: "A", kind: "event" }),
          entry({ subject: "B", kind: "event", status: "disputed" }),
          entry({ subject: "C", kind: "event", status: "non_canon" }),
          entry({ subject: "D", kind: "event", status: "retconned" }),
        ],
      }),
    );
    expect(slice.entries.map((e) => e.subject).sort()).toEqual(["A", "D"]);
  });

  it("includes disputed only when requested", () => {
    const slice = buildCanonSlice(
      base({
        entries: [entry({ subject: "B", kind: "event", status: "disputed" })],
        includeDisputed: true,
      }),
    );
    expect(slice.entries).toHaveLength(1);
  });

  it("respects the per-tier entry limit", () => {
    const entries = Array.from({ length: 12 }, (_, index) =>
      entry({ subject: `Regola ${index}`, kind: "rule" }),
    );
    const slice = buildCanonSlice(base({ entries, maxEntriesPerTier: 3 }));
    const rules = slice.reports.find((r) => r.tier === "rules");
    expect(rules?.included).toBe(3);
    expect(rules?.dropped).toBe(9);
    expect(rules?.reason).toBe("limit");
  });

  it("orders by descending priority within a tier", () => {
    const slice = buildCanonSlice(
      base({
        entries: [
          entry({ subject: "Bassa", kind: "item", priority: 1 }),
          entry({ subject: "Alta", kind: "item", priority: 500 }),
          entry({ subject: "Media", kind: "item", priority: 50 }),
        ],
      }),
    );
    expect(slice.entries.map((e) => e.subject)).toEqual(["Alta", "Media", "Bassa"]);
  });

  it("active eras enter as dedicated entries and count toward budget", () => {
    const slice = buildCanonSlice(base({ activeEras: [ERA_2287] }));
    expect(slice.tiers).toEqual(["eras"]);
    expect(slice.entries[0]?.subject).toBe("Appalachia 2287");
    expect(slice.entries[0]?.tokens).toBeGreaterThan(0);
  });

  it("tier order puts eras right after rules", () => {
    const slice = buildCanonSlice(
      base({
        activeEras: [ERA_2287],
        entries: [entry({ subject: "Regola", kind: "rule" })],
      }),
    );
    expect(slice.tiers).toEqual(["rules", "eras"]);
  });

  it("the text tells the narrator why each block is there", () => {
    const rules = entry({ subject: "Nessuna magia", kind: "rule", facts: ["Niente incantesimi."] });
    const slice = buildCanonSlice(
      base({
        activeEras: [ERA_2287],
        entries: [rules, entry({ subject: "Vault 12", kind: "location" })],
        locationChain: [entry({ subject: "Vault 12", kind: "location" })],
      }),
    );
    const text = renderCanonSlice(slice);

    expect(text).toContain("## CANON");
    expect(text).toContain("ABSOLUTE WORLD RULES");
    expect(text).toContain("Nessuna magia");
    expect(text).toContain("- Niente incantesimi.");
    expect(text).toContain("ACTIVE ERA");
    expect(text.indexOf("ABSOLUTE WORLD RULES")).toBeLessThan(text.indexOf("ACTIVE ERA"));
  });

  it("superseded entries are labeled as such", () => {
    const slice = buildCanonSlice(
      base({ entries: [entry({ subject: "Vecchio fatto", kind: "event", status: "retconned" })] }),
    );
    expect(renderCanonSlice(slice)).toContain("SUPERSEDED");
  });

  it("the summary declares truncation and budget overflow", () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      entry({ subject: `Regola ${index}`, kind: "rule", tokens: 100 }),
    );
    const slice = buildCanonSlice(base({ entries, maxEntriesPerTier: 2, budgetTokens: 10 }));
    const summary = summarizeSlice(slice).join("\n");
    expect(summary).toContain("dropped 6");
    expect(summary).toContain("WARNING");
  });

  it("mandatory tiers are the declared ones", () => {
    expect(MANDATORY_TIERS).toEqual(["rules", "eras", "present", "location"]);
    const all: CanonTier[] = ["rules", "eras", "present", "location", "mentioned", "search"];
    for (const tier of all) {
      expect(MANDATORY_TIERS.includes(tier)).toBe(tier !== "mentioned" && tier !== "search");
    }
  });
});
