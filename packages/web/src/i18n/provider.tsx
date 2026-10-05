"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../lib/api";
import {
  DEFAULT_UI_LOCALE,
  type MessageKey,
  type MessageValues,
  translate,
  UI_LOCALES,
  type UiLocale,
} from "./index";

/** What every component gets: the language, a translator, and the switch. */
export interface I18n {
  locale: UiLocale;
  t: (key: MessageKey, values?: MessageValues) => string;
  /** Changes the interface language and saves it, so it survives a restart. */
  setLocale: (next: UiLocale) => void;
}

const I18nContext = createContext<I18n | null>(null);

/**
 * Where the interface language comes from.
 *
 * The site's own settings, not a browser header and not a per-component default:
 * the language is a choice the user made once, in `/setup`, and it applies to
 * every screen including the ones they have never opened. Reading it here, once,
 * is what makes that true.
 *
 * The first paint happens before the settings arrive, so it uses the fallback.
 * That is a deliberate short flash rather than a `suppressHydrationWarning`
 * trick on `<html lang>`: the server cannot know the language, so it states the
 * one it can guarantee, and the real one replaces it as soon as the fetch lands.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_UI_LOCALE);

  useEffect(() => {
    let alive = true;
    api
      .settings()
      .then((result) => {
        if (!alive) return;
        const next = result.settings.uiLocale;
        if ((UI_LOCALES as readonly string[]).includes(next)) {
          setLocaleState(next as UiLocale);
        }
      })
      .catch(() => {
        /* The interface stays on the fallback: a settings file that cannot be
           read is not a reason to leave the page blank. */
      });
    return () => {
      alive = false;
    };
  }, []);

  // The document language is not decoration: it drives the browser's own
  // hyphenation, spellcheck and screen-reader pronunciation.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    // Optimistic on purpose, then saved. The interface must switch under the
    // finger, not after a disk write; if the save fails the setting is still
    // whatever was there before and the choice can be made again.
    void api.updateSettings({ uiLocale: next }).catch(() => undefined);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The interface language in context.
 *
 * Throws outside the provider rather than returning a silent default: a missing
 * provider means the tree is wired wrong, and a component that quietly falls
 * back to English hides that until someone reads the screen in the wrong
 * language and cannot explain why.
 */
export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}
