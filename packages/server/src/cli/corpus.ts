#!/usr/bin/env node
import { DEFAULT_NARRATOR_MODEL, REASONING_EFFORTS, type ReasoningEffort } from "@rpwb/shared";
import { dbPath, ensureDir, resolveRoots } from "../config/paths.js";
import { loadCorpus, validateCorpus } from "../corpus/load.js";
import { openDatabase } from "../db/connection.js";
import { configureLogLevel, log } from "../logging.js";

const MODE = process.argv[2] ?? "validate";
configureLogLevel();

function pickReasoning(): ReasoningEffort {
  const asked = process.env.RPWB_REASONING;
  if (asked === undefined) return "default";
  const found = REASONING_EFFORTS.find((effort) => effort === asked);
  if (found === undefined) {
    process.stderr.write(
      `RPWB_REASONING "${asked}" is invalid. Values: ${REASONING_EFFORTS.join(", ")}. Using "default".\n`,
    );
  }
  return found ?? "default";
}

const options = {
  model: process.env.RPWB_MODEL ?? DEFAULT_NARRATOR_MODEL,
  smallModel: process.env.RPWB_SMALL_MODEL ?? DEFAULT_NARRATOR_MODEL,
  reasoningEffort: pickReasoning(),
};

process.stdout.write(`Model: ${options.model}\n`);
process.stdout.write(`Reasoning effort: ${options.reasoningEffort}\n`);
process.stdout.write("\n");

// Roots are resolved once, here: from here on they travel explicitly.
// This command runs by hand and as a service, and the folder it starts from
// is not necessarily the repository one.
const roots = resolveRoots();
const dataDir = roots.data;
await ensureDir(dataDir);
const root = roots.corpus;

process.stdout.write(`Corpus: ${root}\n`);

const problems = await validateCorpus(root, roots.lore);
const errors = problems.filter((problem) => problem.severity === "error");
const warnings = problems.filter((problem) => problem.severity === "warning");

for (const problem of warnings) {
  process.stdout.write(`  warning  ${problem.file}: ${problem.message}\n`);
}
for (const problem of errors) {
  process.stdout.write(`  error  ${problem.file}: ${problem.message}\n`);
}

process.stdout.write(
  `\n${problems.length === 0 ? "No problems." : `${errors.length} errors, ${warnings.length} warnings.`}\n`,
);

let loadedCount = 0;
if (MODE === "load") {
  const db = openDatabase({ path: dbPath(dataDir), now: () => new Date().toISOString() });
  try {
    const loaded = await loadCorpus(db, {
      root,
      loreRoot: roots.lore,
      model: options.model,
      smallModel: options.smallModel,
      reasoningEffort: options.reasoningEffort,
      worldsDir: roots.worlds,
      recreate: process.argv.includes("--recreate"),
      log: (message) => process.stdout.write(`${message}\n`),
    });
    loadedCount = loaded.length;
    process.stdout.write(`\nWorlds loaded: ${loaded.length}\n`);
  } finally {
    db.close();
  }
}

process.exitCode = errors.length === 0 ? 0 : 1;

/*
 * The outcome on the log, for the same reason as `doctor`: the exit code is not a
 * record, and a corpus that failed to load is the kind of thing somebody wants to
 * read about later rather than rediscover.
 *
 * The counts are the line. "3 errors" is a number; "3 errors, 2 warnings, 1 world
 * loaded" is what happened, and the difference between a corpus that loaded and one
 * that refused is exactly that second half.
 */
log[errors.length === 0 ? "info" : "error"]("corpus.finished", {
  mode: MODE,
  errors: errors.length,
  warnings: warnings.length,
  worlds: MODE === "load" ? loadedCount : null,
});
