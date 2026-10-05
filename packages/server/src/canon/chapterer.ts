import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterDraft, World } from "@rpwb/shared";
import { z } from "zod";
import { askJson } from "../opencode/ask.js";
import type { Narrator } from "../opencode/narrator.js";
import { asString, asStringArray, jsonInstruction } from "../opencode/structured.js";

export const ChapterDraftSchema = z.object({
  title: z.string().default(""),
  summary: z.string().default(""),
  notableEvents: z.array(z.string()).default([]),
  canonRefs: z.array(z.string()).default([]),
  introducedEntities: z.array(z.string()).default([]),
});

const CHAPTER_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title of the chapter." },
    summary: {
      type: "string",
      description: "One paragraph of what happened, in third person, without opinions.",
    },
    notableEvents: {
      type: "array",
      items: { type: "string" },
      description: "The events, one per item, each in a single line.",
    },
    canonRefs: {
      type: "array",
      items: { type: "string" },
      description:
        "The canon subjects the events cite, with the exact name used in the canon. Empty if none.",
    },
    introducedEntities: {
      type: "array",
      items: { type: "string" },
      description: "New proper nouns that appear in this chapter.",
    },
  },
  required: ["title", "summary", "notableEvents"],
};

export interface CloseChapterInput {
  narrator: Narrator;
  world: World;
  worldDir: string;
  sessionId: string;
  locale: string;
  /** Chapter number, taken from the database index. */
  chapterNumber: number;
  /** Arc the chapter belongs to, if the campaign uses arcs. */
  arcId: string | null;
  /** Initial context to put back into the chapter, so it is not lost. */
  premise: string;
  rules: string;
  canonSubjects: string[];
  /** How many recent turns to send to the chronicler. */
  recentTurns: number;
  /** Index of the chapters already written, including the one just closed. */
  chapters: ChapterSummary[];
  /**
   * Memory of the closed arcs, already compressed. If present, `chapters` must
   * not contain the chapters of those arcs: they are already inside.
   */
  arcMemory?: string;
  tokenStart: number;
  tokenEnd: number;
}

export interface ChapterSummary {
  n: number;
  title: string;
  summary: string;
}

export interface ClosedChapter {
  n: number;
  title: string;
  summary: string;
  canonRefs: string[];
  introducedEntities: string[];
  path: string;
  /** The model answered something usable. */
  ok: boolean;
  /** Failure reason, for the debug panel. */
  problem: string | null;
  /** The session to use from here on. It can change. */
  sessionId: string;
  /** How the context was recovered. */
  recovery: "revert" | "new-session" | "none";
  messagesBefore: number;
  messagesAfter: number;
}

/** How many recent chapters go into the carryover in full. */
const CARRY_FULL = 5;

export { CARRY_FULL };

const EMPTY_DRAFT: ChapterDraft = {
  title: "",
  summary: "",
  notableEvents: [],
  canonRefs: [],
  introducedEntities: [],
};

/**
 * Closes the chapter and **brings the context back to a small size**.
 *
 * The point is the second thing, not the writing. opencode's compaction
 * (`session.summarize`) turned out not to reduce at all what is sent to the
 * model: it adds a summary message and leaves the original turns, and the
 * context actually grows. Measured on opencode 1.18.7 with the same model and the
 * same turns: 1774 tokens without intervention, 2601 after compaction, that is
 * 47% more.
 *
 * So there is no trust involved: it tries to truncate with `revert` in the same
 * session, and it checks the real number of messages. If the history does not
 * go down, a new session is opened, which by definition starts empty. The
 * chapter is already on disk, so in neither case is the context lost.
 */
