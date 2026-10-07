import type { CanonKind, Character, Location } from "@rpwb/shared";
import { STOPWORDS } from "../db/repo/common.js";
import { normalize } from "./inject.js";

/*
 * The narrator can name things the canon does not contain. The player promotes to canon
 * whatever they want to keep, which requires knowing *what* was quoted without the AI
 * having to say it: detection is deterministic and client-side, no model involved.
 */

export interface LexiconTerm {
  /** How it appears in the text. */
  surface: string;
  /** Normalised, for comparisons and deduplication. */
  key: string;
  kind: "canon" | "cast" | "place" | "new";
  /**
   * For `kind: "canon"`, the type of the entry the name comes from.
   *
   * `canon` says only *where from* the name comes, not *what it is*: without this a
   * `location` entry would be indistinguishable from a settlement or an event.
   */
  canonKind?: CanonKind;
  id: string;
}

export interface BuildLexiconInput {
  /**
   * The world's canon entries. `kind` is optional, and `undefined` is better than an
   * invented value.
   */
  canonSubjects: { id: string; subject: string; aliases: string[]; kind?: CanonKind }[];
  characters: Pick<Character, "id" | "name">[];
  locations: Pick<Location, "id" | "name" | "aliases">[];
}

export function buildLexicon(input: BuildLexiconInput): Map<string, LexiconTerm> {
  const terms = new Map<string, LexiconTerm>();

  const add = (
    surface: string,
    kind: LexiconTerm["kind"],
    id: string,
    canonKind?: CanonKind,
  ): void => {
    const trimmed = surface.trim();
    if (trimmed.length < 2) return;
    const key = normalize(trimmed);
    if (key === "") return;
    if (!terms.has(key)) terms.set(key, { surface: trimmed, key, kind, canonKind, id });
  };

  for (const entry of input.canonSubjects) {
    add(entry.subject, "canon", entry.id, entry.kind);
    for (const alias of entry.aliases) add(alias, "canon", entry.id, entry.kind);
  }
  for (const character of input.characters) add(character.name, "cast", character.id);
  for (const location of input.locations) {
    add(location.name, "place", location.id);
    for (const alias of location.aliases) add(alias, "place", location.id);
  }

  return terms;
}

/** The entity types promoting a name is able to create. */
export const PROMOTE_KINDS = ["character", "location", "faction", "item"] as const;

export type PromoteKind = (typeof PROMOTE_KINDS)[number];

/** What the type is called, because the refusal has to be read by someone. */
const PROMOTE_LABEL: Record<PromoteKind, string> = {
  character: "a character",
  location: "a location",
  faction: "a faction",
  item: "an item",
};

/** Which canon entry imposes which entity type. */
const CANON_PROMOTE: Partial<Record<CanonKind, PromoteKind>> = {
  character: "character",
  location: "location",
  faction: "faction",
  item: "item",
};

/**
 * What kind of entity an already known name is, or `null` when the name says nothing.
 *
 * A canon entry that is not a person, a place, a faction or an item blocks no promotion,
 * because there is no wrong type to contradict.
 */
export function promotionKindOf(term: LexiconTerm): PromoteKind | null {
  if (term.kind === "place") return "location";
  if (term.kind === "cast") return "character";
  if (term.kind !== "canon" || term.canonKind === undefined) return null;
  return CANON_PROMOTE[term.canonKind] ?? null;
}

export interface PromotionVerdict {
  /** Whether the promotion can proceed. */
  ok: boolean;
  /** Type the lexicon imposes, when the request is wrong. */
  expected: PromoteKind | null;
  /** The reason for the no. Empty string when it is fine. */
  problem: string;
}

/**
 * Decides whether a name can be promoted to the requested type.
 *
 * A place cannot become a character even if the player asks: the two are not
 * interchangeable, and a place filed as a person is then looked for among the people and
 * quoted as one.
 *
 * An unknown name passes: the narrator came up with something new and the player decides.
 */
