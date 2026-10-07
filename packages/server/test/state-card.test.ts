import type { CanonEntry, Character, Location, World } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import { buildLexicon, detectNames, NameTracker } from "../src/canon/lexicon.js";
import { buildStateCard, filterByEra, worldBasePlace } from "../src/canon/state-card.js";
import { CreateWorldBody, UpdateWorldBody } from "../src/http/schema.js";
import { makeWorld } from "./helpers/fixtures.js";

const WORLD: World = makeWorld({
  id: "w1",
  name: "Appalachia 2287",
  slug: "appalachia-2287",
  isTemplate: true,
  templateAuthor: "amministrazione",
});

const LOCATION: Location = {
  id: "loc-v12",
  worldId: "w1",
  name: "Vault 12",
  description: "Il rifugio del livello inferiore.",
  parentId: "loc-morg",
  aliases: ["V12"],
  era: "any",
};

const PLAYER: Character = {
  id: "c-player",
  worldId: "w1",
  name: "Il sopravvissuto",
  role: "protagonista",
  description: "",
  personality: "cauto",
  secret: "",
  status: "ferito al braccio",
  locationId: "loc-v12",
  isPlayer: true,
  canonical: true,
  era: "any",
  createdAt: "2026-09-28",
};

const VERA: Character = {
  ...PLAYER,
  id: "c-vera",
  name: "Vera",
  role: "abitante",
  isPlayer: false,
  status: "",
};

function card(overrides: Partial<Parameters<typeof buildStateCard>[0]> = {}) {
  return buildStateCard({
    world: WORLD,
    currentLocation: LOCATION,
    locationAncestry: [LOCATION],
    presentCharacters: [PLAYER, VERA],
    relationships: [],
    charactersById: new Map(),
    currentChapter: null,
    activeEras: ["2287"],
    ...overrides,
  });
}

describe("state card", () => {
  it("declares where we are and who's here", () => {
    const { text } = card();
    expect(text).toContain("## STATE");
    expect(text).toContain("You are in");
    expect(text).toContain("Vault 12");
    expect(text).toContain("Vera");
    expect(text).toContain("Il sopravvissuto");
  });

  it("separates the player's character from the others present", () => {
    const { text } = card();
    expect(text).toContain("**Your character:**");
    // the others on stage are listed without the player's character
    expect(text).toContain("**With you now:** Vera");
    expect(text).not.toContain("**With you now:** Il sopravvissuto");
  });

  it("declares explicitly when nobody else is present", () => {
    const { text } = card({ presentCharacters: [PLAYER] });
    expect(text).toContain("Nobody else is present.");
  });

  it("is written in English whatever the campaign language is", () => {
    // The card and the prompt that introduces it are both English. There was a
    // per-language label map once; it is gone, and this is what stops it coming
    // back as a second language inside the same context block.
    const { text } = card({ presentCharacters: [PLAYER] });
    expect(text).toContain("## STATE");
    expect(text).toContain("You are in");
    expect(text).toContain("Nobody else is present.");
  });

  it("relationships are declared as data, not as mood", () => {
    const { text } = card({
      relationships: [
        {
          worldId: "w1",
          fromCharacterId: "c-vera",
          toCharacterId: "c-player",
          affinity: 40,
          trust: 20,
          note: "si fida del protagonista",
        },
      ],
    });
    expect(text).toContain("Known ties");
    expect(text).toContain("affinity 40");
    expect(text).toContain("trust 20");
    expect(text).toContain("si fida del protagonista");
  });

  it("relationship labels follow the language", () => {
    const { text } = card({
      relationships: [
        {
          worldId: "w1",
          fromCharacterId: "a",
          toCharacterId: "b",
          affinity: 1,
          trust: 2,
          note: "",
        },
      ],
    });
    expect(text).toContain("affinity 1");
    expect(text).toContain("trust 2");
  });

  it("cites the current chapter", () => {
    const { text } = card({ currentChapter: { n: 3, title: "Il deposito" } });
    expect(text).toContain("Last chapter");
    expect(text).toContain("3 — Il deposito");
  });

  it("without a set location the campaign starts at the world's base place", () => {
    // Not from "an unidentified place": that phrase isn't a description, it's an
    // invitation to invent a spot nobody can then correct.
    const { text } = card({ currentLocation: null, locationAncestry: [] });
    expect(text).toContain("**You are in:** Appalachia");
    expect(text).not.toContain("an unidentifiable place");
  });

  it("the current location takes precedence over the base place", () => {
    const { text } = card({ currentLocation: LOCATION, locationAncestry: [LOCATION] });
    expect(text).toContain("Vault 12");
    expect(text).not.toContain("Appalachia");
  });

  it("names the base place when there is no location", () => {
    const { text } = card({ currentLocation: null, locationAncestry: [] });
    expect(text).toContain("**You are in:** Appalachia");
    expect(text).not.toContain("unidentifiable place");
  });

  it("estimates tokens from the produced text", () => {
    const { text, tokens } = card();
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });
});

