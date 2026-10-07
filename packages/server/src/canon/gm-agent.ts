import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { World } from "@rpwb/shared";
import { BIBLE_SECTIONS, DEFAULT_REASONING_EFFORT, localeName } from "@rpwb/shared";

/**
 * The narrator is an opencode agent with everything **denied**.
 *
 * It needs no tools: the canon and the state arrive injected on every turn, so no
 * permission means no way to alter the canon or the campaign's context.
 *
 * The frontmatter is generated as YAML rather than hand-written: a world name with a
 * colon or an apostrophe is an escaping bug in a template string.
 */

export interface GeneratedAgent {
  path: string;
  content: string;
}

const FRONTMATTER_MARKER = "__FRONTMATTER__";
const BIBLE_MARKER = "__BIBLE__";
const LIBRARIES_MARKER = "__LIBRARIES__";
const LANGUAGE_MARKER = "__LANGUAGE__";

/** JSON quoting: produces a valid YAML string even with special characters. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * The narrator's permissions.
 *
 * Everything denied by default. Reading the declared library folders is the only
 * exception, and `external_directory` is what confines it.
 *
 * Two things opencode does that are not obvious and that the rules here depend on:
 *
 * * `grep` and `glob` are matched against the searched string and the pattern, never
 *   against a path, so they cannot be scoped per folder. They are allowed outright and
 *   `external_directory` decides which files are reachable.
 * * A path is compared in several forms: with the drive letter by
 *   `external_directory`, without it by the tools that normalise the path, and with
 *   both separators. One wrong form means the library looks granted and is not
 *   reachable, so each folder is declared in all of them.
 *
 * `edit` stays denied inside the library too: it is a requirement with a hash, and
 * writing to it would invalidate that hash. An allowed `external_directory` also
 * inherits the workspace defaults, where `read` is allowed, so `edit` must be denied
 * explicitly.
 */
function permissionBlock(readableRoots: string[]): string[] {
  const lines = ["permission:", '  "*": deny'];

  // With no library nothing is opened, not even reading.
  if (readableRoots.length === 0) {
    lines.push("  # no library required: everything stays denied");
    lines.push("  read: deny");
    lines.push("  glob: deny");
    lines.push("  grep: deny");
    lines.push("  edit: deny");
    lines.push("  bash: deny");
    lines.push("  webfetch: deny");
    lines.push("  websearch: deny");
    lines.push("  task: deny");
    return lines;
  }

  // Every comparison form, sorted so the file does not change for nothing.
  const patterns = readableRoots.flatMap((dir) => {
    const posix = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    const stripped = posix.replace(/^[A-Za-z]:/, "");
    return [...new Set([`${posix}/**`, `${stripped}/**`, `${stripped.replace(/\//g, "\\")}\\**`])]
      .sort()
      .map((p) => `    ${yamlString(p)}: allow`);
  });

  // Cannot be scoped by path: `external_directory` below does that.
  lines.push("  read: allow");
  lines.push("  glob: allow");
  lines.push("  grep: allow");

  lines.push("  # the library is a requirement with a hash: it is read, never written");
  lines.push("  edit:");
  lines.push('    "*": deny');
  lines.push("  bash: deny");
  lines.push("  webfetch: deny");
  lines.push("  websearch: deny");
  lines.push("  task: deny");
  lines.push("  external_directory:");
  lines.push('    "*": deny');
  lines.push(...patterns);

  return lines;
}
function frontmatter(world: World, readableRoots: string[]): string {
  const lines = [
    "---",
    `description: ${yamlString(`Campaign narrator for ${world.name}`)}`,
    "mode: primary",
    `model: ${yamlString(world.model)}`,
    "temperature: 0.85",
    // Steps count for every tool call, not only the writing. Raising this does not
    // make stories longer; it lets the searches the narrator does before writing
    // finish.
    "steps: 24",
  ];

  // "default" means asking for nothing: some providers read
  // `reasoningEffort: default` as the lowest explicit level.
  if (world.reasoningEffort !== DEFAULT_REASONING_EFFORT) {
    lines.push(`reasoningEffort: ${yamlString(world.reasoningEffort)}`);
  }

  lines.push(...permissionBlock(readableRoots));
  lines.push("---");
  return lines.join("\n");
}

/** The Bible in the agent, so it survives compaction. */
function bibleBlock(bible: Record<string, string>): string {
  return BIBLE_SECTIONS.map((section) => {
    const body = bible[section]?.trim() ?? "";
    if (body === "") return "";
    return [`## ${section.toUpperCase()}`, "", body].join("\n");
  })
    .filter((block) => block !== "")
    .join("\n\n");
}

/**
 * The chosen start, told to the narrator.
 *
 * In the agent and not only in the transcript, for the reason the Bible is here: once
 * the session is compacted the opening message is far away, and a narrator asked to
 * continue a story it cannot see the beginning of invents a different one.
 */
function startBlock(world: World): string {
  const starts = world.starts;
  if (starts.selectedId === null) return "";
  const selected = starts.list.find((entry) => entry.id === starts.selectedId);
  // A selection naming nothing, or a start with no narration, is a state `toStarts`
  // already refuses to produce.
  if (selected === undefined || selected.narration.trim() === "") return "";
  return [
    "## THE OPENING OF THIS CAMPAIGN",
    "",
    `The player chose to begin in ${selected.name}. This is where the story starts, and it is`,
    "the first thing they read:",
    "",
    selected.narration,
    "",
    "The player is not the protagonist of this game unless they say so. Treat the opening",
    "above as the situation they wake up into, not as a role they were assigned: whoever they",
    "decide to be is theirs, and if they decide to be somebody who is not in the scenario,",
    "that is the character you write.",
  ].join("\n");
}