export async function closeChapter(input: CloseChapterInput): Promise<ClosedChapter> {
  const draft = await draftChapter(input);
  const n = input.chapterNumber;

  const content = renderChapter({
    n,
    draft,
    world: input.world,
    locale: input.locale,
    tokenStart: input.tokenStart,
    tokenEnd: input.tokenEnd,
    premise: input.premise,
    rules: input.rules,
    arcId: input.arcId,
  });

  const relative = chapterFileName(n);
  const absolute = join(input.worldDir, relative);
  await mkdir(input.worldDir, { recursive: true });
  await writeFile(absolute, content, "utf8");

  const before = await input.narrator.messages(input.sessionId);
  const beforeCount = before.length;

  let sessionId = input.sessionId;
  let recovery: ClosedChapter["recovery"] = "none";
  let afterCount = beforeCount;

  const anchor = before.find((message) => message.role === "user");
  if (anchor !== undefined) {
    const truncated = await truncateTo(input.narrator, sessionId, anchor.id, beforeCount);
    if (truncated !== null) {
      recovery = "revert";
      afterCount = truncated;
    }
  }

  if (recovery === "none") {
    // The context did not go down: a new session is the only guarantee. It is not
    // an unwanted fallback, it is the normal path on this version.
    sessionId = await input.narrator.createSession(input.world.name);
    recovery = "new-session";
    afterCount = 0;
    // The new session must never be left without a reminder: even with an empty
    // index, the chapter just written is already the campaign's memory.
    const history = historyIncluding(input.chapters, {
      n,
      title: draft.title,
      summary: draft.summary,
    });
    if (history.length === 0) {
      await reinsertPointer(input.narrator, sessionId, n, draft, input.locale);
    } else {
      await carryOver(input.narrator, sessionId, history, input.locale, input.arcMemory ?? "");
    }
  } else {
    await reinsertPointer(input.narrator, sessionId, n, draft, input.locale);
    afterCount = (await input.narrator.messages(sessionId)).length;
  }

  return {
    n,
    title: draft.title === "" ? `Chapter ${n}` : draft.title,
    summary: draft.summary,
    canonRefs: draft.canonRefs,
    introducedEntities: draft.introducedEntities,
    path: relative,
    ok: draft.title !== "" || draft.summary !== "",
    problem: null,
    sessionId,
    recovery,
    messagesBefore: beforeCount,
    messagesAfter: afterCount,
  };
}

/**
 * Truncates the session to the given message and **verifies** that it happened.
 * A `revert` that does not reduce anything counts as an error: better to know.
 */
async function truncateTo(
  narrator: Narrator,
  sessionId: string,
  messageId: string,
  beforeCount: number,
): Promise<number | null> {
  try {
    await narrator.truncateTo(sessionId, messageId);
    const after = await narrator.messages(sessionId);
    return after.length < beforeCount ? after.length : null;
  } catch {
    return null;
  }
}

/**
 * List of the chapters to carry over, with the one just written guaranteed to be
 * present and last. The caller must not remember to include it.
 */
export function historyIncluding(
  chapters: ChapterSummary[],
  current: ChapterSummary,
): ChapterSummary[] {
  const history = chapters.filter((chapter) => chapter.n < current.n);
  const title = current.title === "" ? `Chapter ${current.n}` : current.title;
  return [...history, { n: current.n, title, summary: current.summary }];
}

/**
 * Carryover text for a new session.
 *
 * The carryover is **bounded**: recent chapters go in in full, older ones only
 * as a title. Without this, a long campaign would recreate the very problem the
 * chapter was supposed to solve, moving it into the initial prompt.
 *
 * `locale` is no longer read: the text is written in English for every world.
 * It stays in the signature because the callers pass the world's language and
 * removing it would mean touching code outside this module.
 *
 * It is a pure function separate from I/O so that it can be checked without
 * starting a server and without spending a token.
 */