export function decidePromotion(
  name: string,
  requested: PromoteKind,
  lexicon: Map<string, LexiconTerm>,
): PromotionVerdict {
  const surface = name.trim();
  const term = lexicon.get(normalize(surface));
  const expected = term === undefined ? null : promotionKindOf(term);
  if (expected === null || expected === requested) return { ok: true, expected, problem: "" };

  const source = term?.kind === "canon" ? "is already in the canon" : "is already registered";
  const problem =
    `"${surface}" ${source} in this world as ${PROMOTE_LABEL[expected]}: ` +
    `it cannot be promoted as ${PROMOTE_LABEL[requested]}. ` +
    `If that is what you want to keep, promote it as ${PROMOTE_LABEL[expected]}.`;
  return { ok: false, expected, problem };
}

/**
 * Substrings to avoid: partial proper nouns and set phrases that generate false positives.
 *
 * A fixed vocabulary, because here the false positive costs a piece of canon: a "known"
 * name the player cannot promote.
 */
const IGNORED = new Set([
  "io",
  "lui",
  "lei",
  "loro",
  "qualcuno",
  "qualunque",
  "chiunque",
  "niente",
  "nulla",
  "tutto",
  "tutti",
  "tutte",
  "poi",
  "quando",
  "mentre",
  "quindi",
  "perche",
  "perché",
  "dunque",
  "inoltre",
  "infine",
  "noi",
  "tu",
  "voi",
  "me",
  "te",
  "ci",
  "vi",
  "si",
  "se",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "she",
  "he",
  "they",
  "them",
  "his",
  "her",
  "their",
  "there",
  "here",
  "then",
  "than",
  "when",
  "what",
  "where",
  "who",
  "why",
]);