describe("era filter", () => {
  const entries: CanonEntry[] = [
    { ...baseEntry("A"), era: "any" },
    { ...baseEntry("B"), era: "2287" },
    { ...baseEntry("C"), era: "pre-war" },
  ];

  it("keeps any and the active eras", () => {
    expect(filterByEra(entries, ["2287"]).map((e) => e.subject)).toEqual(["A", "B"]);
  });

  it("without active eras nothing gets through", () => {
    expect(filterByEra(entries, [])).toHaveLength(0);
  });
});

function baseEntry(subject: string): CanonEntry {
  return {
    id: subject,
    worldId: "w1",
    subject,
    kind: "location",
    aliases: [],
    summary: "",
    facts: [],
    era: "any",
    status: "active",
    priority: 0,
    tokens: 10,
  };
}

describe("lexicon and proper names", () => {
  const lexicon = buildLexicon({
    canonSubjects: [{ id: "canon-1", subject: "Brotherhood of Steel", aliases: ["i confratelli"] }],
    characters: [{ id: "c-vera", name: "Vera" }],
    locations: [{ id: "loc-v12", name: "Vault 12", aliases: ["V12"] }],
  });

  it("builds the vocabulary from canon, cast and locations", () => {
    expect(lexicon.get("vault 12")?.kind).toBe("place");
    expect(lexicon.get("v12")?.id).toBe("loc-v12");
    expect(lexicon.get("vera")?.kind).toBe("cast");
    expect(lexicon.get("brotherhood of steel")?.kind).toBe("canon");
  });

  it("recognizes known terms regardless of their form", () => {
    const found = detectNames("Cerco i confratelli, non so se sono a V12.", lexicon);
    const keys = found.map((n) => n.key);
    expect(keys).toContain("i confratelli");
    expect(keys).toContain("v12");
    for (const name of found.filter((n) => n.known)) expect(name.confidence).toBe("high");
  });

  it("a capitalized function word isn't even hypothesized", () => {
    // "cerco" is already in the function-word list: under no circumstance is it
    // a name, so recording it as a hypothesis makes no sense either.
    const found = detectNames("Cerco i confratelli.", lexicon);
    expect(found.map((n) => n.surface)).not.toContain("Cerco");
  });

  it("flags new names cited by the narrator", () => {
    const found = detectNames("Un uomo di nome Brennan ti ha fermato.", lexicon);
    const brennan = found.find((n) => n.surface === "Brennan");
    expect(brennan?.known).toBe(false);
    expect(brennan?.kind).toBe("new");
    // introduced by "nome": trustworthy right away
    expect(brennan?.confidence).toBe("high");
  });

  it("a name after a title is high confidence", () => {
    const found = detectNames("La dottoressa Vale ti aspetta.", lexicon);
    expect(found.find((n) => n.surface === "Vale")?.confidence).toBe("high");
  });

  it("a capitalized verb stays low confidence and isn't proposed", () => {
    // In Italian almost every sentence starts with a verb: "Vesti" isn't a
    // character, and must not become a candidate on first occurrence.
    const text = "Dal corridoio Vesti una luce verde.";
    const found = detectNames(text, lexicon);
    expect(found.find((n) => n.surface === "Vesti")?.confidence).toBe("low");

    const tracker = new NameTracker();
    tracker.observe(text, lexicon);
    expect(tracker.candidates(2)).toHaveLength(0);
  });

  it("a function word doesn't end up inside the name", () => {
    // The regex joins consecutive capitals: without trimming, the name with and
    // without a leading function word become two candidates and recurrence never fires.
    const found = detectNames("Poi Brennan dice qualcosa.", lexicon);
    expect(found.map((n) => n.surface)).toContain("Brennan");
    expect(found.map((n) => n.surface)).not.toContain("Poi Brennan");
  });

  it("the name stays stable across different citations", () => {
    const tracker = new NameTracker();
    tracker.observe("Brennan arriva.", lexicon);
    tracker.observe("Poi Brennan dice qualcosa.", lexicon);
    tracker.observe("Allora Brennan si siede.", lexicon);
    const candidates = tracker.candidates(2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.key).toBe("brennan");
  });

  it("a single low-confidence citation proposes nothing", () => {
    const tracker = new NameTracker();
    tracker.observe("Brennan entra dalla porta.", lexicon);
    expect(tracker.candidates(2)).toHaveLength(0);

    tracker.observe("Brennan riparte.", lexicon);
    const candidates = tracker.candidates(2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.surface).toBe("Brennan");
    expect(candidates[0]?.mentions).toBe(2);
  });

  it("a high-confidence name is proposed on first occurrence", () => {
    const tracker = new NameTracker();
    tracker.observe("Un uomo di nome Brennan ti ha fermato.", lexicon);
    const candidates = tracker.candidates(2);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.surface).toBe("Brennan");
  });

  it("a word seen only once is never proposed", () => {
    const tracker = new NameTracker();
    tracker.observe("Qualcuno guarda la porta.", lexicon);
    // "qualcuno" is a function word: it doesn't even enter the count
    expect(tracker.size).toBe(0);
  });

  it("already known names don't feed the candidate tracker", () => {
    const tracker = new NameTracker();
    tracker.observe("Vera annuisce.", lexicon);
    tracker.observe("Vera ripete.", lexicon);
    expect(tracker.candidates(1)).toHaveLength(0);
  });

  it("promoting a name forgets it as a candidate", () => {
    const tracker = new NameTracker();
    tracker.observe("Brennan arriva.", lexicon);
    tracker.observe("Brennan resta.", lexicon);
    expect(tracker.size).toBeGreaterThan(0);
    tracker.forget("brennan");
    expect(tracker.candidates(1)).toHaveLength(0);
  });

  it("doesn't flag a name already in the canon as new", () => {
    const found = detectNames("Il Brotherhood of Steel sorveglia l'area.", lexicon);
    expect(found.some((n) => n.known && n.key.includes("brotherhood of steel"))).toBe(true);
  });

  it("doesn't duplicate when a known term sits inside a longer sequence", () => {
    const found = detectNames("V12 va in pezzi, ma il Vault 12 resta.", lexicon);
    const newOnes = found.filter((n) => !n.known).map((n) => n.surface);
    expect(newOnes).not.toContain("Vault 12 resta");
  });

  it("ignores pronouns and formulas that aren't names", () => {
    const found = detectNames("Lui disse Che Cose Fanno Gli Umani", lexicon);
    for (const name of found) {
      expect(name.surface.toLowerCase()).not.toBe("lui");
      expect(name.surface.toLowerCase()).not.toBe("gli");
    }
  });

  it("empty text produces no names", () => {
    expect(detectNames("", lexicon)).toHaveLength(0);
    expect(detectNames("   ", lexicon)).toHaveLength(0);
  });

  it("names come back in a stable order", () => {
    const text = "Brennan e Ciara, poi Vera.";
    expect(detectNames(text, lexicon).map((n) => n.key)).toEqual(
      detectNames(text, lexicon).map((n) => n.key),
    );
  });
});

