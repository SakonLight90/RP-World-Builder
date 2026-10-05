import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  entryFileFor,
  escapeRegex,
  expandPath,
  groupFromFile,
  headKeysFor,
  indexExtension,
  isPrimaryFor,
  isSafeRelative,
  isUsefulNameFor,
  type LoreDescriptor,
  type LoreMatchingRule,
  type LorePrimaryRule,
  type LoreSlugRule,
  listIndexFiles,
  readDescriptor,
  slugFor,
  weightFor,
} from "../src/lore/layout.js";

/**
 * The descriptor with which a library describes itself, and the levers it
 * yields.
 *
 * This is the point where the engine stops knowing what a library is: from here
 * on everything needed is written in the manifest of whoever owns the library.
 * So what's tested here isn't that things work with **one** library, already
 * covered, but that the engine doesn't make choices on its own when the manifest
 * is broken, ambiguous or dangerous.
 *
 * The rule holding the file together is a single one: a wrong descriptor neither
 * throws nor gets guessed. It returns `null`, the library stays openable as a
 * folder and simply gives no entries. Throwing would make the world unreachable
 * exactly when the problem is the library, and guessing means reading an index
 * with the wrong format, which is the worst defect: names taken from the wrong
 * file and no error.
 */

/** A complete matching rule, with the values that need no change. */
function matching(over: Partial<LoreMatchingRule> = {}): LoreMatchingRule {
  return { minNameLength: 5, ignoreWords: new Set(), ignoreNamePatterns: [], ...over };
}

function primary(over: Partial<LorePrimaryRule> = {}): LorePrimaryRule {
  return { sectionSuffix: true, excludePatterns: [], ...over };
}

function slug(over: Partial<LoreSlugRule> = {}): LoreSlugRule {
  return {
    strategy: "slug",
    maxLength: 70,
    hashLength: 0,
    hash: "sha1",
    fallback: "entry",
    ...over,
  };
}

/** The minimum a descriptor must declare to be read. */
const MINIMUM = {
  adapter: "yaml-records",
  entryPath: "voci/{group}/{section}/{slug}.md",
  sections: { luoghi: { dir: "topponi", index: "{group}.yaml" } },
  fields: { name: "titolo" },
} as const;

describe("a descriptor that holds", () => {
  it("everything it declares is read", () => {
    const parsed = readDescriptor({
      ...MINIMUM,
      sections: {
        luoghi: { dir: "topponi", index: "{group}.yaml" },
        gruppi: { dir: "sodal", index: "{group}.yaml" },
      },
      fields: { name: "titolo", aliases: "detti", categories: "etichette", file: "percorso" },
      slug: {
        strategy: "slug-hash",
        maxLength: 40,
        hashLength: 6,
        hash: "sha1",
        fallback: "entry",
      },
      matching: { minNameLength: 4, ignoreWords: ["borgo"], ignoreNamePatterns: ["^Gruppo "] },
      primary: { sectionSuffix: true, excludePatterns: ["solo citat"] },
    });

    expect(parsed?.adapter).toBe("yaml-records");
    expect(Object.keys(parsed?.sections ?? {})).toEqual(["luoghi", "gruppi"]);
    expect(parsed?.fields).toEqual({
      name: "titolo",
      aliases: "detti",
      categories: "etichette",
      file: "percorso",
    });
    expect(parsed?.slug.maxLength).toBe(40);
    expect(parsed?.matching.minNameLength).toBe(4);
    expect([...(parsed?.matching.ignoreWords ?? [])]).toEqual(["borgo"]);
    // Patterns arrive compiled, not as strings: a library writing a broken one is
    // turned away here, and not in the middle of a search.
    expect(parsed?.matching.ignoreNamePatterns[0]?.test("Gruppo Uno")).toBe(true);
    expect(parsed?.primary.excludePatterns[0]?.test("Solo citato, luoghi")).toBe(true);
  });

  it("what isn't declared has a default, not a hole", () => {
    // A new library declaring only the essentials must work: defaults are the
    // engine's minimum lever, not the exception.
    const parsed = readDescriptor(MINIMUM);

    expect(parsed?.slug).toEqual({
      strategy: "slug",
      maxLength: 70,
      hashLength: 0,
      hash: "sha1",
      fallback: "entry",
    });
    expect(parsed?.matching.minNameLength).toBe(5);
    expect(parsed?.fields.aliases).toBe("");
    expect(parsed?.primary.sectionSuffix).toBe(true);
  });

  it("a section's folder, when undeclared, is the kind's name", () => {
    // The kind is the index section's name: using it as a folder is the historic
    // convention, and it's fine as long as the library says nothing else.
    const parsed = readDescriptor({
      ...MINIMUM,
      sections: { luoghi: { index: "{group}.yaml" } },
    });
    expect(parsed?.sections.luoghi?.dir).toBe("luoghi");
  });

  it("patterns are compiled case-insensitively", () => {
    // Those libraries alternate "Locations" and "locations": if the comparison
    // were case-sensitive, half the entries would flip from "primary" to "cited".
    const parsed = readDescriptor({
      ...MINIMUM,
      primary: { sectionSuffix: true, excludePatterns: ["SOLO CITAT"] },
    });
    expect(parsed?.primary.excludePatterns[0]?.test("Solo citato, luoghi")).toBe(true);
  });
});

