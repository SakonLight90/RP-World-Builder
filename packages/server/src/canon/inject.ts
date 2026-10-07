import type { CanonEntry, Era } from "@rpwb/shared";

/*
 * Injection tiers, from most binding to most accessory.
 *
 * The order is not decorative: attention is not uniform, and background in front of the rules
 * means the turn rests on canon the narrator has not read yet.
 */
export const CANON_TIERS = ["rules", "eras", "present", "location", "mentioned", "search"] as const;

export type CanonTier = (typeof CANON_TIERS)[number];

/**
 * Tiers that cannot be dropped: they are the guarantee of canonicity. If the budget is not
 * enough, going over it is preferred to removing a rule, and the overrun is reported in
 * `overBudget`.
 */
export const MANDATORY_TIERS: readonly CanonTier[] = ["rules", "eras", "present", "location"];

export interface TierReport {
  tier: CanonTier;
  included: number;
  dropped: number;
  tokens: number;
  /** Why some entries were left out, for the turn's debug panel. */
  reason: "budget" | "limit" | null;
}

export interface SliceInput {
  activeEras: Era[];
  entries: CanonEntry[];
  playerText: string;
  budgetTokens: number;
  /** Canonical names of the characters on stage, for the `present` tier. */
  presentCharacterNames: string[];
  /** Canonical places of the current chain, nearest first. */
  locationChain: CanonEntry[];
  includeDisputed?: boolean;
  searchLimit?: number;
  maxEntriesPerTier?: number;
}

export interface CanonSlice {
  entries: CanonEntry[];
  /** Tier of each entry, in the same order as `entries`. */
  tiers: CanonTier[];
  reports: TierReport[];
  tokens: number;
  budgetTokens: number;
  truncated: boolean;
  overBudget: boolean;
  droppedCount: number;
}

const MAX_ENTRIES_PER_TIER = 8;
const SEARCH_LIMIT = 6;

export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Canonical identity: the same subject in two eras is two distinct entries. */
function identity(entry: CanonEntry): string {
  return `${normalize(entry.subject)}@${entry.era}`;
}

function matchesName(entry: CanonEntry, names: string[]): boolean {
  const candidates = [entry.subject, ...entry.aliases].map(normalize);
  return names.some((name) => candidates.includes(name));
}

function mentionsIn(entry: CanonEntry, text: string): boolean {
  if (text.trim() === "") return false;
  const haystack = normalize(text);
  return [entry.subject, ...entry.aliases]
    .map(normalize)
    .some((name) => name.length > 2 && haystack.includes(name));
}

function byPriority(a: CanonEntry, b: CanonEntry): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return a.subject.localeCompare(b.subject);
}

export function eraEntry(era: Era): CanonEntry {
  return {
    id: `era:${era.key}`,
    worldId: "",
    subject: era.label,
    kind: "era",
    aliases: [era.key],
    summary: era.summary,
    facts: [],
    era: era.key,
    status: "active",
    priority: 900,
    tokens: Math.ceil((era.label.length + era.summary.length) / 4),
  };
}

/** Gives each entry the highest tier it belongs to, so an entry is never repeated. */
function assignTiers(input: SliceInput): Map<CanonTier, CanonEntry[]> {
  const includeDisputed = input.includeDisputed ?? false;

  // Deduplicated here: the caller passes the full list plus the search results, so the same
  // entry arrives twice.
  const seen = new Set<string>();
  const usable = input.entries
    .filter((entry) =>
      entry.status === "disputed" ? includeDisputed : entry.status !== "non_canon",
    )
    .filter((entry) => {
      const key = identity(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(byPriority);

  const buckets: Record<CanonTier, CanonEntry[]> = {
    rules: [],
    eras: input.activeEras.map(eraEntry),
    present: [],
    location: [],
    mentioned: [],
    search: [],
  };

  const present = input.presentCharacterNames.map(normalize);
  const locationIds = new Set(input.locationChain.map((entry) => entry.id));
  const taken = new Set<string>();

  for (const tier of CANON_TIERS) {
    if (tier === "eras" || tier === "search") continue;
    for (const entry of usable) {
      const key = identity(entry);
      if (taken.has(key)) continue;
      const belongs =
        (tier === "rules" && entry.kind === "rule") ||
        (tier === "present" && matchesName(entry, present)) ||
        (tier === "location" && locationIds.has(entry.id)) ||
        (tier === "mentioned" && mentionsIn(entry, input.playerText));
      if (!belongs) continue;
      buckets[tier].push(entry);
      taken.add(key);
    }
  }

  // The catch-all channel: everything else, including the search results the caller merged in.
  buckets.search = usable.filter((entry) => !taken.has(identity(entry)));

  return new Map(Object.entries(buckets) as [CanonTier, CanonEntry[]][]);
}

/**
 * Builds the turn's canon slice.
 *
 * `entries` arrives already filtered by era and carrying the search results: only selection and
 * ordering happen here, so the same function serves the debug preview without the database.
 */
export function buildCanonSlice(input: SliceInput): CanonSlice {
  const searchLimit = input.searchLimit ?? SEARCH_LIMIT;
  const cap = input.maxEntriesPerTier ?? MAX_ENTRIES_PER_TIER;
  const buckets = assignTiers(input);

  const entries: CanonEntry[] = [];
  const tiers: CanonTier[] = [];
  const reports: TierReport[] = [];
  let tokens = 0;
  let truncated = false;
  let droppedCount = 0;

  for (const tier of CANON_TIERS) {
    const list = buckets.get(tier) ?? [];
    const mandatory = MANDATORY_TIERS.includes(tier);
    const limit = tier === "search" ? searchLimit : cap;
    const report: TierReport = { tier, included: 0, dropped: 0, tokens: 0, reason: null };

    for (const entry of list) {
      if (report.included >= limit) {
        report.dropped += 1;
        report.reason = "limit";
        droppedCount += 1;
        truncated = true;
        continue;
      }
      // A mandatory tier goes in even if it overruns: dropping a rule to respect the budget would
      // mean hiding canon.
      if (!mandatory && tokens + entry.tokens > input.budgetTokens) {
        report.dropped += 1;
        report.reason = "budget";
        droppedCount += 1;
        truncated = true;
        continue;
      }

      entries.push(entry);
      tiers.push(tier);
      report.included += 1;
      report.tokens += entry.tokens;
      tokens += entry.tokens;
    }

    reports.push(report);
  }

  return {
    entries,
    tiers,
    reports,
    tokens,
    budgetTokens: input.budgetTokens,
    truncated,
    overBudget: tokens > input.budgetTokens,
    droppedCount,
  };
}
