import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_UI_LOCALE, type Settings, UI_LOCALES, type UiLocale } from "@rpwb/shared";
import { CONFIG_FILENAME } from "./paths.js";

export const DEFAULT_SETTINGS: Settings = {
  uiLocale: DEFAULT_UI_LOCALE,
  dataDir: "",
  port: 3311,
  host: "127.0.0.1",
  setupCompleted: false,
  opencodeBaseUrl: null,
  opencodePort: 4599,
  preferredModel: null,
  preferredSmallModel: null,
};

function coerce(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const input = raw as Record<string, unknown>;
  const locale = input["uiLocale"];

  return {
    uiLocale: isUiLocale(locale) ? locale : DEFAULT_SETTINGS.uiLocale,
    dataDir: str(input["dataDir"]) ?? DEFAULT_SETTINGS.dataDir,
    port: int(input["port"]) ?? DEFAULT_SETTINGS.port,
    host: str(input["host"]) ?? DEFAULT_SETTINGS.host,
    setupCompleted: input["setupCompleted"] === true,
    opencodeBaseUrl: str(input["opencodeBaseUrl"]),
    opencodePort: int(input["opencodePort"]) ?? DEFAULT_SETTINGS.opencodePort,
    preferredModel: str(input["preferredModel"]),
    preferredSmallModel: str(input["preferredSmallModel"]),
  };
}

function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function configFilePath(dataDir: string): string {
  return join(dataDir, CONFIG_FILENAME);
}

export async function loadSettings(dataDir: string): Promise<Settings> {
  try {
    const raw = await readFile(configFilePath(dataDir), "utf8");
    const settings = coerce(JSON.parse(raw));
    return { ...settings, dataDir };
  } catch {
    return { ...DEFAULT_SETTINGS, dataDir };
  }
}

/**
 * Saves settings to the configuration file.
 *
 * It exists because the `settings` table in the database and the configuration file
 * are two different places: the server reads port, host and models from here
 * at startup, so a route saving only to the database would write values
 * nobody rereads. Anyone changing port or host must restart anyway: the
 * server already opened ports with the old values, and rereading them halfway
 * would move the address under open tabs.
 */
export async function saveSettings(dataDir: string, patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings(dataDir);
  const next = { ...current, ...patch, dataDir };
  await writeFile(configFilePath(dataDir), JSON.stringify(next, null, 2), "utf8");
  return next;
}