describe("a broken descriptor", () => {
  const broken = (patch: Record<string, unknown>) => readDescriptor({ ...MINIMUM, ...patch });

  it("without an adapter or an entry path it doesn't hold", () => {
    expect(broken({ adapter: undefined })).toBeNull();
    expect(broken({ adapter: "" })).toBeNull();
    expect(broken({ entryPath: undefined })).toBeNull();
    expect(broken({ entryPath: "" })).toBeNull();
  });

  it("without the record's name field it doesn't hold, because without a name there's no entry", () => {
    expect(broken({ fields: { aliases: "detti" } })).toBeNull();
    expect(broken({ fields: { name: "" } })).toBeNull();
    expect(broken({ fields: {} })).toBeNull();
    expect(broken({ fields: "titolo" })).toBeNull();
  });

  it("with empty or malformed sections it doesn't hold", () => {
    expect(broken({ sections: {} })).toBeNull();
    expect(broken({ sections: [] })).toBeNull();
    expect(broken({ sections: { luoghi: "topponi" } })).toBeNull();
    // Without the index file's name there's no knowing which files to list.
    expect(broken({ sections: { luoghi: { dir: "topponi" } } })).toBeNull();
  });

  it("a section pointing outside the library doesn't hold", () => {
    // `dir` and `index` end up in a `join` and in a `readdir`: a `..` here means
    // the library reads outside itself with nobody having written that.
    expect(
      broken({ sections: { luoghi: { dir: "../esterno", index: "{group}.yaml" } } }),
    ).toBeNull();
    expect(
      broken({ sections: { luoghi: { dir: "topponi", index: "../esterno.yaml" } } }),
    ).toBeNull();
    expect(broken({ sections: { luoghi: { dir: "/topponi", index: "{group}.yaml" } } })).toBeNull();
  });

  it("an entry path leaving the library doesn't hold, placeholders included", () => {
    expect(broken({ entryPath: "../rubato/{slug}.md" })).toBeNull();
    expect(broken({ entryPath: "/etc/{slug}.md" })).toBeNull();
    expect(broken({ entryPath: "voci/{section}/../{slug}.md" })).toBeNull();
    expect(broken({ entryPath: "voci/{slug}.md" })).not.toBeNull();
  });

  it("slug rules that make no sense don't hold", () => {
    expect(broken({ slug: "slug" })).toBeNull();
    expect(broken({ slug: { strategy: "altro" } })).toBeNull();
    // A zero length would produce empty names, and an empty name is the folder's
    // path: every entry would end up in the same directory.
    expect(broken({ slug: { maxLength: 0 } })).toBeNull();
    expect(broken({ slug: { maxLength: 1.5 } })).toBeNull();
    expect(broken({ slug: { hashLength: -1 } })).toBeNull();
  });

  it("matching rules that make no sense don't hold", () => {
    expect(broken({ matching: "rigoroso" })).toBeNull();
    expect(broken({ matching: { minNameLength: 4.5 } })).toBeNull();
    // Useless words are a list: a string here is treated as a list of characters,
    // and "borgo" would become five useless words.
    expect(broken({ matching: { ignoreWords: "borgo" } })).toBeNull();
    expect(broken({ matching: { ignoreWords: [42] } })).toBeNull();
  });

  it("a pattern that doesn't compile doesn't hold, instead of failing a search", () => {
    // A library writes the data, and the data can be wrong: here the manifest is
    // read once, not on every name searched.
    expect(broken({ matching: { ignoreNamePatterns: ["("] } })).toBeNull();
    expect(broken({ matching: { ignoreNamePatterns: [2] } })).toBeNull();
    expect(broken({ matching: { ignoreNamePatterns: [""] } })).toBeNull();
    expect(broken({ primary: { sectionSuffix: true, excludePatterns: ["*"] } })).toBeNull();
  });

  it("a primary rule that makes no sense doesn't hold", () => {
    expect(broken({ primary: "principale" })).toBeNull();
    // `sectionSuffix` is a yes or a no: a string "sì" here would become truthy
    // and change which entries are primary without anybody asking.
    expect(broken({ primary: { sectionSuffix: "sì" } })).toBeNull();
  });

  it("a manifest that isn't an object isn't even looked at", () => {
    expect(readDescriptor(null)).toBeNull();
    expect(readDescriptor("layout")).toBeNull();
    expect(readDescriptor(["layout"])).toBeNull();
    expect(readDescriptor(undefined)).toBeNull();
  });
});

