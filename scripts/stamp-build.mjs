/**
 * Records that a build just finished.
 *
 * Written by the launcher, after both builds have succeeded, and it is what
 * `check-build.mjs` compares against. See that file for why the timestamp of a
 * compiled file cannot answer the same question.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

writeFileSync(join(process.cwd(), ".build-stamp"), `${new Date().toISOString()}\n`, "utf8");
