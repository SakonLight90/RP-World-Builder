import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findInLibrary, libraryIndexFor, renderLibraryHits } from "../src/lore/lookup.js";
import { libraryPath, resolveLibraries } from "../src/lore/registry.js";

/**
 * A library with nothing to do with Fallout: indexes in YAML, sections called
 * `topponi` and `sodal`, columns called `titolo` and `detti`, entries in
 * `voci/<gruppo>/<cartella>/<nome>.md` and no hash in the file name.
 *
 * This is the test that matters for the refactor: if it works, the engine has no
 * format in its head. No server file is touched for it to work, and that's the
 * point: everything needed is written in the library's manifest.
 */
const OTHER_FORMAT = `
title: "Prova di formato"
layout:
  adapter: yaml-records
  sections:
    luoghi:
      dir: "topponi"
      index: "{group}.yaml"
    gruppi:
      dir: "sodal"
      index: "{group}.yaml"
  fields:
    name: titolo
    aliases: detti
    categories: etichette
  entryPath: "voci/{group}/{section}/{slug}.md"
  slug:
    strategy: slug
    maxLength: 40
  matching:
    minNameLength: 4
    ignoreWords: ["borgo"]
    ignoreNamePatterns: ["^Gruppo "]
  primary:
    sectionSuffix: true
    excludePatterns: ["solo citat"]
`;

const LOCATIONS_INDEX = `- titolo: "Piazza Maggiore"
  detti: ["Piazza"]
  etichette: ["Oltre luoghi"]
- titolo: "Molo Alto"
  detti: []
  etichette: ["Oltre luoghi"]
- titolo: "Molo Cieco"
  detti: []
  etichette: ["Solo citato, luoghi"]
- titolo: "Borgo Vecchio"
  detti: []
  etichette: ["Oltre luoghi"]
- titolo: "New Luna"
  detti: []
  etichette: ["Oltre luoghi"]
`;

const GROUPS_INDEX = `- titolo: "Ordine della Rosa"
  detti: []
  etichette: ["Oltre gruppi"]
- titolo: "Se"
  detti: []
  etichette: ["Oltre gruppi"]
`;

async function makeLibrary(
  root: string,
  id: string,
  manifest: string,
  files: Record<string, string>,
): Promise<string> {
  const dir = join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "library.yaml"), `id: ${id}\nversion: "1.0.0"\n${manifest}`, "utf8");
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, ...name.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, body, "utf8");
  }
  return dir;
}

/**
 * Entries are written at the paths the index *declares*, not at paths the test
 * picks: otherwise the test would pass even with a wrong derivation, which is
 * exactly the defect the descriptor was supposed to remove.
 */
async function writeEntriesFromIndex(root: string, id: string) {
  const libs = await resolveLibraries(root, [{ id, version: "1.0.0", hash: "" }]);
  const index = await libraryIndexFor(libs);
  for (const entry of index.entries) {
    const path = join(root, id, ...entry.file.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `# ${entry.subject}\n\nTest entry about ${entry.subject}.\n`, "utf8");
  }
  return libs;
}

async function otherFormatRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lore-formato-"));
  await makeLibrary(root, "prova-formato", OTHER_FORMAT, {
    "topponi/oltre.yaml": LOCATIONS_INDEX,
    "sodal/oltre.yaml": GROUPS_INDEX,
  });
  await writeEntriesFromIndex(root, "prova-formato");
  return root;
}

