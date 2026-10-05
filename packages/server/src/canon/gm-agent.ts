import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { World } from "@rpwb/shared";
import { BIBLE_SECTIONS, DEFAULT_REASONING_EFFORT, localeName } from "@rpwb/shared";

/**
 * The narrator is an opencode agent, but an agent to which everything is
 * **denied**.
 *
 * It does not need tools: the canon and the state already arrive injected on
 * every turn. That is not a simplification, it is a guarantee: no permission, no
 * filesystem access, no possibility, real or perceived, of altering the canon or
 * the context of the campaign.
 *
 * The frontmatter is generated and not written by hand: it is code producing
 * YAML, and YAML inside a template string is the classic source of escaping bugs
 * when a world name contains a colon or an apostrophe.
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
 * The default stays **everything denied**: no writing, no shell, no network. It
 * is the base guarantee, and it is not weakened to make something work.
 *
 * On the lore library exactly one thing is opened, and read-only: `read`, `glob`
 * and `grep` inside the folders the world has declared as a requirement. The
 * rules are in worst-to-best order because opencode applies **the last matching
 * rule**: the generic `"*": deny` has to come first, otherwise it is never
 * beaten.
 *
 * `edit` stays denied even inside the library, for two reasons. The first is that
 * the library is a requirement declared with a hash: if the narrator could write
 * to it, the hash would no longer match and validation would start reporting
 * drift caused by it. The second is that opencode's docs warn that an allowed
 * `external_directory` *inherits the workspace defaults, and `read` is `allow` by
 * default: without an explicit `edit`, opening reading would also open writing.
 * That is the kind of flaw you do not notice until something has already been
 * ruined.
 */
/**
 * The forms a path has to be written in for opencode to recognise it.
 *
 * This is not fussiness: it is the result of reading the logs of permission
 * decisions. opencode evaluates `read`, `glob` and `grep` against the path
 * **without the drive letter** and with **backslashes**, while
 * `external_directory` compares it with the full path. A pattern written only in
 * the "absolute with slashes" form is evaluated, finds no match, and falls through
 * to `"*": deny`: the log shows `action.pattern=* action.action=deny` and the
 * agent gets a refusal before it even starts.
 *
 * So every folder is declared in all the forms opencode compares. They are
 * redundant strings, but each one covers a real comparison, and a single wrong
 * one means the narrator can read nothing while seeming able to.
 */
/**
 * The narrator's permissions.
 *
 * The default stays **everything denied** for whatever can cause damage: no
 * writing, no shell, no network, no subagent. Reading is the only exception, and
 * it is confined by `external_directory`.
 *
 * `external_directory` is the real gate on paths, and it is where the obvious
 * mistake is the other one. opencode evaluates:
 *
 * - `read` against the file's path, without the drive letter;
 * - `grep` against **the searched string** ("Mojave"), not against a path;
 * - `glob` against **the pattern** ("**\/*"), not against a path.
 *
 * So `grep` and `glob` cannot be scoped per folder: no path pattern will ever let
 * them through. Writing ".../lore/fallout/**: allow" under `grep` is a rule that
 * cannot match, and the call falls through to "*": deny. The documentation says so
 * ("grep - content search (matches the regex pattern)") and the logs confirm it
 * line by line.
 *
 * But the same documentation says that `external_directory` "applies to any tool
 * that takes a path as input (for example read, edit, glob, grep)". So that is
 * where *which files* are reachable is confined, and `grep`/`glob` only decide
 * *whether the call goes out*. The two things combine: call allowed, but only
 * inside the requirement's folders.
 *
 * `edit` stays denied even inside the library because it is a requirement with a
 * hash: if the narrator could write to it, the hash would stop meaning anything.
 * It also holds because an allowed `external_directory` inherits the workspace
 * defaults, where `read` is `allow` by default: without an explicit `edit`,
 * opening reading would also open writing.
 */