export function buildCarryOverText(
  chapters: ChapterSummary[],
  _locale: string,
  full = CARRY_FULL,
): string {
  const recent = chapters.slice(-full);
  const older = chapters.slice(0, Math.max(0, chapters.length - full));
  const lines: string[] = [];

  lines.push("This campaign continues. Here is what happened before, in order.");
  for (const chapter of older) lines.push(`- Chapter ${chapter.n}: ${chapter.title}`);
  for (const chapter of recent) {
    lines.push(`- Chapter ${chapter.n}: ${chapter.title}`);
    if (chapter.summary !== "") lines.push(`  ${chapter.summary}`);
  }
  lines.push("");
  lines.push("The canon and the world rules have not changed. Pick up from here.");

  return lines.join("\n");
}

/**
 * Assembles the text that is put back into a new session.
 *
 * There are two distinct blocks and they stay that way: the memory of the closed
 * arcs, which is compressed, and the index of the recent chapters, which serves
 * the last chapters still open. It is a pure function so that the result can be
 * checked without starting a server and without spending a token.
 */
export function carryOverText(
  arcMemory: string,
  chapters: ChapterSummary[],
  locale = "it",
): string {
  return [arcMemory.trim(), buildCarryOverText(chapters, locale)]
    .filter((block) => block !== "")
    .join("\n\n");
}

/**
 * Carries the story over into a new session. It costs zero output tokens: it is
 * a message with no answer.
 *
 * `arcMemory` is the already compressed memory of the closed arcs. If it comes
 * in it goes first, and the chapters hung further back are not rewritten one by
 * one: this is where an arc's ten chapters shrink to a few lines.
 */
export async function carryOver(
  narrator: Narrator,
  sessionId: string,
  chapters: ChapterSummary[],
  locale: string,
  arcMemory = "",
): Promise<void> {
  const text = carryOverText(arcMemory, chapters, locale);
  if (text === "") return;

  await narrator.prompt(sessionId, { delivery: "no-reply", text });
}

/**
 * The model writes the chapter, but on a separate, short session.
 *
 * If it were summarised in the main session the summary would pollute the very
 * context that is about to be compacted, and the next turn would already start
 * dirty. It costs one extra session, which is deleted right away.
 */
async function draftChapter(input: CloseChapterInput): Promise<ChapterDraft> {
  const transcript = await recentTranscript(input);
  if (transcript === "") return { ...EMPTY_DRAFT };

  // An unwritten chapter must not block the game: it is recorded and play goes
  // on, the missing chapter is noticed in the panel. That is why no failure is
  // propagated here, not even when `askJson` does not distinguish the causes of
  // its `null`.
  const parsed = await askJson(input.narrator, {
    sessionTitle: `chronicler ${input.world.name}`,
    modelRef: input.world.model,
    text: chroniclerPrompt(input, transcript),
  });
  if (parsed === null) return { ...EMPTY_DRAFT };

  const value = ChapterDraftSchema.safeParse(coerce(parsed));
  if (!value.success) return { ...EMPTY_DRAFT };
  return value.data;
}

function chroniclerPrompt(input: CloseChapterInput, transcript: string): string {
  return [
    "You are a chronicler. Rewrite what happened as a chapter, inventing nothing.",
    "",
    "Initial context of the campaign, which you must be able to recall:",
    input.premise.trim() === "" ? "(not available)" : input.premise.trim(),
    "",
    "World rules, which never change:",
    input.rules.trim() === "" ? "(not available)" : input.rules.trim(),
    "",
    "Canon subjects already known:",
    input.canonSubjects.length === 0 ? "(none)" : input.canonSubjects.join(", "),
    "",
    "Transcript of the recent turns:",
    "---",
    transcript,
    "---",
    "",
    "Rewrite these turns as a chapter. No commentary, no judgement, no facts " +
      "that are not in the transcript. If a proper noun appears for the first time, " +
      "put it in introducedEntities.",
    "",
    jsonInstruction(CHAPTER_SCHEMA, [input.locale]),
  ].join("\n");
}