describe("library with a different format", () => {
  it("the registry reads the layout from the manifest and doesn't know it on its own", async () => {
    const root = await otherFormatRoot();
    const [lib] = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    expect(lib?.state).toBe("ok");
    expect(lib?.layout?.adapter).toBe("yaml-records");
    // The entry kinds are the declared ones, not two written by hand in the engine.
    expect(Object.keys(lib?.layout?.sections ?? {})).toEqual(["luoghi", "gruppi"]);
    expect(lib?.layout?.sections.luoghi?.dir).toBe("topponi");
  });

  it("a name the player cited leads into the right entry", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    const hits = await findInLibrary(libs, "la Piazza era piena di gente");
    expect(hits.map((hit) => hit.subject)).toContain("Piazza Maggiore");
    expect(renderLibraryHits(hits)).toContain("Test entry about Piazza Maggiore");
  });

  it("recognizes the short name and puts the more specific one first", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    const hits = await findInLibrary(libs, "verso la Piazza Maggiore in piazza");
    expect(hits[0]?.subject).toBe("Piazza Maggiore");
  });

  it("hooks even a single word of the name, if that library declares it valid", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    const hits = await findInLibrary(libs, "siamo arrivati al Molo");
    expect(hits.map((hit) => hit.subject)).toContain("Molo Alto");
  });

  it("the useless words are the ones the library says, not the engine's", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    // "borgo" is the useless word this library declares, so it hooks nothing and
    // the search carries on with the next word.
    const ignored = await findInLibrary(libs, "verso il Borgo");
    expect(ignored.map((hit) => hit.subject)).not.toContain("Borgo Vecchio");
    const next = await findInLibrary(libs, "verso il Vecchio");
    expect(next.map((hit) => hit.subject)).toContain("Borgo Vecchio");
    // "new" is a useless word for the Fallout library and not for this one: if
    // the engine still had the list written by hand, this line would fail.
    const valid = await findInLibrary(libs, "sulla New Luna brillava");
    expect(valid.map((hit) => hit.subject)).toContain("New Luna");
  });

  it("the library decides the minimum name length", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    const hits = await findInLibrary(libs, "un Se per sempre");
    expect(hits.map((hit) => hit.subject)).not.toContain("Se");
  });

  it("the entry's path comes from the descriptor, folder included", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    const files = (await libraryIndexFor(libs)).entries.map((entry) => entry.file);
    // `{section}` is the declared folder (`topponi`), not the kind's name
    // (`luoghi`), and the slug is the declared one: normalized name, no hash.
    expect(files).toContain("voci/oltre/topponi/piazza-maggiore.md");
    expect(files).toContain("voci/oltre/sodal/ordine-della-rosa.md");
    expect(files.some((file) => file.includes(".."))).toBe(false);
  });

  it("primary or mention-only is the descriptor's decision", async () => {
    const root = await otherFormatRoot();
    const libs = await resolveLibraries(root, [
      { id: "prova-formato", version: "1.0.0", hash: "" },
    ]);
    const entries = (await libraryIndexFor(libs)).entries;
    const by = (subject: string) => entries.find((entry) => entry.subject === subject);
    expect(by("Molo Alto")?.primary).toBe(true);
    expect(by("Molo Cieco")?.primary).toBe(false);
  });

  it("two libraries with the same name aren't confused", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-formato-"));
    const files = { "topponi/oltre.yaml": LOCATIONS_INDEX, "sodal/oltre.yaml": GROUPS_INDEX };
    await makeLibrary(root, "prima", OTHER_FORMAT, files);
    await makeLibrary(root, "seconda", OTHER_FORMAT, files);
    await writeEntriesFromIndex(root, "prima");
    await writeEntriesFromIndex(root, "seconda");

    const libs = await resolveLibraries(root, [
      { id: "prima", version: "1.0.0", hash: "" },
      { id: "seconda", version: "1.0.0", hash: "" },
    ]);
    const entries = (await libraryIndexFor(libs)).entries.filter(
      (entry) => entry.subject === "Piazza Maggiore",
    );
    // They are two distinct entries: merging them by name would make one vanish.
    expect(entries.length).toBe(2);
    expect(entries.map((entry) => entry.library).sort()).toEqual(["prima", "seconda"]);

    const hits = await findInLibrary(libs, "la Piazza era piena di gente");
    expect(hits.filter((hit) => hit.subject === "Piazza Maggiore").length).toBe(2);
  });

  it("a format the server can't read isn't read badly", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-formato-"));
    await makeLibrary(
      root,
      "futuro",
      OTHER_FORMAT.replace("adapter: yaml-records", "adapter: formato-del-futuro"),
      { "topponi/oltre.yaml": LOCATIONS_INDEX, "sodal/oltre.yaml": GROUPS_INDEX },
    );
    const libs = await resolveLibraries(root, [{ id: "futuro", version: "1.0.0", hash: "" }]);
    // Better finding nothing than reading an index with the wrong format.
    expect((await libraryIndexFor(libs)).entries).toEqual([]);
    expect(await findInLibrary(libs, "la Piazza era piena")).toEqual([]);
  });
});