function permissionBlock(readableRoots: string[]): string[] {
  const lines = ["permission:", '  "*": deny'];

  // With no library nothing is opened, not even for reading: the narrator stays
  // with what reaches it in the context.
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

  // The path has to be declared in the forms opencode compares: with the drive
  // letter for `external_directory`, without it for the tools that normalise the
  // path, and with both separators. A single wrong form means the library looks
  // granted and is not reachable.
  const patterns = readableRoots.flatMap((dir) => {
    const posix = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    const stripped = posix.replace(/^[A-Za-z]:/, "");
    return [...new Set([`${posix}/**`, `${stripped}/**`, `${stripped.replace(/\//g, "\\")}\\**`])]
      .sort()
      .map((p) => `    ${yamlString(p)}: allow`);
  });

  // Allowed without a scope: `external_directory` below decides what is really
  // reachable, and they cannot be scoped by path.
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
    // Steps count for **everything**, not just the writing: every `grep` and every
    // `read` consumes one. With the low ceiling we had, a turn in which the
    // narrator has to consult the library ends halfway through the search and
    // answers "step limit reached" instead of narrating. The number is the safety
    // ceiling behind the chapterer, not a writing budget: raising it does not make
    // stories longer, it only lets the searches the narrator has to do before
    // writing finish.
    "steps: 24",
  ];

  // "default" means asking for nothing: the model is left at its base behaviour.
  // Writing `reasoningEffort: default` would be different, because some providers
  // read it as the lowest explicit level instead of as "no request". Reasoning
  // power is only asked for when it was chosen, and it is paid for.
  if (world.reasoningEffort !== DEFAULT_REASONING_EFFORT) {
    lines.push(`reasoningEffort: ${yamlString(world.reasoningEffort)}`);
  }

  lines.push(...permissionBlock(readableRoots));
  lines.push("---");
  return lines.join("\n");
}

/**
 * The world's Bible goes into the agent, not into the turn's context: it is the
 * "initial context that must never be lost", and it is in the system prompt so it
 * survives any session compaction.
 */
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
 * The narrator's writing language, stated in words.
 *
 * It has to be stated, not deduced. The prompt is written in Italian and the
 * model has one strong language: `it` sent as such arrives as a code, not as a
 * direction, and the narrator ends up choosing on its own. There used to be no
 * declaration at all and the language was guessed from the player's text: the
 * player wrote Italian and the narrator wrote Italian, but with the library's
 * words inside, and the library is in English (`spunte` for `spinte`, `maneggia`
 * for `maneggi`).
 *
 * It is in the agent and not only in the turn's context because it is in the
 * system prompt, and therefore survives any session compaction.
 */
function languageName(world: World): string {
  return localeName(world.activeLocale);
}

/**
 * The same declaration, for a template that has no placeholder.
 *
 * Better at the end of the prompt than absent: it is less effective than an
 * instruction in the middle, and the difference is the same as between a
 * narrator that knows which language to write in and one that picks at random
 * every turn.
 */
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

  let rendered = template
    .replace(FRONTMATTER_MARKER, () => frontmatter(world, libraries.readableRoots))
    .replace(BIBLE_MARKER, () => bibleBlock(bible));

  // The presence of the placeholders is read **before** replacing them: afterwards
  // there is nothing left to ask, and the right question is "did the template have
  // them", because it is the template that is old, not the world.
  const hasLibraries = rendered.includes(LIBRARIES_MARKER);
  const hasLanguage = rendered.includes(LANGUAGE_MARKER);

  // Every occurrence, not just the first: the spelling rule mentions the language
  // more than once, and a placeholder left inside the prompt is a string the model
  // can copy to the reader. With a function and not a string, because the language
  // name comes from the database and in a replacement string `$` means something.
  rendered = rendered.replaceAll(LANGUAGE_MARKER, () => language);

  const extra: string[] = [];

  // If the template has the placeholder, the index goes in its place. If it does
  // not, the index must not be lost: it is appended at the end. A template written
  // before this mechanism must not simply stop passing the library to the
  // narrator.
  if (hasLibraries) {
    rendered = rendered.replace(LIBRARIES_MARKER, () => libraries.index);
  } else {
    extra.push(libraries.index);
  }

  // Same thing for the language, and for a more serious reason: without this
  // sentence the narrator does not know which language to write in.
  if (!hasLanguage) extra.push(languageParagraph(language));

  const tail = extra.filter((block) => block.trim() !== "").join("\n\n");
  return tail === "" ? rendered : `${rendered.trimEnd()}\n\n${tail}\n`;
}

/**
 * Writes the agent's file only if it has changed.
 *
 * It has to be called **before** starting that world's opencode server, not
 * after. opencode registers the agents at boot by reading `.opencode/agents/`: if
 * the file is not there yet when it starts, `gm` is not registered and every
 * `prompt` with `agent: "gm"` fails. The symptom is a generic error that says
 * nothing useful, and the case only comes up on the first run of a new world,
 * which makes it look like a session problem.
 *
 * The comparison before writing serves not to touch the file while opencode is
 * reading it.
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

/**
 * The prompt lives as a file in the package, so it stays readable and diffable
 * instead of being a long string inside the code.
 */
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
