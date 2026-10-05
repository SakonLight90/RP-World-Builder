import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ADAPTER, providerFor } from "../src/lore/adapters/index.js";
import { legacyWikiDescriptor } from "../src/lore/adapters/wiki-record-list.js";
import { readDescriptor } from "../src/lore/layout.js";
import type { LoreLibrary } from "../src/lore/provider.js";

/**
 * Adapters: whoever really knows how to read a format.
 *
 * The engine knows no format, and this file proves the choice belongs to the
 * adapter and not to it: two adapters with nothing in common read two very
 * different libraries, and a format the server doesn't know isn't read with the
 * wrong one.
 *
 * What's tested here is the level below `libraryIndexFor`, that is the point
 * where data becomes entries: how a record is separated from the others, how a
 * column arrives as a list and how it arrives as text, and what happens when a
 * file isn't what it looks like. What's already covered elsewhere isn't repeated.
 */

/** A library in a temporary folder, holding the files it's given. */
async function makeLibrary(id: string, file: Record<string, string>): Promise<LoreLibrary> {
  const root = await mkdtemp(join(tmpdir(), "lore-adapter-"));
  for (const [name, body] of Object.entries(file)) {
    const path = join(root, ...name.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  return { id, dir: root };
}

/** The descriptor a library with YAML indexes declares. */
const YAML_DESCRIPTOR = readDescriptor({
  adapter: "yaml-records",
  entryPath: "voci/{group}/{section}/{slug}.md",
  sections: { luoghi: { dir: "topponi", index: "{group}.yaml" } },
  fields: { name: "titolo", aliases: "detti", categories: "etichette" },
  slug: { strategy: "slug", maxLength: 40 },
  matching: { minNameLength: 4, ignoreWords: ["borgo"] },
  primary: { sectionSuffix: true, excludePatterns: ["solo citat"] },
});

describe("choosing the adapter", () => {
  it("a library declaring no format is read with the historic one", () => {
    // It isn't a special case in the engine: it's the historic library's
    // declaration, which goes through the same table as the others. The
    // advantage is that adding a format doesn't require touching the core.
    const provider = providerFor(null);
    expect(provider.id).toBe(DEFAULT_ADAPTER);
    expect(provider.kinds()).toEqual(["locations", "factions"]);
  });

  it("the declared format picks the adapter, and the adapter brings its id", () => {
    expect(providerFor(YAML_DESCRIPTOR).id).toBe("yaml-records");
    expect(providerFor(legacyWikiDescriptor()).id).toBe("wiki-record-list");
  });

  it("a format the server can't read isn't read badly", () => {
    // Better a library that says nothing than a library read with the wrong
    // format: in the first case you see a missing adapter, in the second you see
    // names taken from the wrong file.
    const provider = providerFor(
      readDescriptor({
        adapter: "formato-del-futuro",
        entryPath: "voci/{slug}.md",
        sections: { luoghi: { dir: "topponi", index: "{group}.yaml" } },
        fields: { name: "titolo" },
      }),
    );

    expect(provider.id).toBe("unreadable");
    expect(provider.kinds()).toEqual([]);
    expect(provider.searchKeys("Piazza Maggiore")).toEqual([]);
    expect(provider.isUsefulName("Piazza Maggiore")).toBe(false);
  });
});

describe("the record-list adapter", () => {
  const INDEX = `- name: "Mojave Wasteland"
  variants: ["Mojave", "the Mojave"]
  categories: ["Ambient lore, Locations"]

- name: "Escaped \\"Man"
  variants: Molo; Ponte
  categories: ["Characters, Beyond Locations"]

- name: "Aces"
  variants: []
  categories: []

- name: ""

# A comment that is not a record.
- name: "South Vegas Ruins West Entrance"
  variants: []
  categories: ["Mentioned only Locations"]
  unknown_column: ignored
`;

  const wiki = () => providerFor(legacyWikiDescriptor());

  it("a record is the name line plus the indented lines that follow it", async () => {
    // The format is meant to be read by eye and the empty line is its only
    // separator: without one, a record would swallow the next and two entries
    // would become one with all the wrong columns.
    const lib = await makeLibrary("wiki", {
      "locations/oltre.md": INDEX,
      "locations/altro.md": '- name: "Freeside"\n  variants: [Freeside]\n',
    });

    const entries = await wiki().readIndex(lib, "locations");
    // Index files are read in name order: the index is reproducible, and
    // without this order two reads would give two different lists.
    expect(entries.map((v) => v.subject)).toEqual([
      "Freeside",
      "Mojave Wasteland",
      'Escaped "Man',
      "Aces",
      "South Vegas Ruins West Entrance",
    ]);
    // The sub-index is the file name without the extension, and it's what the path uses.
    expect(entries.map((v) => v.group)).toEqual(["altro", "oltre", "oltre", "oltre", "oltre"]);
  });

  it("names with quotes inside come back readable", async () => {
    // An entry with a double quote in the name is a name, not a file to fix: if
    // the escape sequence stayed, the search would hook nothing.
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    const makeEntry = (await wiki().readIndex(lib, "locations")).find((v) =>
      v.subject.startsWith("Escaped"),
    );
    expect(makeEntry?.subject).toBe('Escaped "Man');
  });

  it("a column arrives as a list in square brackets or as semicolon-separated text", async () => {
    // The two forms are equivalent to whoever writes them and different to a
    // parser: square brackets split on commas, the rest on semicolons. With a
    // comma inside a bracketed category you therefore get two categories: that's
    // the format of those libraries, and the engine doesn't correct it.
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    const entries = await wiki().readIndex(lib, "locations");

    expect(entries[0]?.variants).toEqual(["Mojave", "the Mojave"]);
    expect(entries[1]?.variants).toEqual(["Molo", "Ponte"]);
    // Quotes around an entry are stripped before splitting it: otherwise
    // `"Family (Fallout 3)"` would keep the opening quote.
    expect(entries[0]?.variants.some((v) => v.startsWith('"'))).toBe(false);
  });

  it("an entry with no name doesn't enter the index", async () => {
    // It can't be shown, searched or opened: entering the index costs time on
    // every search and returns nothing.
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    const entries = await wiki().readIndex(lib, "locations");
    expect(entries.some((v) => v.subject === "")).toBe(false);
    expect(entries).toHaveLength(4);
  });

  it("the entry's path comes from the declared model, with and without hash", async () => {
    // The historic one puts the hash in the name: two homonyms don't land in the
    // same entry, and the path depends only on what the library declares.
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    const makeEntry = (await wiki().readIndex(lib, "locations"))[0];
    expect(makeEntry?.file).toMatch(
      /^entries\/oltre\/locations\/mojave-wasteland-[0-9a-f]{6}\.md$/,
    );
    expect(makeEntry?.kind).toBe("locations");
  });

  it("primary or mention-only is the library's decision, not the engine's", async () => {
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    const entries = await wiki().readIndex(lib, "locations");
    const per = (subject: string) => entries.find((v) => v.subject === subject)?.primary;

    expect(per("Mojave Wasteland")).toBe(true);
    expect(per('Escaped "Man')).toBe(true);
    // No category: an entry the library says nothing about can't be declared primary.
    expect(per("Aces")).toBe(false);
    expect(per("South Vegas Ruins West Entrance")).toBe(false);
  });

  it("the adapter answers questions about the name with that library's rules", async () => {
    const provider = wiki();
    // "The Old Vatican" isn't searched with "the" nor with "old": they distinguish
    // nothing, and that choice is the library's, not the engine's.
    expect(provider.searchKeys("The Old Vatican")).toEqual(["vatican"]);
    // A name made only of useless words hooks nothing: better no hook than five
    // wrong results in the turn's context.
    expect(provider.searchKeys("The Old West")).toEqual([]);
    expect(provider.isUsefulName("Se")).toBe(false);
    expect(provider.isUsefulName("Locations")).toBe(false);
    expect(provider.isUsefulName("Freeside")).toBe(true);
  });

  it("a kind the library doesn't know gives an empty index, not an error", async () => {
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    expect(await wiki().readIndex(lib, "items")).toEqual([]);
  });

  it("a missing section gives an empty index, not an error", async () => {
    const lib = await makeLibrary("wiki", { "locations/oltre.md": INDEX });
    expect(await wiki().readIndex(lib, "factions")).toEqual([]);
  });

  it("files that aren't indexes aren't read", async () => {
    // The extension comes from the declared model: reading the files carrying
    // the entries' text into the index would repeat them in the context.
    const lib = await makeLibrary("wiki", {
      "locations/oltre.md": '- name: "Freeside"\n',
      "locations/leggimi.txt": '- name: "Not an index"\n',
    });
    const entries = await wiki().readIndex(lib, "locations");
    expect(entries.map((v) => v.subject)).toEqual(["Freeside"]);
  });

  it("an empty index, or one made only of prose, gives no entries", async () => {
    const lib = await makeLibrary("wiki", {
      "locations/vuoto.md": "",
      "locations/prosa.md": "# Locations\n\nThese are the locations.\n",
    });
    expect(await wiki().readIndex(lib, "locations")).toEqual([]);
  });

  it("the entry's text is read from the path the index declared", async () => {
    const lib = await makeLibrary("wiki", { "locations/oltre.md": '- name: "Freeside"\n' });
    const makeEntry = (await wiki().readIndex(lib, "locations"))[0];
    if (makeEntry === undefined) throw new Error("entry not read");

    const path = join(lib.dir, ...makeEntry.file.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "# Freeside\n\nA city.\n", "utf8");

    expect(await wiki().readEntry(lib, makeEntry)).toContain("A city.");
  });

  it("an entry whose file is gone isn't invented", async () => {
    // The index may be older than the content: better skipping the entry than
    // guessing what a file that doesn't exist contains.
    const lib = await makeLibrary("wiki", { "locations/oltre.md": '- name: "Freeside"\n' });
    const makeEntry = (await wiki().readIndex(lib, "locations"))[0];
    if (makeEntry === undefined) throw new Error("entry not read");

    await expect(wiki().readEntry(lib, makeEntry)).rejects.toThrow();
  });
});

describe("the YAML-index adapter", () => {
  const INDEX = `- titolo: "Piazza Maggiore"
  detti: ["Piazza"]
  etichette: "Oltre luoghi; Oltre frazioni"
- titolo: 2287
  detti: []
  etichette: []
- titolo: "   "
- titolo: ""
- "questa riga non è un oggetto"
- [1, 2]
`;

  const yaml = () => providerFor(YAML_DESCRIPTOR);

  it("the name can be a number: a year is a name like any other", async () => {
    // `2287` arrives from the YAML as a number, not as text: without the
    // conversion the entry would be discarded and the world would lose an entry
    // that can be read.
    const lib = await makeLibrary("yaml", { "topponi/oltre.yaml": INDEX });
    const entries = await yaml().readIndex(lib, "luoghi");

    expect(entries.map((v) => v.subject)).toEqual(["Piazza Maggiore", "2287"]);
    expect(entries[1]?.file).toBe("voci/oltre/topponi/2287.md");
  });

  it("a column arrives as a list or as text, and gives the same result", async () => {
    const lib = await makeLibrary("yaml", { "topponi/oltre.yaml": INDEX });
    const makeEntry = (await yaml().readIndex(lib, "luoghi"))[0];
    expect(makeEntry?.variants).toEqual(["Piazza"]);
    expect(makeEntry?.categories).toEqual(["Oltre luoghi", "Oltre frazioni"]);
    expect(makeEntry?.primary).toBe(true);
    expect(makeEntry?.group).toBe("oltre");
  });

  it("lines that aren't records don't fail the whole file", async () => {
    // A record with no name and a line that isn't an object are skipped: the
    // library stays openable, and two entries are lost instead of all.
    const lib = await makeLibrary("yaml", { "topponi/oltre.yaml": INDEX });
    const entries = await yaml().readIndex(lib, "luoghi");
    expect(entries).toHaveLength(2);
    expect(entries[1]?.primary).toBe(false);
  });

  it("a file that isn't YAML is skipped, without failing the library", async () => {
    // A corrupt file is a file to lose, not a library to lose: it's the same
    // choice made for a file that can't be read.
    const lib = await makeLibrary("yaml", {
      "topponi/oltre.yaml": '- titolo: "Piazza Maggiore"\n',
      "topponi/rotto.yaml": "titolo: [1, 2\n",
    });
    const entries = await yaml().readIndex(lib, "luoghi");
    expect(entries.map((v) => v.subject)).toEqual(["Piazza Maggiore"]);
  });

  it("a file containing no list gives no entries", async () => {
    // The descriptor declares a format with a sequence of records on top: if
    // there isn't one, what's there is something else and must be ignored, not
    // interpreted by trial and error.
    const lib = await makeLibrary("yaml", {
      "topponi/mappa.yaml": "titolo: Piazza Maggiore\n",
      "topponi/vuoto.yaml": "",
    });
    expect(await yaml().readIndex(lib, "luoghi")).toEqual([]);
  });
});