/**
 * The base place is a property of the world, not a player choice.
 *
 * The state card used to say "an unidentified place" when there was no current location: the
 * narrator was free to pick a territory nobody had decided on and the canon did not contain.
 * Below are the two halves of the fix: the value derives from the world, and no request can
 * change it.
 */
describe("the world's base place", () => {
  it("derives from the world's name with the year removed", () => {
    expect(worldBasePlace(WORLD)).toBe("Appalachia");
  });

  it("a world without a name has no base place", () => {
    expect(worldBasePlace(makeWorld({ name: "   " }))).toBe("");
  });

  it("a name that's only a year stays readable", () => {
    // Better "2287" than an empty string: the narrator must be able to say where
    // we are even if the world's name is made only of the era.
    expect(worldBasePlace(makeWorld({ name: "2287" }))).toBe("2287");
  });

  it("the base place is derived, not set: no schema accepts it", () => {
    // If tomorrow someone added a field of this kind, these tests would fail:
    // this is where the constraint is written.
    const parsed = CreateWorldBody.parse({
      name: "Altro mondo",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      basePlace: "Marte",
      homeLocation: "Marte",
    });
    expect(Object.keys(parsed)).not.toContain("basePlace");
    expect(Object.keys(parsed)).not.toContain("homeLocation");

    const updated = UpdateWorldBody.parse({ basePlace: "Marte", homeLocationId: "loc-1" });
    expect(Object.keys(updated)).not.toContain("basePlace");
    expect(Object.keys(updated)).not.toContain("homeLocationId");
  });

  it("the base place doesn't depend on anything the player can change", () => {
    const base = worldBasePlace(WORLD);
    expect(worldBasePlace({ ...WORLD, name: WORLD.name })).toBe(base);
    // Changing the model or the description doesn't move the base: the base is
    // the territory, and the territory is the name.
    expect(
      worldBasePlace({ ...WORLD, model: "altro/modello", description: "testo qualsiasi" }),
    ).toBe(base);
  });
});
