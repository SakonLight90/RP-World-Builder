import { CANON_VERDICTS, type CanonVerdict, type Chapter, type World } from "@rpwb/shared";
import { z } from "zod";
import { askJson } from "../opencode/ask.js";
import type { Narrator } from "../opencode/narrator.js";
import { asString, jsonInstruction } from "../opencode/structured.js";
import { chapterFileName, legacyChapterFileName } from "./chapterer.js";

/**
 * Canon check: did the narrator say something the canon does not
 * support?
 *
 * It is not part of the turn and does not fix it. It is a check the player
 * asks for when convenient, answering with a list of claims to
 * review. It exists because fidelity to a world with pre-existing lore is a
 * promise: here it becomes something displayable.
 *
 * Judgment always comes from a model, so it is a reasoned opinion, not a
 * formal check. The player must be told, which is why each entry carries the
 * canon entry it rests on.
 */

const VerdictSchema = z.object({
  claim: z.string().default(""),
  verdict: z.enum(CANON_VERDICTS).default("unsupported"),
  canonRef: z.string().default(""),
  suggestion: z.string().default(""),
});

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: {
            type: "string",
            description: "The narrator's claim, in one sentence.",
          },
          verdict: {
            type: "string",
            enum: CANON_VERDICTS,
            description:
              "canon = supported by the canon; unsupported = plausible but the canon " +
              "does not state it; contradiction = the canon denies it; " +
              "retcon_aware = the text follows a retcon and not the previous version.",
          },
          canonRef: {
            type: "string",
            description: "The canon entry it rests on, or an empty string.",
          },
          suggestion: {
            type: "string",
            description: "How to fix it in-fiction, in one line. Empty string if it is fine.",
          },
        },
        required: ["claim", "verdict"],
      },
    },
  },
  required: ["findings"],
};

export interface CanonFinding {
  chapterN: number | null;
  claim: string;
  verdict: CanonVerdict;
  canonRef: string;
  suggestion: string;
}

export interface VerifyInput {
  narrator: Narrator;
  world: World;
  chapters: Chapter[];
  locale: string;
  /** How many chapters to check. The last ones are what the player remembers. */
  limit?: number;
}

/** Below this length there is nothing to judge. */
const MIN_TEXT = 200;

export async function verifyCanon(input: VerifyInput): Promise<CanonFinding[]> {
  const chapters = input.chapters.slice(-(input.limit ?? 3));
  const findings: CanonFinding[] = [];

  for (const chapter of chapters) {
    const text = await readChapter(input, chapter);
    if (text.trim().length < MIN_TEXT) continue;

    const result = await judge(input, chapter, text);
    findings.push(...result);
  }

  return findings;
}

async function judge(input: VerifyInput, chapter: Chapter, text: string): Promise<CanonFinding[]> {
  // A failing check must not stop the game: return
  // what could be judged. That is why an `askJson` returning `null`
  // and a `catch` swallowing an error are the same thing from here.
  const parsed = await askJson(input.narrator, {
    sessionTitle: `verify ${chapter.n}`,
    modelRef: input.world.model,
    text: prompt(input, chapter, text),
  });
  if (parsed === null) return [];

  const raw = parsed["findings"];
  if (!Array.isArray(raw)) return [];

  const out: CanonFinding[] = [];
  for (const item of raw) {
    const value = VerdictSchema.safeParse({
      claim: asString((item as Record<string, unknown>)["claim"]),
      verdict: asString((item as Record<string, unknown>)["verdict"], "unsupported"),
      canonRef: asString((item as Record<string, unknown>)["canonRef"]),
      suggestion: asString((item as Record<string, unknown>)["suggestion"]),
    });
    if (!value.success) continue;
    if (value.data.claim === "") continue;
    out.push({ chapterN: chapter.n, ...value.data });
  }
  return out;
}

/**
 * The chapter's text, falling back to the summary when the file is not there.
 *
 * The declared path comes first, because it is the one the chapter was written
 * with. The two names by number come next, so a campaign written before the file
 * pattern became English is still judged on its chapters and not on the summary:
 * the fallback to the summary is silent, and judging a summary produces findings
 * that have nothing to do with what was narrated.
 */
async function readChapter(input: VerifyInput, chapter: Chapter): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const candidates = [chapter.path, chapterFileName(chapter.n), legacyChapterFileName(chapter.n)];
  for (const relative of candidates) {
    try {
      return await readFile(join(input.world.opencodeDir, relative), "utf8");
    } catch {
      // try the next candidate
    }
  }
  return chapter.summary;
}

function prompt(input: VerifyInput, chapter: Chapter, text: string): string {
  const lines = [
    "You are a canon reviewer. You check whether what was narrated is " +
      "supported by the world's canon.",
    "",
    "The canon is the truth. A fact the canon does not contain is not false, it is " +
      "unverified: report it as unsupported, not as contradiction.",
    "Do not report as a problem the things the chapter does not claim, and do not " +
      "try to correct the prose: only fidelity is judged here.",
    "If there is nothing to report, return an empty list. That is a correct answer " +
      "and is preferable to a list full of useless observations.",
    "",
    `World: ${input.world.name} (${input.world.slug})`,
    `Chapter: ${chapter.n} — ${chapter.title}`,
    `Canon references of the chapter: ${chapter.canonRefs.join(", ") || "(none)"}`,
    "",
    "Chapter text:",
    "---",
    text,
    "---",
    "",
    jsonInstruction(VERDICT_SCHEMA, [input.locale]),
  ];
  return lines.join("\n");
}