/**
 * The narrator's writing language, stated in words.
 *
 * It has to be stated: a language code sent as such arrives as a code, not as a
 * direction. In the agent, so it survives compaction.
 */
function languageName(world: World): string {
  return localeName(world.activeLocale);
}

/** The same declaration, for a template that has no placeholder. */
function languageParagraph(language: string): string {
  return [
    "## The language",
    "",
    `This world is written in ${language}: use the spelling and the grammar of whoever`,
    `writes in ${language}, not a mix with those of another language you happen to`,
    "know better.",
    "The reference material you read is in English: take the facts from it and",
    "write in",
    `${language}. Canon proper nouns are never translated: if the canon says`,
    "`Brotherhood of Steel`, you write `Brotherhood of Steel`.",
  ].join("\n");
}

export interface AgentLibraries {
  /** Absolute paths that can be opened for reading. */
  readableRoots: string[];
  /** Index to put in the prompt. Empty string if there are no libraries. */
  index: string;
}

export const NO_LIBRARIES: AgentLibraries = { readableRoots: [], index: "" };

export function renderAgent(
  world: World,
  bible: Record<string, string>,
  template: string,
  libraries: AgentLibraries = NO_LIBRARIES,
): string {
  if (!template.includes(FRONTMATTER_MARKER) || !template.includes(BIBLE_MARKER)) {
    throw new Error(`The narrator template must contain ${FRONTMATTER_MARKER} and ${BIBLE_MARKER}`);
  }

  const language = languageName(world);

  // Once: `startBlock` walks the starts, and calling it twice would walk them twice.
  const opening = startBlock(world);

  let rendered = template
    .replace(FRONTMATTER_MARKER, () => frontmatter(world, libraries.readableRoots))
    .replace(BIBLE_MARKER, () => bibleBlock(bible))
    // Appended rather than a placeholder: requiring one would make every template
    // written before this feature fail the check above.
    .concat(opening === "" ? "" : `\n\n${opening}\n`);

  // Read before replacing: afterwards there is nothing left to ask.
  const hasLibraries = rendered.includes(LIBRARIES_MARKER);
  const hasLanguage = rendered.includes(LANGUAGE_MARKER);

  // Every occurrence: the spelling rule mentions the language more than once. A
  // function and not a string, because `$` in the language name would mean something.
  rendered = rendered.replaceAll(LANGUAGE_MARKER, () => language);

  const extra: string[] = [];

  // Appended when the template has no placeholder, so a template written before
  // this mechanism does not stop passing the library to the narrator.
  if (hasLibraries) {
    rendered = rendered.replace(LIBRARIES_MARKER, () => libraries.index);
  } else {
    extra.push(libraries.index);
  }

  if (!hasLanguage) extra.push(languageParagraph(language));

  const tail = extra.filter((block) => block.trim() !== "").join("\n\n");
  return tail === "" ? rendered : `${rendered.trimEnd()}\n\n${tail}\n`;
}

/**
 * Writes the agent's file only if it changed.
 *
 * Must be called before starting that world's opencode server: opencode registers
 * agents at boot by reading `.opencode/agents/`, and a server started without the
 * file does not know `gm`, so every prompt with `agent: "gm"` fails with a generic
 * error. Comparing before writing avoids touching the file while opencode reads it.
 */
export async function ensureAgentFile(
  worldDir: string,
  world: World,
  bible: Record<string, string>,
  template: string,
  libraries: AgentLibraries = NO_LIBRARIES,
): Promise<void> {
  const content = renderAgent(world, bible, template, libraries);
  const path = join(worldDir, ".opencode", "agents", "gm.md");
  try {
    if ((await readFile(path, "utf8")) === content) return;
  } catch {
    // The file is not there yet: that is the normal case on the first run.
  }
  await writeAgentFile(worldDir, world, bible, template, libraries);
}

export async function writeAgentFile(
  worldDir: string,
  world: World,
  bible: Record<string, string>,
  template: string,
  libraries: AgentLibraries = NO_LIBRARIES,
): Promise<GeneratedAgent> {
  const content = renderAgent(world, bible, template, libraries);
  const agentsDir = join(worldDir, ".opencode", "agents");
  await mkdir(agentsDir, { recursive: true });

  const path = join(agentsDir, "gm.md");
  await writeFile(path, content, "utf8");
  return { path, content };
}

/** The prompt as a file, so it stays readable and diffable. */
export function promptSourcePath(): string {
  const override = process.env.RPWB_PROMPTS_DIR;
  if (override !== undefined && override !== "") return join(override, "gm.md");
  // In a compiled build the file sits next to dist/../.. of the source.
  return join(import.meta.dirname, "..", "..", "prompts", "gm.md");
}

export async function loadTemplate(): Promise<string> {
  const path = promptSourcePath();
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Narrator prompt not found in ${path}. ` +
        "Set RPWB_PROMPTS_DIR or run from the repository root.",
    );
  }
}