describe("paths that escape", () => {
  it("are recognized before ending up in a read", () => {
    // It isn't enough for the path to look relative: `..` inside an innocent
    // string is exactly what's needed, and on Windows also the drive letter and
    // the leading slash.
    expect(isSafeRelative("voci/oltre/entry.md")).toBe(true);
    expect(isSafeRelative("")).toBe(false);
    expect(isSafeRelative("..")).toBe(false);
    expect(isSafeRelative("../segreto.md")).toBe(false);
    expect(isSafeRelative("..\\segreto.md")).toBe(false);
    expect(isSafeRelative("voci/../segreto.md")).toBe(false);
    expect(isSafeRelative("./voci/entry.md")).toBe(false);
    expect(isSafeRelative("voci/./entry.md")).toBe(false);
    expect(isSafeRelative("/etc/passwd")).toBe(false);
    expect(isSafeRelative("\\Windows")).toBe(false);
    expect(isSafeRelative("C:/Windows")).toBe(false);
    expect(isSafeRelative("voci/entry\0.md")).toBe(false);
  });
});

describe("an entry path's placeholders", () => {
  it("expand what the engine knows how to fill", () => {
    expect(
      expandPath("voci/{group}/{section}/{slug}.md", {
        group: "oltre",
        section: "topponi",
        slug: "piazza-maggiore",
      }),
    ).toBe("voci/oltre/topponi/piazza-maggiore.md");
    expect(expandPath("voci/{slug}.md", { slug: "piazza-maggiore" })).toBe(
      "voci/piazza-maggiore.md",
    );
  });

  it("a placeholder the engine can't fill counts as no entry", () => {
    // Better an entry that doesn't enter the index than an entry read from the
    // wrong file: the path isn't trustworthy, and it isn't guessed.
    expect(expandPath("voci/{slug}/{ignoto}.md", { slug: "x" })).toBeNull();
    expect(expandPath("voci/{slug}.md", {})).toBeNull();
  });

  it("a path that escapes after expansion doesn't hold", () => {
    // Values come from data, and a datum can contain `..`: the check belongs on
    // the result, not only on the declared model.
    expect(expandPath("voci/{slug}.md", { slug: "../../segreto" })).toBeNull();
    expect(expandPath("{slug}.md", { slug: "/etc/passwd" })).toBeNull();
  });
});

describe("an entry's file name", () => {
  const layout = readDescriptor(MINIMUM) as LoreDescriptor;
  const ctx = { subject: "Piazza Maggiore", group: "oltre", kind: "luoghi", section: "topponi" };

  it("derives from the model declared by the library", () => {
    expect(entryFileFor(layout, ctx)).toBe("voci/oltre/topponi/piazza-maggiore.md");
  });

  it("the path the record carries wins", () => {
    // This is the case where the naming convention isn't reconstructible: the
    // library must say it entry by entry, and the engine doesn't guess another.
    expect(entryFileFor(layout, ctx, "  voci/ovunque/piazza.md  ")).toBe("voci/ovunque/piazza.md");
  });

  it("a declared path that escapes counts as no entry", () => {
    expect(entryFileFor(layout, ctx, "../../segreto.md")).toBeNull();
    expect(entryFileFor(layout, ctx, "/etc/passwd")).toBeNull();
  });

  it("a declared path that's empty or only spaces doesn't count as declared", () => {
    // Otherwise a half-filled column would make the empty path beat the model,
    // and the entry would never open.
    expect(entryFileFor(layout, ctx, "   ")).toBe("voci/oltre/topponi/piazza-maggiore.md");
  });
});

