#!/usr/bin/env node
/**
 * Are the dependencies of this checkout installed?
 *
 * Exits 0 when they are, 1 when they are not, and prints what is missing when
 * they are not. `start.bat` and `start.sh` run this before starting, so a
 * machine that has never run `npm install` is prepared rather than met halfway.
 *
 * Two ways this could be done, and the one not used is worth naming: comparing
 * the timestamp of `package.json` against `node_modules`. It is one line, it is
 * wrong, and it is wrong in the direction that costs minutes — adding a script
 * to `package.json` does not change a single dependency, but it does make the
 * file newer than the install, so the launcher would tear down and rebuild the
 * whole tree to install nothing. This asks the actual question instead: is every
 * declared dependency present on disk?
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

/** Every dependency name declared anywhere in this workspace tree. */
function declared(root) {
  const names = new Set();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
  }

  // The workspaces too: `npm ci` installs them in the same pass, so a package
  // missing there is just as much a missing dependency as one missing at the
  // root, and it is the more likely one to be overlooked.
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir)) {
      const file = join(packagesDir, entry, "package.json");
      if (!existsSync(file)) continue;
      const workspace = JSON.parse(readFileSync(file, "utf8"));
      for (const field of DEPENDENCY_FIELDS) {
        for (const name of Object.keys(workspace[field] ?? {})) names.add(name);
      }
    }
  }
  return names;
}

/**
 * The commands this project actually runs, and the tests it claims to have.
 *
 * A dependency folder can exist while the executable is missing: that is what a
 * half-finished install looks like, and it fails later with "tsx is not
 * recognised" instead of here with a name.
 */
const REQUIRED_BINARIES = [".bin/tsx", ".bin/next", ".bin/vitest", ".bin/biome"];

const root = process.cwd();
const modules = join(root, "node_modules");

if (!existsSync(modules)) {
  console.error("node_modules does not exist.");
  process.exit(1);
}

const missing = [];
for (const name of declared(root)) {
  if (!existsSync(join(modules, name))) missing.push(name);
}
for (const binary of REQUIRED_BINARIES) {
  if (!existsSync(join(modules, binary))) missing.push(binary);
}

if (missing.length > 0) {
  // Sorted so the message is the same twice in a row, which matters when a
  // person is comparing it against a failing install log.
  console.error(`Missing from node_modules: ${missing.sort().join(", ")}`);
  process.exit(1);
}