/** A sequence of initial capitals is a probable proper noun. */
const PROPER_NOUN =
  /\b[\p{Lu}][\p{L}\p{M}'’-]*(?:\s+(?:del|della|di|da|de|of|the)\s+[\p{Lu}][\p{L}\p{M}'’-]*|\s+[\p{Lu}][\p{L}\p{M}'’-]*){0,3}/gu;

export interface DetectedName {
  surface: string;
  key: string;
  known: boolean;
  kind: LexiconTerm["kind"] | "new";
  id: string;
  /** How reliable the proper-noun hypothesis is. `NameTracker` decides for new names. */
  confidence: NameConfidence;
}

export interface TrackedName extends DetectedName {
  mentions: number;
}

function isIgnorable(surface: string): boolean {
  const key = normalize(surface);
  if (key === "") return true;
  if (IGNORED.has(key)) return true;
  if (STOPWORDS.has(key)) return true;
  if (key.length < 3) return true;
  // Phrases and set expressions, not names.
  if (surface.split(/\s+/).length > 4) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Trims function words off the ends of a capitalised run, so a leading preposition does not
 * make it a different candidate from the bare name and the recurrence still triggers.
 */
function trimFunctionWords(surface: string): string {
  const words = surface.split(/\s+/);
  while (words.length > 1) {
    const first = normalize(words[0] ?? "");
    if (first !== "" && (IGNORED.has(first) || STOPWORDS.has(first))) words.shift();
    else break;
  }
  while (words.length > 1) {
    const last = normalize(words[words.length - 1] ?? "");
    if (last !== "" && (IGNORED.has(last) || STOPWORDS.has(last))) words.pop();
    else break;
  }
  return words.join(" ");
}

/** Words that signal a proper noun is about to arrive: "di nome", "con", "dal titolo di". */
const PRECEDING_TRIGGERS = new Set([
  "di",
  "del",
  "della",
  "delle",
  "dei",
  "degli",
  "da",
  "dal",
  "dalla",
  "dalle",
  "a",
  "al",
  "alla",
  "alle",
  "in",
  "nel",
  "nella",
  "con",
  "per",
  "presso",
  "tra",
  "fra",
  "un",
  "una",
  "uno",
  "il",
  "la",
  "lo",
  "l",
  "questo",
  "questa",
  "quel",
  "quella",
  "nome",
  "chiamato",
  "detto",
  "signor",
  "signora",
  "dottor",
  "dottoressa",
  "capitano",
  "of",
  "from",
  "to",
  "with",
  "mr",
  "mrs",
  "ms",
  "dr",
  "captain",
  "sgt",
]);

function isAfterTrigger(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const match = /(\p{L}[\p{L}\p{M}'’-]*)[\s.]*$/u.exec(before);
  const word = match?.[1];
  return word === undefined ? false : PRECEDING_TRIGGERS.has(normalize(word));
}

/**
 * A proper noun is usually followed by another entity or appositive punctuation; a verb is
 * followed by an article.
 *
 * Precision over recall: proposing a verb as a name costs the player a deletion, a missed
 * name costs nothing because it can be added by hand.
 */
function isNameLikeFollower(text: string, index: number, length: number): boolean {
  const after = text.slice(index + length);
  if (/^\s*[.,;:!?)]/.test(after)) return true;
  return /^\s+\p{Lu}/u.test(after);
}

/**
 * Confidence rather than yes/no: a high-confidence name is proposed at once, a
 * low-confidence one waits to be quoted again.
 */
function confidenceOf(text: string, index: number, surface: string): NameConfidence {
  if (isAfterTrigger(text, index)) return "high";
  if (isNameLikeFollower(text, index, surface.length)) return "high";
  // A bare capital at the start of a sentence is usually just a common word: kept, because a
  // real name recurs, at the cost of one extra quote.
  if (startsSentenceBare(text, surface)) return "low";
  return "low";
}

function startsSentenceBare(text: string, surface: string): boolean {
  if (/[.!?:;,]/.test(surface)) return false;
  const key = normalize(surface);
  if (key === "") return false;
  if (text.split(key).length - 1 > 0) return false;
  return new RegExp(`(^|[.!?]\\s+)${escapeRegExp(key)}\\b`).test(normalize(text));
}

export type NameConfidence = "high" | "low";

/**
 * Proper nouns in a text, known to the canon and the cast or new. Both are returned
 * because the interface highlights the known ones and proposes promoting the new ones.
 */
export function detectNames(text: string, lexicon: Map<string, LexiconTerm>): DetectedName[] {
  const found = new Map<string, DetectedName>();
  const lower = normalize(text);

  // Known terms first: more reliable than the capitals heuristic.
  for (const [key, term] of lexicon) {
    if (key.length < 3) continue;
    if (!lower.includes(key)) continue;
    const surface = term.surface;
    if (isIgnorable(surface)) continue;
    if (!found.has(key)) {
      found.set(key, {
        surface,
        key,
        known: true,
        kind: term.kind,
        id: term.id,
        confidence: "high",
      });
    }
  }

  for (const match of text.matchAll(PROPER_NOUN)) {
    const raw = match[0]?.trim() ?? "";
    if (raw === "") continue;
    const surface = trimFunctionWords(raw);
    const index = match.index ?? 0;
    if (surface === "" || isIgnorable(surface)) continue;
    const key = normalize(surface);
    if (found.has(key)) continue;
    // A sequence containing a known term is not a new name: it is a longer phrase built on a
    // name already found.
    if ([...found.keys()].some((existing) => key.includes(existing))) continue;
    found.set(key, {
      surface,
      key,
      known: false,
      kind: "new",
      id: "",
      confidence: confidenceOf(text, index, surface),
    });
  }

  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export type NameCandidate = TrackedName;

/**
 * Counts quotes per campaign, so a name is proposed once the evidence is there: no model
 * call and no word lists to maintain.
 */
export class NameTracker {
  readonly #counts = new Map<string, TrackedName>();

  observe(text: string, lexicon: Map<string, LexiconTerm>): DetectedName[] {
    const found = detectNames(text, lexicon);
    for (const name of found) {
      if (name.known) continue;
      const previous = this.#counts.get(name.key);
      this.#counts.set(name.key, {
        ...name,
        // A high-confidence quote counts double.
        mentions: (previous?.mentions ?? 0) + (name.confidence === "high" ? 2 : 1),
      });
    }
    return found;
  }

  /** New names whose quotes reach the threshold. Two is where the signal beats the noise. */
  candidates(minMentions = 2): NameCandidate[] {
    return [...this.#counts.values()]
      .filter((name) => name.mentions >= minMentions)
      .map((name) => ({ ...name }) as NameCandidate)
      .sort((a, b) => b.mentions - a.mentions || a.key.localeCompare(b.key));
  }

  /** After promotion to canon the name has to be forgotten as a candidate. */
  forget(key: string): void {
    this.#counts.delete(key);
  }

  get size(): number {
    return this.#counts.size;
  }
}
