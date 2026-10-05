import { z } from "zod";
import { askJson } from "../opencode/ask.js";
import type { Narrator } from "../opencode/narrator.js";
import { asString, asStringArray, jsonInstruction } from "../opencode/structured.js";

/**
 * The spine is token saving made concrete.
 *
 * Ten closed chapters enter the arc as **one line**. To produce it the
 * campaign is not reread: the arc chapter summaries, already short, go to the model,
 * asking to squeeze them into a paragraph saying what happened and what changed.
 *
 * The prompt runs on a separate session, like the chronicler: the arc
 * summary must not pollute the conversation about to be compacted.
 */

export const ArcSpineSchema = z.object({
  title: z.string().default(""),
  spine: z.string().default(""),
  canonRefs: z.array(z.string()).default([]),
});

const SPINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title of the arc." },
    spine: {
      type: "string",
      description:
        "A single paragraph: what happened in the arc and what changed. " +
        "No style, no commentary. It has to fit in three or four sentences.",
    },
    canonRefs: {
      type: "array",
      items: { type: "string" },
      description: "The canon subjects it cites, with the exact name used in the canon.",
    },
  },
  required: ["title", "spine"],
};

export interface ArcChapterDigest {
  n: number;
  title: string;
  summary: string;
}

export interface SpineInput {
  narrator: Narrator;
  modelRef: string;
  arcNumber: number;
  arcTitle: string;
  chapters: ArcChapterDigest[];
  locale: string;
}

export interface ArcSpine {
  title: string;
  spine: string;
  canonRefs: string[];
  ok: boolean;
}

/** Below this length compressing is not worth it: keep the text. */
const MIN_SPINE_SOURCE = 400;

export async function writeArcSpine(input: SpineInput): Promise<ArcSpine> {
  const source = input.chapters
    .map((chapter) => `- Chapter ${chapter.n} (${chapter.title}): ${chapter.summary}`)
    .join("\n");

  // With little material compression gains nothing and risks losing
  // detail: leave it as is.
  if (source.trim().length < MIN_SPINE_SOURCE) {
    return {
      title: input.arcTitle,
      spine: input.chapters
        .map((chapter) => chapter.summary)
        .filter((s) => s !== "")
        .join(" "),
      canonRefs: [],
      ok: true,
    };
  }

  // A missed spine does not block the campaign: the arc stays with its
  // chapters in the carryover, which is the fallback behavior. That is why
  // no failure is raised as an error here, even when `askJson`
  // does not tell `null` causes apart.
  const parsed = await askJson(input.narrator, {
    sessionTitle: `arc spine ${input.arcNumber}`,
    modelRef: input.modelRef,
    text: prompt(input, source),
  });
  if (parsed === null) return { title: input.arcTitle, spine: "", canonRefs: [], ok: false };

  const value = ArcSpineSchema.safeParse({
    title: asString(parsed["title"]),
    spine: asString(parsed["spine"]),
    canonRefs: asStringArray(parsed["canonRefs"]),
  });
  if (!value.success || value.data.spine === "") {
    return { title: input.arcTitle, spine: "", canonRefs: [], ok: false };
  }
  return { ...value.data, ok: true };
}

function prompt(input: SpineInput, source: string): string {
  const lines = [
    "Compress these chapters into a single paragraph saying what happened in the arc and what changed.",
    "No style, no commentary, no judgement. Three or four sentences.",
    "Do not add facts that are not in the text. Do not lose the proper nouns.",
    "",
    `Arc: ${input.arcNumber} — ${input.arcTitle}`,
    "",
    source,
    "",
    jsonInstruction(SPINE_SCHEMA, [input.locale]),
  ];
  return lines.join("\n");
}
