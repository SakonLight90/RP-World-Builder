import { DEFAULT_UI_LOCALE, UI_LOCALES, type UiLocale } from "@rpwb/shared";
import { de } from "./de";
import { en, type MessageKey } from "./en";
import { es } from "./es";
import { interpolate } from "./format";
import { fr } from "./fr";
import { it } from "./it";
import type { Messages, MessageValues } from "./types";

export { interpolate } from "./format";
export { DEFAULT_UI_LOCALE, LOCALE_NAMES, UI_LOCALES } from "./types";
export type { MessageKey, Messages, MessageValues, UiLocale };

/**
 * One catalog per language, and English as the safety net.
 *
 * The map is `Record<UiLocale, Messages>` rather than a lookup with a cast, so
 * adding a language to `UI_LOCALES` without a catalog is a compile error.
 */
const CATALOGS: Record<UiLocale, Messages> = { en, it, es, fr, de };

/**
 * Turns whatever the settings file holds into a language that exists.
 *
 * `uiLocale` is free text in `config.json`, so it can be anything: a locale tag
 * (`it-IT`), a language that was removed, a typo, an empty string. None of those
 * may reach the interface as a missing catalog, so anything unrecognised resolves
 * to the default instead of returning `undefined`.
 */
export function resolveLocale(value: string | null | undefined): UiLocale {
  if (!value) return DEFAULT_UI_LOCALE;
  const base = value.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  const match = UI_LOCALES.find((language) => language === base);
  return match ?? DEFAULT_UI_LOCALE;
}

/** True when the string is exactly one of the interface languages. */
export function isUiLocale(value: string): value is UiLocale {
  return (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * Looks a key up in one language, then in English.
 *
 * The two-step lookup is what makes a partial catalog safe: `it` is typed as
 * complete, but a hand-edited file or a bad merge can still leave a hole, and
 * showing the English string is a far smaller failure than showing nothing.
 */
export function translate(locale: UiLocale, key: MessageKey, values?: MessageValues): string {
  const catalog = CATALOGS[locale];
  const template = catalog[key] ?? en[key] ?? key;
  return interpolate(template, values);
}

/** The whole catalog for a language. Useful in tests and nowhere else. */
export function catalogFor(locale: UiLocale): Messages {
  return CATALOGS[locale];
}
