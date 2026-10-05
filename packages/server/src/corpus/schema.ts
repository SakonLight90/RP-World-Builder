import { CANON_KINDS, CANON_STATUSES, type CanonEntry, EraSchema } from "@rpwb/shared";
import { z } from "zod";

/**
 * Token estimates: about four chars per token is the
 * rule of thumb. Only used for the canon slice budget, so
 * precision is not critical, but it must be stable and conservative.
 */
function tokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function estimateTokens(text: string): number {
  return tokensFromChars(text.length);
}

export function entryTokens(input: {
  summary: string;
  facts: string[];
  aliases: string[];
}): number {
  const chars =
    input.summary.length +
    input.facts.reduce((sum, fact) => sum + fact.length, 0) +
    input.aliases.join(" ").length;
  return tokensFromChars(chars);
}

export const CorpusEntrySchema = z.object({
  subject: z.string().min(1, "a canon entry needs a subject"),
  kind: z.enum(CANON_KINDS),
  era: z.string().min(1).default("any"),
  status: z.enum(CANON_STATUSES).default("active"),
  aliases: z.array(z.string()).default([]),
  summary: z.string().default(""),
  facts: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
});

export type CorpusEntryInput = z.infer<typeof CorpusEntrySchema>;

export const CorpusFileSchema = z.object({
  entries: z.array(CorpusEntrySchema).default([]),
});

export type CorpusFile = z.infer<typeof CorpusFileSchema>;

export const CorpusBibleSchema = z.object({
  premise: z.string().default(""),
  rules: z.string().default(""),
  tone: z.string().default(""),
  style: z.string().default(""),
  conventions: z.string().default(""),
});

export const CorpusWorldSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "the slug can only contain lowercase letters, numbers and dashes"),
  description: z.string().default(""),
  baseLocale: z.string().default("it"),
  isTemplate: z.boolean().default(true),
  templateAuthor: z.string().default("amministrazione"),
  bible: CorpusBibleSchema.default({
    premise: "",
    rules: "",
    tone: "",
    style: "",
    conventions: "",
  }),
  eras: z.array(EraSchema).default([]),
  /** Eras active by default: without this indication canon does not go in. */
  activeEras: z.array(z.string()).default([]),
  /**
   * Libraries the world **requires**, not ones it copies.
   *
   * A library lives outside the worlds, read-only, and can serve all the worlds
   * at once: it is the way to avoid rewriting the same story every time. The
   * world declares id, version and hash: if the library on disk changes without
   * the world updating the requirement, validation flags it instead of letting
   * the campaign derive from sources other than the declared ones.
   */
  libraries: z
    .array(
      z.object({
        id: z.string().min(1),
        version: z.string().min(1),
        /** Hash of the library's content at the time the world required it. */
        hash: z.string().default(""),
      }),
    )
    .default([]),
});

export type CorpusWorld = z.infer<typeof CorpusWorldSchema>;

export function toCanonEntry(worldId: string, input: CorpusEntryInput): CanonEntry {
  const aliases = input.aliases;
  return {
    id: crypto.randomUUID(),
    worldId,
    subject: input.subject,
    kind: input.kind,
    aliases,
    summary: input.summary,
    facts: input.facts,
    era: input.era,
    status: input.status,
    priority: input.priority,
    tokens: entryTokens({ summary: input.summary, facts: input.facts, aliases }),
  };
}
