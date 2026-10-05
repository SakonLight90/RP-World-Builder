#!/usr/bin/env node
/**
 * Is the compiled output still current?
 *
 * Exits 0 when it is, 1 when it has to be rebuilt. `start.bat` and `start.sh`
 * run this so the platform can be started by double-clicking them: rebuilding
 * takes about a minute, and paying it on every launch to rebuild nothing is its
 * own kind of slow.
 *
 * The comparison is newest source against oldest output. Newest source is the
 * safe direction: it means anything edited recently forces a rebuild even if the
 * edit turned out to be a comment. The other direction would let one stale file
 * ship, and this project's whole premise is that the thing that runs is the
 * thing that is in the repository.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/**
 * The stamp a successful build writes, and the only trustworthy answer to "when
 * did this compile last".
 *
 * The tempting version is to read the timestamp of a built file, and it is
 * wrong: `tsc -b` is incremental, so recompiling code that came out identical
 * writes nothing and leaves the old timestamp in place. A build that ran ten
 * minutes ago looks like one from yesterday, and the launcher then rebuilds
 * every single time. The stamp is written by the launcher after both builds
 * succeed, so it moves exactly when the build happened.
 */
const STAMP = ".build-stamp";

/** Everything whose change can change the output. */
const SOURCE_DIRS = [
  join("packages", "shared", "src"),
  join("packages", "server", "src"),
  join("packages", "web", "src"),
];

const SOURCE_FILES = ["package.json", "tsconfig.base.json", "tsconfig.json", "biome.jsonc"];

/** Newest `.ts`/`.tsx`/`.css`/`.md` under a directory, or 0 if it is not there. */
function newestSource(dir) {
  let newest = 0;
  if (!existsSync(dir)) return newest;

  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx|css|md|json)$/.test(entry.name)) continue;
    newest = Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs);
  }
  return newest;
}

const changed = [];
for (const source of [
  ...SOURCE_DIRS.map((d) => [d, newestSource(d)]),
  ...SOURCE_FILES.map((f) => [f, existsSync(join(root, f)) ? statSync(join(root, f)).mtimeMs : 0]),
]) {
  const [name, newest] = source;
  if (newest > 0) changed.push([name, newest]);
}

const stamp = join(root, STAMP);
if (!existsSync(stamp)) {
  console.error("This checkout has never been built.");
  process.exit(1);
}

const builtAt = statSync(stamp).mtimeMs;
const newest = Math.max(...changed.map(([, when]) => when));

if (newest > builtAt) {
  console.error("Sources changed after the last build.");
  process.exit(1);
}

// Nothing to say. A line here on every launch would train the reader to ignore
// the lines that matter.
process.exit(0);
