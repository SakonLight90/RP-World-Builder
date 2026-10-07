import { z } from "zod";

/**
 * The languages the interface ships in.
 *
 * This is the only list: the server validates `uiLocale` against it, and the
 * interface builds one catalog per entry. Three copies of five language codes
 * is three chances to add a language in two of them.
 */
export const UI_LOCALES = ["en", "it", "es", "fr", "de"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

/**
 * The language a fresh install starts in, and the one an unreadable setting
 * falls back to.
 *
 * English, and not the author's language, because everything a reader would
 * otherwise have to guess is written in English: the code, the documentation and
 * the narrator prompt. Defaulting to anything else means the first screen a new
 * user sees is the one screen whose wording nobody on the project can check.
 */
export const DEFAULT_UI_LOCALE: UiLocale = "en";

/**
 * How each language names itself, for a picker.
 *
 * An endonym, so a reader who cannot tell Spanish from French by shape still
 * finds their own language in the list.
 */
export const LOCALE_NAMES: Record<UiLocale, string> = {
  en: "English",
  it: "Italiano",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

/**
 * How each language is named inside an English sentence.
 *
 * A second map on purpose, and the reason is that no algorithm can derive it:
 * "Italiano" belongs in a list of names and "Italian" in a sentence, and neither
 * converts to the other. `German` has the same problem the other way round — it
 * lowercases to something that is not a word in English. Two explicit maps beat
 * one map and a transformation that is wrong twice.
 */
export const LOCALE_NAMES_IN_SENTENCE: Record<UiLocale, string> = {
  en: "English",
  it: "Italian",
  es: "Spanish",
  fr: "French",
  de: "German",
};

/** The primary subtag of a language tag, like `pt` or `en`. */
const LOCALE_TAG = /^[a-z]{2,3}$/;

/**
 * The language name for `locale`, for use in an English sentence.
 *
 * Accounts for the subtag because `en-GB` is the shape browsers send: without
 * this, a British English interface would end up in the prompt as a code
 * and the narrator would keep writing the fallback language, which is the defect
 * being removed.
 *
 * A language outside the map is not silently declared as the default: its code
 * is still more useful than a lie, because the model recognises it, whereas
 * declaring the wrong language to someone playing in Portuguese fails in a way
 * nobody reports. The default is used only when there is no code at all, which
 * is the only case where guessing is the sensible thing to do.
 */
export function localeName(locale: string): string {
  const raw = locale.trim();
  const base = raw.toLowerCase().split(/[-_]/u)[0] ?? "";
  const key = UI_LOCALES.find((code) => code === base);
  // Only the primary subtag: what follows distinguishes regional variants of a
  // language the narrator writes the same way, so it is noise in the prompt.
  if (key !== undefined) return LOCALE_NAMES_IN_SENTENCE[key];
  if (LOCALE_TAG.test(base)) return base;
  return LOCALE_NAMES_IN_SENTENCE[DEFAULT_UI_LOCALE];
}

export interface Settings {
  uiLocale: UiLocale;
  dataDir: string;
  port: number;
  host: string;
  setupCompleted: boolean;
  /** URL of an already running opencode instance, if the user manages it directly. */
  opencodeBaseUrl: string | null;
  opencodePort: number;
  preferredModel: string | null;
  preferredSmallModel: string | null;
}

/** A model offered by opencode, with the costs needed to tell whether it is free. */
export interface ModelInfo {
  providerId: string;
  modelId: string;
  /** Full `provider/model` identifier, as used in opencode.json. */
  ref: string;
  name: string;
  contextLimit: number;
  inputCost: number;
  outputCost: number;
  /**
   * Price of a cached token, when the provider declares one.
   *
   * Not assumed to be the input price: the providers that bill the cache do so at a
   * discount, and that discount is why a long context is affordable on them. It is
   * what a turn's cost has to be computed with, and `input` alone overstates it.
   *
   * Zero when there is no separate cache price, which means the provider does not
   * bill the cache separately. That is not the same as a provider with a cache at
   * zero cost, and the two are not distinguished here because they cost the same.
   */
  cacheReadCost: number;
  cacheWriteCost: number;
  free: boolean;
  /** Trains future models on prompts and responses. */
  trainsOnPrompts: boolean;
  /** Data retention declared by the provider. */
  zeroRetention: boolean;
  /** Retention note, shown in the picker. */
  privacyNote: string;
  /** Whether the model can be picked as narrator without warning. */
  admissibleByDefault: boolean;
  /** The model accepts a reasoning level. */
  reasoning: boolean;
}

export interface BridgeStatus {
  state: "stopped" | "starting" | "ready" | "error";
  mode: "attached" | "spawned";
  baseUrl: string;
  version: string | null;
  pid: number | null;
  error: string | null;
}

export interface HealthReport {
  healthy: boolean;
  version: string | null;
  baseUrl: string;
  /** Verified via the CLI, which is the only source for the binary version. */
  binary: { found: boolean; version: string | null; path: string | null };
  providers: string[];
  freeModels: string[];
  /** Models suited as narrator without warnings. */
  narratorModels: string[];
  /** Models the player must pick knowing they retain data. */
  restrictedModels: string[];
  defaultModel: string | null;
  problem: string | null;
}

export const TurnRequestSchema = z.object({
  text: z.string().min(1).max(20_000),
  locale: z.string().min(2).max(16),
});

export type TurnRequest = z.infer<typeof TurnRequestSchema>;
