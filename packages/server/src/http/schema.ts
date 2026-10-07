import {
  BIBLE_SECTIONS,
  type BibleSection,
  CANON_KINDS,
  CANON_STATUSES,
  REASONING_EFFORTS,
  UI_LOCALES,
} from "@rpwb/shared";
import { z } from "zod";
import { PROMOTE_KINDS } from "../canon/lexicon.js";

/**
 * Request schemas, in a single place.
 *
 * Validating at the edge: below nobody checks whether a field exists, and an error
 * reaches the client with a useful message instead of an `undefined` travelling through
 * three functions.
 */

export const CreateWorldBody = z.object({
  name: z.string().min(1).max(120),
  model: z.string().min(1),
  smallModel: z.string().min(1),
  contextLimit: z.number().int().min(1_000).max(10_000_000).nullable().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).default("default"),
  baseLocale: z.string().min(2).max(16).default("it"),
  description: z.string().max(4000).default(""),
  /** Start from a pregenerated world instead of creating an empty one. */
  fromTemplate: z.string().optional(),
});

export const PlayerBody = z.object({
  name: z.string().max(120).default(""),
  description: z.string().max(4000).default(""),
  role: z.string().max(200).default(""),
});

export const UpdateWorldBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  model: z.string().min(1).optional(),
  smallModel: z.string().min(1).optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  activeLocale: z.string().min(2).max(16).optional(),
  /**
   * The player's context window in tokens, or null to ask the provider.
   * Capped at ten million: past that the chapter closes before the first turn, so the
   * number is a typo rather than a plan.
   */
  contextLimit: z.number().int().min(1_000).max(10_000_000).nullable().optional(),
  chapterThresholdRatio: z.number().min(0.1).max(0.95).optional(),
  canonBudgetRatio: z.number().min(0.05).max(0.6).optional(),
  /** The player's character, on the same update route: it is a property of the world. */
  player: PlayerBody.optional(),
});

/**
 * The choice of how the campaign begins.
 *
 * `null` is a real value: unselecting puts the world back to waiting for a choice, and
 * an absent field leaves the selection alone.
 */
export const SelectStartBody = z.object({
  startId: z.string().min(1).nullable(),
});

export const BibleBody = z.object({
  section: z.enum(BIBLE_SECTIONS) as unknown as z.ZodType<BibleSection>,
  body: z.string().max(20_000),
});

export const EraBody = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  startYear: z.number().int().optional(),
  endYear: z.number().int().optional(),
  summary: z.string().max(4000).default(""),
});

export const CharacterBody = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(200).default(""),
  description: z.string().max(8000).default(""),
  personality: z.string().max(4000).default(""),
  secret: z.string().max(4000).default(""),
  status: z.string().max(500).default(""),
  locationId: z.string().nullable().default(null),
  isPlayer: z.boolean().default(false),
  canonical: z.boolean().default(true),
  era: z.string().max(64).default("any"),
});

export const LocationBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(8000).default(""),
  parentId: z.string().nullable().default(null),
  aliases: z.array(z.string().max(120)).max(20).default([]),
  era: z.string().max(64).default("any"),
});

export const RelationshipBody = z.object({
  fromCharacterId: z.string().min(1),
  toCharacterId: z.string().min(1),
  affinity: z.number().int().min(-100).max(100).default(0),
  trust: z.number().int().min(-100).max(100).default(0),
  note: z.string().max(2000).default(""),
});

/** A relationship's two ends, and nothing else: deleting validates no values. */
export const RelationshipDeleteBody = z.object({
  fromCharacterId: z.string().min(1),
  toCharacterId: z.string().min(1),
});

export const ArcBody = z.object({
  title: z.string().min(1).max(160),
  logline: z.string().max(1000).default(""),
  firstChapter: z.number().int().min(1).default(1),
});

/*
 * Closing an arc.
 *
 * The spine is required and has no default: closing an arc without saying
 * what happened would leave an empty memory where the carryover expects the
 * summary, and compressed chapters would vanish without a trace.
 */
export const ArcCloseBody = z.object({
  spine: z.string().min(1).max(8000),
  title: z.string().max(160).optional(),
  canonRefs: z.array(z.string().max(200)).max(50).optional(),
});

export const TurnBody = z.object({
  text: z.string().min(1).max(20_000),
  locale: z.string().min(2).max(16).default("it"),
  locationId: z.string().nullable().default(null),
  /** A narrator request, not a player line: it does not enter the chat. */
  silent: z.boolean().default(false),
});

export const PromoteBody = z.object({
  name: z.string().min(1).max(120),
  /**
   * Required, with no default.
   *
   * A default chooses for the player, and a wrong guess fails invisibly: the row
   * goes in and looks right. Whoever promotes declares the kind, and a missing one is
   * rejected instead.
   */
  kind: z.enum(PROMOTE_KINDS),
  role: z.string().max(200).default(""),
  description: z.string().max(4000).default(""),
  personality: z.string().max(2000).default(""),
  locationId: z.string().nullable().default(null),
  era: z.string().max(64).default("any"),
});

export const VerifyBody = z.object({
  chapterId: z.string().nullable().default(null),
  locale: z.string().min(2).max(16).default("it"),
});

/*
 * Editing a canon entry.
 *
 * All fields optional with no defaults: a correction zeroing a field does not know what
 * to put there, and a default would write an empty string on every single-field save.
 * The route completes the existing entry with what arrives, so "not sent" and
 * "deliberately emptied" stay two things.
 */
export const CanonEditBody = z.object({
  subject: z.string().min(1).max(200).optional(),
  kind: z.enum(CANON_KINDS).optional(),
  aliases: z.array(z.string().min(1).max(200)).max(50).optional(),
  summary: z.string().max(8000).optional(),
  facts: z.array(z.string().min(1).max(2000)).max(100).optional(),
  era: z.string().max(64).optional(),
  status: z.enum(CANON_STATUSES).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  tokens: z.number().int().min(0).max(100000).optional(),
});

/** Why it is corrected. Optional but saved: in six months it matters more than the value. */
export const CanonDeleteBody = z.object({
  reason: z.string().max(1000).default(""),
});

/*
 * Settings editable at runtime.
 *
 * Only these: port, host and data folder are read at startup and the server has
 * already bound the old values, so changing them without a restart would be a lie.
 */
export const SettingsBody = z
  .object({
    uiLocale: z.enum(UI_LOCALES).optional(),
    preferredModel: z.string().max(200).nullable().optional(),
    preferredSmallModel: z.string().max(200).nullable().optional(),
    setupCompleted: z.boolean().optional(),
  })
  // Strict, not permissive: a silently ignored key suggests something was saved that
  // was not.
  .strict();

/*
 * `TurnRequest` and `Reasoning` used to live here, aliases of two types already living in
 * `@rpwb/shared` (`TurnRequestSchema` and `ReasoningEffort`) describing the
 * same concept with different names. Neither alias had an importer.
 * Removed: two definitions of a single thing can diverge, and when one of
 * the two is finally used nobody knows which one is right.
 */
