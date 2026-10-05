import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const CONFIG_FILENAME = "world-builder.config.json";

/**
 * The manifest that says which package this is.
 *
 * It is used by the discovery below: going up from the name declared in its own
 * `package.json`, the package root is recognised without counting how many levels
 * are above it, which change between `src/` and `dist/` and from one checkout to
 * another.
 */
const PACKAGE_NAME = "@rpwb/server";

/**
 * All the project roots, resolved once.
 *
 * No module deduces them: it receives them. See `ARCHITECTURE.md`, section 1.
 */
export interface ProjectRoots {
  /** Repository root: the folder that contains `packages/`, `corpus/`, `lore/`. */
  repo: string;
  /** Corpus root: one folder per world, hand-written source. */
  corpus: string;
  /** Lore libraries root: versioned content, read-only. */
  lore: string;
  /** Narrator prompt folder: holds `gm.md`. */
  prompts: string;
  /** User state: database, worlds, configuration. Deletable and regenerable. */
  data: string;
  /** Worlds folder, inside the data. */
  worlds: string;
}

/** A directory's manifest, if there is one and it is a JSON object. */
function manifestIn(dir: string): Record<string, unknown> | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The first directory, walking up from `da`, whose manifest is accepted. */
function findUp(
  da: string,
  accetta: (manifest: Record<string, unknown>) => boolean,
): string | null {
  let corrente = resolve(da);
  for (;;) {
    const manifest = manifestIn(corrente);
    if (manifest !== null && accetta(manifest)) return corrente;
    const sopra = dirname(corrente);
    if (sopra === corrente) return null; // filesystem root
    corrente = sopra;
  }
}

let pacchettoRoot: string | null = null;
let repositoryRoot: string | null = null;

/**
 * Root of the server package: the folder that contains `prompts/`.
 *
 * The sentinel is the name declared in that package's `package.json`, so the
 * search does not count levels: it works from `src/` and from `dist/`, with `tsx`
 * and with the build.
 */
export function packageRoot(): string {
  if (pacchettoRoot !== null) return pacchettoRoot;
  const trovato = findUp(import.meta.dirname, (manifest) => manifest.name === PACKAGE_NAME);
  if (trovato === null) {
    throw new Error(
      `Cannot find the package ${PACKAGE_NAME}: I walked up from ${import.meta.dirname} ` +
        "without finding a package.json declaring that name. The package was " +
        "moved or copied outside the repository.",
    );
  }
  pacchettoRoot = trovato;
  return trovato;
}

/**
 * Repository root: the folder that contains `corpus/` and `lore/`.
 *
 * Why it is not taken from `process.cwd()`.
 *
 * `process.cwd()` is the folder someone typed `node` in, not the folder the
 * project is in: the two coincide only if the command was typed by hand inside
 * the repository. Started from a service tab, from `npm --prefix`, from a double
 * click on an executable or from a parent folder pointing elsewhere, the flaw
 * does not say it is a path flaw: it says the library is missing, that the corpus
 * is empty, that the prompt is gone. Half an hour is lost looking for the
 * container instead of the cause.
 *
 * So the root is searched from **where this module was loaded**, the only thing
 * that does not depend on who started the process: `import.meta.dirname` is the
 * folder of this file, in `src/` as in `dist/`, with `tsx` as with the build, in a
 * checkout as installed. From there it walks up until it finds a sentinel, and the
 * sentinel is a **property of the file**, not a distance: the nearest
 * `package.json` declaring `workspaces`, which is the very definition of a
 * workspace root.
 *
 * Why it is reliable: the search does not count levels, so it does not break if
 * the package moves, if the repository is renamed or if the machine is a
 * different one; it does not compare folder names, which are a choice of whoever
 * cloned it; and if the sentinel is not there it says so, instead of returning an
 * invented path that later shows up as "the library is missing".
 *
 * The price is that the package has to stay inside the workspace it was built
 * from: whoever puts it elsewhere declares it with `RPWB_REPO_ROOT`, and that is
 * the only case where something has to be configured.
 */
export function repoRoot(): string {
  const override = envPath("RPWB_REPO_ROOT");
  if (override !== null) return override;
  if (repositoryRoot !== null) return repositoryRoot;

  const trovato = findUp(packageRoot(), (manifest) => Array.isArray(manifest.workspaces));
  if (trovato === null) {
    throw new Error(
      `Cannot find the repository root: I walked up from ${packageRoot()} without ` +
        "finding a package.json declaring workspaces. Set RPWB_REPO_ROOT " +
        "to the folder containing corpus and lore.",
    );
  }
  repositoryRoot = trovato;
  return trovato;
}

/** An environment override: empty or blanks are not an override. */
function envPath(name: string): string | null {
  const value = process.env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : resolve(trimmed);
}

/**
 * All the project roots, together.
 *
 * It is called once, where the application is built, and the result travels
 * explicitly. Every root has an environment override and a default that works
 * without configuring anything.
 *
 * - corpus: `RPWB_CORPUS_ROOT`, otherwise `corpus/` in the repository root. In
 *   development and in production it is the same folder, so the corpus can be
 *   edited and reloaded without reinstalling the package.
 * - libraries: `RPWB_LORE_DIR`, otherwise `lore/` in the repository root. It
 *   lives outside `data/` because `data/` is user state, regenerable and
 *   deletable, while a library is versioned content: put where the databases are,
 *   at some point it would be treated as a cache and would disappear.
 * - prompt: `RPWB_PROMPTS_DIR`, otherwise `prompts/` next to this package's
 *   code, which is the only place where the prompt is readable and diffable.
 *   `canon/gm-agent.ts` reads the same file from there.
 * - data: `RPWB_DATA_DIR`, otherwise the system data folder. Being inside the
 *   repository during development is fine too, because the `.gitignore` excludes
 *   `data/` and the configuration file.
 */
export function resolveRoots(): ProjectRoots {
  const repo = repoRoot();
  const data = resolve(defaultDataDir());
  return {
    repo,
    corpus: envPath("RPWB_CORPUS_ROOT") ?? join(repo, "corpus"),
    lore: envPath("RPWB_LORE_DIR") ?? join(repo, "lore"),
    prompts: envPath("RPWB_PROMPTS_DIR") ?? join(packageRoot(), "prompts"),
    data,
    worlds: worldsDir(data),
  };
}

/**
 * The user's data folder. Being inside the repo during development is fine too,
 * because the `.gitignore` excludes `data/` and the configuration file.
 */
export function defaultDataDir(): string {
  const override = process.env.RPWB_DATA_DIR;
  if (override && override.trim() !== "") return override.trim();

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "rp-world-builder");
    return join(homedir(), "AppData", "Roaming", "rp-world-builder");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "rp-world-builder");
  }

  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "rp-world-builder");
  return join(homedir(), ".local", "share", "rp-world-builder");
}

export async function ensureDir(path: string): Promise<string> {
  await mkdir(path, { recursive: true });
  return path;
}

export function dbPath(dataDir: string): string {
  return join(dataDir, "rpwb.db");
}

export function worldsDir(dataDir: string): string {
  return join(dataDir, "worlds");
}

export function worldDir(dataDir: string, slug: string): string {
  return join(worldsDir(dataDir), slug);
}

/** A world cannot change identity after creation. */
export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base === "" ? "world" : base;
}
