#!/usr/bin/env node
import { defaultDataDir } from "../config/paths.js";
import { loadSettings } from "../config/settings.js";
import { inspect } from "../diagnostics.js";
import { configureLogLevel, errorDetail, log } from "../logging.js";

function line(label: string, value: string): void {
  process.stdout.write(`${label.padEnd(26)}${value}\n`);
}

async function main(): Promise<void> {
  configureLogLevel();
  const dataDir = process.argv[2] ?? defaultDataDir();
  const settings = await loadSettings(dataDir);

  line("Node", process.version);
  line("Data folder", dataDir);
  line("Language", settings.uiLocale);
  process.stdout.write("\n");

  const report = await inspect(dataDir, settings.opencodePort, settings.host);

  line("Binary", report.binary.path ?? "not found");
  line("Binary version", report.binary.version ?? "-");
  line("Server version", report.version ?? "-");
  line("Server", `${report.baseUrl} (${report.healthy ? "ready" : "not ready"})`);
  line("Connected providers", report.providers.length > 0 ? report.providers.join(", ") : "-");
  line("Recommended for the narrator", report.narratorModels.length > 0 ? "yes" : "none");
  line("With warning", report.restrictedModels.length > 0 ? "yes" : "none");
  process.stdout.write("\n");

  for (const model of report.narratorModels) {
    process.stdout.write(`  narrator   ${model}\n`);
  }
  for (const model of report.restrictedModels) {
    process.stdout.write(`  warning   ${model}\n`);
  }

  if (report.defaultModel) {
    process.stdout.write(`\nDefault model: ${report.defaultModel}\n`);
  }
  if (report.problem) {
    process.stdout.write(`\nProblem: ${report.problem}\n`);
  }

  process.stdout.write(report.healthy ? "\nReady.\n" : "\nNot ready: follow the message above.\n");
  process.exitCode = report.healthy ? 0 : 1;

  /*
   * The same outcome on the log, because the exit code is not a log.
   *
   * A script that fails leaves a code and nothing else, and the person reading the
   * output has already closed the terminal by the time they want to know what
   * happened. The line says the same thing the table says, in the shape the rest of
   * the project logs in.
   */
  log[report.healthy ? "info" : "warn"]("doctor.finished", {
    healthy: report.healthy,
    problem: report.problem,
    binary: report.binary.path ?? null,
    server: report.baseUrl,
  });
}

main().catch((error: unknown) => {
  log.error("doctor.failed", { reason: errorDetail(error) });
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