async function recentTranscript(input: CloseChapterInput): Promise<string> {
  const messages = await input.narrator.messages(input.sessionId);
  const turns: string[] = [];
  for (const message of messages) {
    if (message.text.trim() === "") continue;
    const who = message.role === "user" ? "Player" : "Narrator";
    turns.push(`${who}: ${message.text.trim()}`);
  }
  return turns.slice(-input.recentTurns * 2).join("\n\n");
}
/**
 * After compaction the session no longer knows what just happened: the native
 * summary can be generic. The pointer to the chapter is therefore reinjected,
 * and it costs zero output tokens because it is a message with no answer.
 *
 * `locale` is no longer read, for the same reason as in `buildCarryOverText`.
 */
export async function reinsertPointer(
  narrator: Narrator,
  sessionId: string,
  chapterNumber: number,
  draft: ChapterDraft,
  _locale: string,
): Promise<void> {
  const title = draft.title === "" ? `chapter ${chapterNumber}` : draft.title;
  const body =
    `Chapter ${chapterNumber} is closed: "${title}".\n${draft.summary}\n` +
    "The canon and the world rules have not changed. If something is missing, it was not " +
    "written down, not that it does not exist.";

  await narrator.prompt(sessionId, { delivery: "no-reply", text: body });
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** The file a chapter is written to, relative to the world's folder. */
export function chapterFileName(n: number): string {
  return `chapter-${pad(n)}.md`;
}

/**
 * The name chapters had before the file pattern became English.
 *
 * Campaigns written before the rename still have their chapters on disk under
 * this name: the row in the database keeps the path it was written with, and a
 * row without a path has to be resolved by number, so the old name stays a
 * candidate when the current one is not there.
 */
export function legacyChapterFileName(n: number): string {
  return `capitolo-${pad(n)}.md`;
}

/**
 * Free models almost always send something slightly different from what was
 * asked for: a field as a string instead of a list, numbers as text. It is
 * normalised instead of failing.
 */
function coerce(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return {
    title: asString(record["title"]),
    summary: asString(record["summary"]),
    notableEvents: asStringArray(record["notableEvents"]),
    canonRefs: asStringArray(record["canonRefs"]),
    introducedEntities: asStringArray(record["introducedEntities"]),
  };
}

export function renderChapter(options: {
  n: number;
  draft: ChapterDraft;
  world: World;
  locale: string;
  tokenStart: number;
  tokenEnd: number;
  premise: string;
  rules: string;
  arcId?: string | null;
}): string {
  const front = [
    "---",
    `chapter: ${options.n}`,
    `world: ${options.world.slug}`,
    `locale: ${options.locale}`,
    `tokens: "${options.tokenStart}-${options.tokenEnd}"`,
    `arc: ${options.arcId ?? "null"}`,
    `canon_refs: [${options.draft.canonRefs.map((ref) => JSON.stringify(ref)).join(", ")}]`,
    "---",
    "",
  ].join("\n");

  const sections: string[] = [
    `# ${options.draft.title === "" ? `Chapter ${options.n}` : options.draft.title}`,
  ];

  if (options.draft.summary !== "") sections.push(options.draft.summary);
  if (options.draft.notableEvents.length > 0) {
    sections.push("## Events", ...options.draft.notableEvents.map((event) => `- ${event}`));
  }
  if (options.draft.introducedEntities.length > 0) {
    sections.push(
      "## Introduced entities",
      ...options.draft.introducedEntities.map((entity) => `- ${entity}`),
    );
  }
  if (options.draft.canonRefs.length > 0) {
    sections.push("## Canon references", ...options.draft.canonRefs.map((ref) => `- ${ref}`));
  }

  // The initial context is copied into the chapter: it is what must not be lost,
  // and a chapter with no premise is worth nothing.
  const context: string[] = ["## Initial context (never lost)"];
  if (options.premise.trim() !== "") context.push("**Premise**", options.premise.trim());
  if (options.rules.trim() !== "") context.push("**Rules**", options.rules.trim());
  sections.push(context.join("\n"));

  return `${front}\n${sections.join("\n\n")}\n`;
}