describe("an entry's slug", () => {
  it("is the normalized name, with accents and punctuation cleaned up", () => {
    expect(slugFor("Flatwoods Lookout", slug())).toBe("flatwoods-lookout");
    expect(slugFor("Caverna del Nord", slug())).toBe("caverna-del-nord");
    expect(slugFor("L'Étoile", slug())).toBe("l-etoile");
    expect(slugFor("  Vault 12  ", slug())).toBe("vault-12");
  });

  it("a name leaving nothing usable takes the fallback", () => {
    // The library's name, not the engine's: it's a convention of whoever wrote
    // the files, and without a name there's no file either.
    expect(slugFor("???", slug({ fallback: "entry" }))).toBe("entry");
    expect(slugFor("???", slug({ fallback: "untitled" }))).toBe("untitled");
    expect(slugFor("???", slug())).toBe("entry");
  });

  it("the name is cut to the length the library declares", () => {
    expect(slugFor("Flatwoods Lookout", slug({ maxLength: 8 }))).toBe("flatwood");
    expect(slugFor("Flatwoods Lookout", slug({ maxLength: 9 }))).toBe("flatwoods");
  });

  it("with the hash, two different names don't land in the same entry", () => {
    // This is why the hash exists: "Mojave House" and "Mojave-House" normalize to
    // the same name, and without a hash the second entry would write over the
    // first, or the two would open each other.
    const rule = slug({ strategy: "slug-hash", hashLength: 6 });
    const first = slugFor("Mojave House", rule);
    const second = slugFor("Mojave-House", rule);

    expect(first.startsWith("mojave-house-")).toBe(true);
    expect(second.startsWith("mojave-house-")).toBe(true);
    expect(first).not.toBe(second);
    // And it doesn't change from one read to the next, otherwise the index would
    // point at files that don't exist.
    expect(slugFor("Mojave House", rule)).toBe(first);
    expect(first).toMatch(/^mojave-house-[0-9a-f]{6}$/);
  });

  it("a zero-length hash doesn't leave a lone hyphen", () => {
    expect(slugFor("Mojave House", slug({ strategy: "slug-hash", hashLength: 0 }))).toBe(
      "mojave-house",
    );
  });
});

describe("a section's index files", () => {
  const extension = (model: string) => indexExtension(model);
  const group = (file: string, ext: string) => groupFromFile(file, ext);

  it("the extension comes from the declared model", () => {
    // The engine must not know that those libraries' indexes end in `.md`: it's
    // the library that says so, and another library may use something else.
    expect(extension("{group}.md")).toBe(".md");
    expect(extension("indici/{group}.index.json")).toBe(".json");
    expect(extension("{group}")).toBe("");
    expect(extension(".nascosto")).toBe("");
  });

  it("the sub-index name is the file name without the extension", () => {
    expect(group("oltre.md", ".md")).toBe("oltre");
    // Without an extension the name is the name: and a file with another
    // extension isn't cut at random, because the index isn't its.
    expect(group("oltre.md", "")).toBe("oltre.md");
    expect(group("oltre.txt", ".md")).toBe("oltre.txt");
  });

  it("a folder that doesn't exist isn't an error, it's an empty index", async () => {
    expect(await listIndexFiles(join(tmpdir(), "rpwb-cartella-inesistente-12345"), ".md")).toEqual(
      [],
    );
  });

  it("files are listed in order, and only those with the right extension", async () => {
    // The order keeps the index reproducible: without it, two runs would give
    // different lists and the index hash would change on every read.
    const root = await mkdtemp(join(tmpdir(), "lore-indici-"));
    const dir = join(root, "topponi");
    await mkdir(dir, { recursive: true });
    for (const nameOf of ["zeta.yaml", "alpha.yaml", "beta.md", "leggi.txt"]) {
      await writeFile(join(dir, nameOf), "- titolo: x\n", "utf8");
    }

    expect(await listIndexFiles(dir, ".yaml")).toEqual(["alpha.yaml", "zeta.yaml"]);
    expect(await listIndexFiles(dir, "")).toEqual([
      "alpha.yaml",
      "beta.md",
      "leggi.txt",
      "zeta.yaml",
    ]);
  });
});

