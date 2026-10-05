import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function toInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function toStr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function toStrOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string" || value === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function stringify(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Italian and English function words: without this filter a sentence like
 * "vado avanti e apro la porta" yields an FTS5 query full of terms that
 * tell nothing apart and drown the truly relevant canon facts.
 *
 * It also includes the most frequent first-person verb forms of the narrator,
 * which in roleplay saturate every sentence without carrying signal.
 *
 * Also exported for proper-name recognition: a word carrying no
 * search signal must not be proposed to the player
 * as a new canon name either.
 */
export const STOPWORDS = new Set([
  "a",
  "ad",
  "al",
  "alla",
  "alle",
  "allo",
  "anche",
  "ancora",
  "avere",
  "chi",
  "come",
  "con",
  "cosa",
  "cui",
  "da",
  "del",
  "della",
  "delle",
  "dello",
  "di",
  "dove",
  "e",
  "ed",
  "ecco",
  "gli",
  "ha",
  "hanno",
  "ho",
  "i",
  "il",
  "in",
  "io",
  "la",
  "le",
  "lei",
  "lo",
  "loro",
  "ma",
  "me",
  "mi",
  "mia",
  "mio",
  "molto",
  "ne",
  "nel",
  "nella",
  "no",
  "non",
  "nostro",
  "o",
  "oppure",
  "per",
  "perche",
  "perché",
  "pero",
  "però",
  "piu",
  "più",
  "poi",
  "posso",
  "prima",
  "qua",
  "quale",
  "quando",
  "quello",
  "questa",
  "queste",
  "questi",
  "questo",
  "se",
  "sei",
  "senza",
  "si",
  "sono",
  "sopra",
  "sotto",
  "sta",
  "stato",
  "su",
  "sul",
  "sulla",
  "tra",
  "tu",
  "tua",
  "tuo",
  "un",
  "una",
  "uno",
  "va",
  "voi",
  "vostra",
  "apro",
  "apri",
  "avanti",
  "avr",
  "cambia",
  "cambio",
  "cerco",
  "cerca",
  "chiedo",
  "chiedi",
  "devo",
  "dice",
  "dico",
  "dopo",
  "dovevo",
  "entra",
  "entro",
  "esci",
  "faccio",
  "fai",
  "guardo",
  "guarda",
  "porta",
  "prendo",
  "prendi",
  "provo",
  "racconto",
  "salgo",
  "scendo",
  "so",
  "sento",
  "sono",
  "torno",
  "trovo",
  "uso",
  "usi",
  "usano",
  "vado",
  "vai",
  "vanno",
  "vedere",
  "vedo",
  "vengo",
  "vuoi",
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "you",
  "are",
  "was",
  "were",
  "have",
  "has",
  "not",
  "but",
  "they",
  "them",
  "from",
  "what",
  "which",
  "there",
  "their",
  "will",
  "would",
  "come",
  "came",
  "going",
  "went",
  "look",
  "know",
  "think",
  "want",
  "give",
  "take",
  "tell",
]);

/**
 * Extracts the meaningful terms from the raw player text.
 *
 * No need to parse the sentence: FTS5 tokenizes on its own. Terms are
 * still quoted and joined with OR, because a raw inserted term
 * may hold operators (`AND`, `*`, `:`, `-`) that would fail MATCH with
 * a syntax error on any sentence.
 */
export function extractTerms(text: string, maxTokens = 24): string[] {
  const matches = text.toLowerCase().matchAll(/[\p{L}\p{N}]{2,}/gu);
  const terms: string[] = [];

  for (const match of matches) {
    const term = match[0];
    if (term === undefined) continue;
    if (STOPWORDS.has(term)) continue;
    if (!terms.includes(term)) terms.push(term);
    if (terms.length >= maxTokens) break;
  }

  return terms;
}

export function buildFtsQueryFromTerms(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(" OR ");
}

export function buildFtsQuery(text: string, maxTokens = 24): string | null {
  return buildFtsQueryFromTerms(extractTerms(text, maxTokens));
}
