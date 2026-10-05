import { z } from "zod";

/**
 * Canon entry kinds. `rule` and `era` play a special role in
 * injection ranking: they are always loaded first, because the narrator
 * must know the world constraints before anything else.
 */
export const CANON_KINDS = [
  "rule",
  "era",
  "character",
  "location",
  "faction",
  "event",
  "item",
  "creature",
  "technology",
  "terminology",
] as const;

export type CanonKind = (typeof CANON_KINDS)[number];

/**
 * Editorial state of an entry.
 *
 * - `active`: currently valid facts
 * - `retconned`: the text exists but has been superseded; the label makes
 *   the narrator follow the retcon instead of the original text
 * - `disputed`: sources disagree; excluded in strict mode
 * - `non_canon`: fan material, theories, unconfirmed crossovers. Not injected
 */
export const CANON_STATUSES = ["active", "retconned", "disputed", "non_canon"] as const;

export type CanonStatus = (typeof CANON_STATUSES)[number];

/** An entry of the canon corpus, ready for retrieval. */
export interface CanonEntry {
  id: string;
  worldId: string;
  subject: string;
  kind: CanonKind;
  /** Alternatives the player uses to refer to the subject. */
  aliases: string[];
  /** Default injected text: one paragraph. */
  summary: string;
  /** Atomic facts, used by full-text search. */
  facts: string[];
  /** Era the entry applies to. `any` matches all. */
  era: string;
  status: CanonStatus;
  /** Higher is injected first, within the same tier. */
  priority: number;
  /** Approximate cost in tokens, for the slice budget. */
  tokens: number;
}

export const EraSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  startYear: z.number().int().optional(),
  endYear: z.number().int().optional(),
  summary: z.string().default(""),
});

export type Era = z.infer<typeof EraSchema>;

/** Canon entry valid only when its era is active in the world. */
export const CANON_ANY_ERA = "any";

export function isEraActive(entry: Pick<CanonEntry, "era">, activeEras: string[]): boolean {
  return entry.era === CANON_ANY_ERA || activeEras.includes(entry.era);
}

/** In strict mode, uncertain material does not enter the narrator context. */
export function isInjectable(entry: Pick<CanonEntry, "status">, includeDisputed: boolean): boolean {
  if (entry.status === "non_canon") return false;
  if (entry.status === "disputed") return includeDisputed;
  return true;
}
