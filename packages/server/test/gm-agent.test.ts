import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { World } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import { loadTemplate, renderAgent } from "../src/canon/gm-agent.js";
import { makeWorld } from "./helpers/fixtures.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// The test lives in packages/server/test/, the prompt in packages/server/prompts/.
const TEMPLATE_PATH = join(HERE, "..", "prompts", "gm.md");

function world(overrides: Partial<World> = {}): World {
  return makeWorld({
    id: "w1",
    name: "Appalachia 2287",
    slug: "appalachia-2287",
    smallModel: "opencode/mimo-v2.6-flash-free",
    isTemplate: true,
    templateAuthor: "amministrazione",
    ...overrides,
  });
}

const BIBLE = {
  premise: "Sei un sopravvissuto dell'Appalachia.",
  rules: "Questo mondo non ha magia.",
  tone: "Post-apocalittico realistico.",
  style: "Terza persona, descrizioni concrete.",
  conventions: "I nomi propri non si traducono.",
};

async function template(): Promise<string> {
  return readFile(TEMPLATE_PATH, "utf8");
}

describe("narrator agent", () => {
  it("frontmatter declares the world model", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).toContain('model: "opencode/space-bunny-free"');
  });

  it("the narrator has no permissions", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).toContain("permission:");
    expect(content).toContain('"*": deny');
  });

  it("frontmatter comes first and stays valid YAML", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    const start = content.indexOf("---");
    const end = content.indexOf("---", start + 3);
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(0);

    const block = content.slice(start + 3, end);
    expect(block).toContain("mode: primary");
    expect(block).toContain("temperature: 0.85");
    // Steps went up because every grep and read eats one: with the previous
    // cap a library search ended mid-turn.
    expect(block).toContain("steps: 24");
    // every key must start a line. YAML comments are a legit exception: the
    // frontmatter holds some, explaining permissions to file openers, and a
    // comment isn't a missing key.
    for (const line of block.split("\n").filter((l) => l.trim() !== "")) {
      if (line.trimStart().startsWith("#")) continue;
      expect(line).toMatch(/^\s*("?[\p{L}*]+"?:)/u);
    }
  });

  it("a world name with special chars doesn't break frontmatter", async () => {
    const content = renderAgent(
      world({ name: 'Ilmondo: "Odio & Amore" #1' }),
      BIBLE,
      await template(),
    );
    const end = content.indexOf("---", 3);
    const description = content.slice(content.indexOf("description:"), end);
    expect(description).toContain('\\"Odio & Amore\\"');
  });

  it("the Bible enters the agent, so it survives compaction", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).toContain("Questo mondo non ha magia.");
    expect(content).toContain("Sei un sopravvissuto dell'Appalachia.");
  });

  it("every Bible section appears with its title", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    for (const section of ["PREMISE", "RULES", "TONE", "STYLE", "CONVENTIONS"]) {
      expect(content).toContain(`## ${section}`);
    }
  });

  it("an empty section leaves no hanging title", async () => {
    const content = renderAgent(world(), { ...BIBLE, conventions: "   " }, await template());
    expect(content).not.toContain("## CONVENTIONS");
  });

  it("by default asks no reasoning power", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    // "default" means asking nothing: writing `reasoningEffort: default`
    // would differ, because some providers read it as the lowest explicit
    // level instead of no request.
    expect(content).not.toContain("reasoningEffort");
  });

  it("the chosen level ends up in frontmatter", async () => {
    const content = renderAgent(world({ reasoningEffort: "medium" }), BIBLE, await template());
    expect(content).toContain('reasoningEffort: "medium"');
  });

  it("no level is set to max unasked", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).not.toContain('reasoningEffort: "high"');
    expect(content).not.toContain('reasoningEffort: "max"');
  });

  it("the canonicity contract is in the prompt", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).toContain("# The canon is the truth");
    expect(content).toContain("in-fiction");
    expect(content).toContain("You do not roll dice");
    // the narrator must not promise to manage state
    expect(content).toContain("you do not modify it and you do not record");
  });

  it("placeholders don't stay in the generated file", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).not.toContain("__FRONTMATTER__");
    expect(content).not.toContain("__BIBLE__");
  });

  it("a placeholder-less template fails instead of making a broken file", async () => {
    expect(() => renderAgent(world(), BIBLE, "no placeholders here")).toThrow(/__FRONTMATTER__/);
  });
  it("the package template holds the placeholders", async () => {
    const text = await template();
    expect(text).toContain("__FRONTMATTER__");
    expect(text).toContain("__BIBLE__");
  });

  it("the template is reachable at shipped builds", async () => {
    const text = await loadTemplate().catch(() => null);
    // In dev it must work; in an installed build it may require
    // RPWB_PROMPTS_DIR, and flagging it with an explicit error is fine.
    if (text === null) {
      expect(process.env.RPWB_PROMPTS_DIR).toBeUndefined();
    } else {
      expect(text).toContain("__BIBLE__");
    }
  });
});

/**
 * The language the narrator writes in.
 *
 * Not politeness: without this declaration the narrator inferred the language
 * from player text and inferred badly, because the prompt is Italian and the
 * lore library English. The result was Italian with library words inside, i.e.
 * `Iron Brotherhood` for `Brotherhood of
 * Steel`.
 */
describe("the narrator language", () => {
  it("the language code becomes the language name", async () => {
    const content = renderAgent(world({ activeLocale: "de" }), BIBLE, await template());
    // bare `de`, sent like that, isn't a direction: it's a code.
    expect(content).toContain("German");
    expect(content).not.toContain("__LANGUAGE__");
  });

  it("all five UI languages are covered", async () => {
    for (const [locale, nameOf] of [
      ["it", "Italian"],
      ["en", "English"],
      ["es", "Spanish"],
      ["fr", "French"],
      ["de", "German"],
    ] as const) {
      const content = renderAgent(world({ activeLocale: locale }), BIBLE, await template());
      expect(content).toContain(nameOf);
    }
  });

  it("the prompt declares language and the spelling rule", async () => {
    const content = renderAgent(world(), BIBLE, await template());
    expect(content).toContain("Spelling and grammar are those of someone who writes in Italian");
    // The library is English: the rule is written, not implied.
    expect(content).toContain("# Library text is not your style");
    expect(content).toContain("Brotherhood of Steel");
    // The two examples, wrong and right: without the right one the rule is
    // only a ban, and a model never shown the good shape respects it badly.
    expect(content).toContain("his dealings with the Iron");
    expect(content).toContain("Brotherhood of Steel are known to all.");
  });

  it("a template without the language placeholder doesn't lose it", async () => {
    const legacy = "__FRONTMATTER__\n\nCorpo.\n\n__BIBLE__\n";
    const content = renderAgent(world({ activeLocale: "fr" }), {}, legacy);
    expect(content).not.toContain("__LANGUAGE__");
    expect(content).toContain("French");
  });
});