describe("paths leaving the library", () => {
  it("refuses a path that climbs above the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-percorso-"));
    expect(() => libraryPath(root, "../segreto.md")).toThrow(
      /Invalid entry path|Entry path outside the library/,
    );
    expect(() => libraryPath(root, "..\\segreto.md")).toThrow();
    expect(() => libraryPath(root, "/etc/passwd")).toThrow();
    expect(() => libraryPath(root, "C:/Windows/system32")).toThrow();
    expect(() => libraryPath(root, "")).toThrow();
    expect(libraryPath(root, "voci/oltre/entry.md")).toBe(join(root, "voci", "oltre", "entry.md"));
  });

  it("doesn't accept a descriptor whose path leaves the library", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-percorso-"));
    await makeLibrary(
      root,
      "fuori",
      OTHER_FORMAT.replace(
        'entryPath: "voci/{group}/{section}/{slug}.md"',
        'entryPath: "../rubato/{slug}.md"',
      ),
      { "topponi/oltre.yaml": LOCATIONS_INDEX, "sodal/oltre.yaml": GROUPS_INDEX },
    );
    const libs = await resolveLibraries(root, [{ id: "fuori", version: "1.0.0", hash: "" }]);
    expect(libs[0]?.state).toBe("ok");
    // The descriptor doesn't hold: better a library that says nothing than one
    // reading outside the folder the world asked for.
    expect(libs[0]?.layout).toBeNull();
    expect((await libraryIndexFor(libs)).entries).toEqual([]);
  });

  it("an entry declaring its own path is discarded if it escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-percorso-"));
    await writeFile(join(root, "segreto.md"), "questo non deve finire mai nel contesto\n", "utf8");
    await makeLibrary(
      root,
      "con-percorso",
      OTHER_FORMAT.replace(
        "    categories: etichette",
        "    categories: etichette\n    file: percorso",
      ),
      {
        "topponi/oltre.yaml": `- titolo: "Piazza Maggiore"
  percorso: "../../segreto.md"
  etichette: ["Oltre luoghi"]
- titolo: "Molo Alto"
  percorso: "voci/oltre/topponi/molo-alto.md"
  etichette: ["Oltre luoghi"]
`,
        "sodal/oltre.yaml": GROUPS_INDEX,
      },
    );
    const libs = await resolveLibraries(root, [{ id: "con-percorso", version: "1.0.0", hash: "" }]);
    await writeEntriesFromIndex(root, "con-percorso");
    const subjects = (await libraryIndexFor(libs)).entries.map((entry) => entry.subject);
    expect(subjects).toContain("Molo Alto");
    expect(subjects).not.toContain("Piazza Maggiore");

    const hits = await findInLibrary(libs, "la Piazza Maggiore era piena");
    expect(renderLibraryHits(hits)).not.toContain("questo non deve finire");
  });
});

describe("broken descriptor", () => {
  it("doesn't stop the library from opening, and simply gives no entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "lore-rotto-"));
    await makeLibrary(
      root,
      "rotta",
      OTHER_FORMAT.replace('  ignoreWords: ["borgo"]', "  ignoreWords: 42"),
      { "topponi/oltre.yaml": LOCATIONS_INDEX, "sodal/oltre.yaml": GROUPS_INDEX },
    );
    const libs = await resolveLibraries(root, [{ id: "rotta", version: "1.0.0", hash: "" }]);
    expect(libs[0]?.state).toBe("ok");
    expect(libs[0]?.layout).toBeNull();
    expect(await findInLibrary(libs, "la Piazza Maggiore")).toEqual([]);
  });
});