describe("the words that hook a name", () => {
  it("the first valid word is the search key", () => {
    // Nobody writes "Mojave Wasteland" by writing "Mojave": without this key the
    // right name doesn't enter the context exactly when the player is using it.
    expect(headKeysFor("Mojave Wasteland", matching())).toEqual(["mojave"]);
    expect(headKeysFor("Città Grande", matching())).toEqual(["citta"]);
  });

  it("the useless words are the ones the library declares", () => {
    expect(headKeysFor("Borgo Vecchio", matching({ ignoreWords: new Set(["borgo"]) }))).toEqual([
      "vecchio",
    ]);
    // If every word is useless nothing is hooked: better hooking nothing than
    // hooking the wrong word and filling the context with noise.
    expect(headKeysFor("Borgo", matching({ ignoreWords: new Set(["borgo"]) }))).toEqual([]);
    expect(headKeysFor("???", matching())).toEqual([]);
  });

  it("a name too short or one that looks like a heading isn't worth searching", () => {
    const rule = matching({ ignoreNamePatterns: [/^Locations?$/i] });
    expect(isUsefulNameFor("Se", rule)).toBe(false);
    expect(isUsefulNameFor("Se", matching({ minNameLength: 2 }))).toBe(true);
    // "Locations" is a section heading: searching it pulls the index itself into
    // the turn's context.
    expect(isUsefulNameFor("Locations", rule)).toBe(false);
    expect(isUsefulNameFor("Location", rule)).toBe(false);
    expect(isUsefulNameFor("Flatwoods Lookout", rule)).toBe(true);
  });
});

describe("primary or mention-only", () => {
  const rule = primary({ excludePatterns: [/solo citat/i] });

  it("an entry with no categories is primary for nothing", () => {
    // It can't be deduced from categories that aren't there: declaring "primary"
    // here would be an engine choice on absent data.
    expect(isPrimaryFor([], "luoghi", rule)).toBe(false);
    expect(isPrimaryFor(["   "], "luoghi", rule)).toBe(false);
  });

  it("the category must end with the kind's name, if the library asks", () => {
    expect(isPrimaryFor(["Oltre luoghi"], "luoghi", rule)).toBe(true);
    // The comparison is case-insensitive, because those libraries write the
    // categories in different ways.
    expect(isPrimaryFor(["Oltre LUOGHI"], "luoghi", rule)).toBe(true);
    // "luoghi" inside the category isn't the same thing: the category ends with
    // the kind's name, and if it contains the name without ending there the
    // entry isn't of that kind.
    expect(isPrimaryFor(["oltre luoghi extra"], "luoghi", rule)).toBe(false);
    expect(isPrimaryFor(["oltre frazioni"], "luoghi", rule)).toBe(false);
  });

  it("without the suffix constraint any category is enough", () => {
    const free = primary({ sectionSuffix: false });
    expect(isPrimaryFor(["qualunque cosa"], "luoghi", free)).toBe(true);
  });

  it("a category the library excludes counts as a mention", () => {
    // Exclusions are the library's data, not an engine rule: it's the library
    // that knows "solo citato" is a margin note and not a card.
    expect(isPrimaryFor(["Solo citato, luoghi"], "luoghi", rule)).toBe(false);
    // And one of the categories is enough: if one says "owned", the entry is owned.
    expect(isPrimaryFor(["Solo citato, luoghi", "Oltre luoghi"], "luoghi", rule)).toBe(true);
  });

  it("a kind name with special characters isn't read as an expression", () => {
    // Patterns are built from the data: without protection, a kind like "a.b"
    // would hook any category ending with "axb".
    expect(escapeRegex("a.b(c)")).toBe("a\\.b\\(c\\)");
    const dotRule = primary();
    expect(isPrimaryFor(["oltre a.b"], "a.b", dotRule)).toBe(true);
    expect(isPrimaryFor(["oltre axb"], "a.b", dotRule)).toBe(false);
  });
});

describe("an entry's weight", () => {
  it("is the name's length: the longer it is, the more specific", () => {
    // It isn't a property of any particular library, but a choice declared by the
    // engine and not a fact of the data.
    expect(weightFor("Mojave Wasteland")).toBe(16);
    expect(weightFor("Freeside")).toBeLessThan(weightFor("Mojave Wasteland"));
  });
});
