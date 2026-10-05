#!/usr/bin/env node
import { defaultDataDir } from "../config/paths.js";
import { loadSettings } from "../config/settings.js";
import { inspect } from "../diagnostics.js";

function line(label: string, value: string): void {
  process.stdout.write(`${label.padEnd(26)}${value}\n`);
}

async function main(): Promise<void> {
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
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
