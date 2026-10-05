import { ERROR_CATALOG, type ErrorCode } from "@rpwb/shared";
import { describe, expect, it } from "vitest";
import { en, english, type MessageKey } from "../src/i18n/en.js";
import {
  catalogFor,
  DEFAULT_UI_LOCALE,
  interpolate,
  isUiLocale,
  LOCALE_NAMES,
  type Messages,
  resolveLocale,
  translate,
  UI_LOCALES,
  type UiLocale,
} from "../src/i18n/index.js";

/**
 * The interface catalogs, checked against each other.
 *
 * The four translations are typed as `Record<MessageKey, string>`, so a missing
 * key is already a compile error. What the type cannot see is what actually
 * goes wrong in a catalog: a value left in English, a value that is empty, and
 * a translator who dropped a `{{count}}` because that sentence had one more
 * number in it than the one above. Those all compile, and all reach a screen.
 * The suite below is the check that they don't: it never reads the source, only
 * what the catalogs say about each other, so it also catches a hand-edited
 * fragment that a merge left half translated.
 */

/** The reference key set: English defines it and the others are checked against it. */
const EN_KEYS = Object.keys(en) as MessageKey[];

function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]));
}

/** Every language except the reference one, so a check cannot compare a catalog with itself. */
const TRANSLATIONS: readonly UiLocale[] = UI_LOCALES.filter(
  (language) => language !== DEFAULT_UI_LOCALE,
);

describe("catalog completeness", () => {
  it("the reference key set is non-empty: a loop over nothing passes every check below", () => {
    expect(EN_KEYS.length).toBeGreaterThan(0);
  });

  it("every language carries every English key", () => {
    for (const language of UI_LOCALES) {
      const catalog = catalogFor(language);
      const missing = EN_KEYS.filter((key) => !(key in catalog));

      expect({ language, missing }).toEqual({ language, missing: [] });
    }
  });

  it("no language carries a key English does not have", () => {
    // A leftover key is invisible: nothing asks for it, so it survives every
    // later rename of the string it belonged to.
    for (const language of UI_LOCALES) {
      const extra = Object.keys(catalogFor(language)).filter((key) => !(key in en));

      expect({ language, extra }).toEqual({ language, extra: [] });
    }
  });
});

describe("catalog values", () => {
  it("no value is empty or only whitespace", () => {
    // An empty value is a string that satisfies the type and renders nothing:
    // a label with no word, which reads as a broken page rather than a gap.
    const blank: { language: UiLocale; key: string; value: string }[] = [];

    for (const language of UI_LOCALES) {
      const catalog: Messages = catalogFor(language);

      for (const [key, value] of Object.entries(catalog)) {
        if (value.trim() === "") blank.push({ language, key, value });
      }
    }

    expect(blank).toEqual([]);
  });
});

describe("placeholders", () => {
  it("each translation keeps exactly the placeholders English has", () => {
    // The defect this catches is asymmetric: an Italian sentence that lost
    // `{{count}}` still typechecks, still renders, and quietly says "3 chapters"
    // as "chapters". Word order belongs to the translator, the set of names does not.
    const drifted: { language: UiLocale; key: MessageKey; expected: string; found: string }[] = [];

    for (const language of UI_LOCALES) {
      const catalog = catalogFor(language);

      for (const key of EN_KEYS) {
        const expected = [...placeholders(english(key))].sort();
        const found = [...placeholders(catalog[key])].sort();

        if (expected.join(",") !== found.join(",")) {
          drifted.push({ language, key, expected: expected.join(","), found: found.join(",") });
        }
      }
    }

    expect(drifted).toEqual([]);
  });
});

describe("resolveLocale", () => {
  it("keeps a code that is already one of ours", () => {
    for (const language of UI_LOCALES) {
      expect(resolveLocale(language)).toBe(language);
    }
  });

  it("falls back instead of inventing a language", () => {
    // `uiLocale` is free text in a hand-edited `config.json`, so every one of
    // these is reachable. None of them may become a catalog that does not exist.
    for (const value of [undefined, null, "", "xx", "klingon"]) {
      expect(resolveLocale(value)).toBe(DEFAULT_UI_LOCALE);
    }
  });

  it("reduces a regional, uppercase or padded variant to its base", () => {
    // What an operating system or a browser actually hands over: "it-IT",
    // "it_IT", "DE". These are the same language and must not read as a typo.
    expect(resolveLocale("it-IT")).toBe("it");
    expect(resolveLocale("it_IT")).toBe("it");
    expect(resolveLocale("DE")).toBe("de");
    expect(resolveLocale(" de ")).toBe("de");
  });
});

describe("isUiLocale", () => {
  it("accepts the shipped codes", () => {
    for (const language of UI_LOCALES) {
      expect(isUiLocale(language)).toBe(true);
    }
  });

  it("rejects a variant tag and an unknown code", () => {
    // Strictly the base code: `resolveLocale` normalises, `isUiLocale` checks.
    expect(isUiLocale("it-IT")).toBe(false);
    expect(isUiLocale("xx")).toBe(false);
  });
});

describe("interpolate", () => {
  it("substitutes a string value", () => {
    expect(interpolate("chapter {{n}}", { n: "seven" })).toBe("chapter seven");
  });

  it("substitutes a number", () => {
    expect(interpolate("chapter {{n}}", { n: 7 })).toBe("chapter 7");
  });

  it("substitutes every occurrence of a repeated placeholder", () => {
    // A value that appears twice in one sentence must not survive only once:
    // the pattern is global precisely so this cannot happen.
    expect(interpolate("{{n}} of {{n}}", { n: 3 })).toBe("3 of 3");
  });

  it("leaves a placeholder with no value visible", () => {
    // Not a hole: an untranslated or unwired `{{who}}` must be seen on screen,
    // because a blank is a page that looks fine and says nothing.
    expect(interpolate("Hello {{who}}", {})).toBe("Hello {{who}}");
    expect(interpolate("{{count}} left, {{who}} waiting", { count: 2 })).toBe(
      "2 left, {{who}} waiting",
    );
  });

  it("returns the template untouched when there are no values", () => {
    expect(interpolate("chapter {{n}}")).toBe("chapter {{n}}");
    expect(interpolate("no placeholders here")).toBe("no placeholders here");
  });
});

describe("translate", () => {
  const KEY: MessageKey = "chats.row.chapter";

  it("returns each language's own sentence", () => {
    expect(translate("en", KEY)).toBe("chapter {{n}}");
    expect(translate("it", KEY)).toBe("capitolo {{n}}");
    expect(translate("es", KEY)).toBe("capítulo {{n}}");
    expect(translate("fr", KEY)).toBe("chapitre {{n}}");
    expect(translate("de", KEY)).toBe("Kapitel {{n}}");
  });

  it("is not English wearing five hats", () => {
    // The two-step lookup in `translate` means a language whose key is missing
    // silently becomes English. Proving the values differ is what proves the
    // fallback is not what is happening in normal operation.
    for (const language of TRANSLATIONS) {
      expect(translate(language, KEY)).not.toBe(english(KEY));
    }
  });

  it("fills the placeholders of the language it is showing", () => {
    expect(translate("it", KEY, { n: 7 })).toBe("capitolo 7");
    expect(translate("de", KEY, { n: 7 })).toBe("Kapitel 7");
    expect(translate("en", "error.arc.hasChapters", { count: 42 })).toContain("42");
  });

  it("answers every key with the catalog, for every language", () => {
    // Whole-catalog walk. If any single key ever silently fell through to
    // English, it shows up here as a value the catalog does not contain.
    const disagreements: { language: UiLocale; key: MessageKey }[] = [];

    for (const language of UI_LOCALES) {
      const catalog = catalogFor(language);

      for (const key of EN_KEYS) {
        if (translate(language, key) !== catalog[key]) disagreements.push({ language, key });
      }
    }

    expect(disagreements).toEqual([]);
  });

  it("falls back to English, which is why English has no holes", () => {
    // A missing key in a translated catalog resolves to the English string;
    // the reference catalog is therefore the one that must be total.
    expect(DEFAULT_UI_LOCALE).toBe("en");

    for (const key of EN_KEYS) {
      expect(translate(DEFAULT_UI_LOCALE, key)).toBe(english(key));
    }
  });
});

describe("LOCALE_NAMES", () => {
  it("names every language in its own language", () => {
    for (const language of UI_LOCALES) {
      const name = LOCALE_NAMES[language];

      expect({ language, name }).toEqual({ language, name: expect.any(String) });
      expect(name.trim()).not.toBe("");
    }

    expect(LOCALE_NAMES.en).toBe("English");
    expect(LOCALE_NAMES.it).toBe("Italiano");
    expect(LOCALE_NAMES.es).toBe("Español");
    expect(LOCALE_NAMES.fr).toBe("Français");
    expect(LOCALE_NAMES.de).toBe("Deutsch");
  });

  it("keeps the five names apart", () => {
    // A picker showing "Deutsch" and "Deutsch" for two rows is a picker that
    // cannot be used, so the names are compared as a set, not by eye.
    const names = UI_LOCALES.map((language) => LOCALE_NAMES[language]);

    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * The API error codes, checked against the catalogs.
 *
 * The types already guarantee that every key English has exists in the other
 * four languages. Nothing guarantees the opposite direction: that a code the
 * *server* can send has a key at all. A new code with no `error.<code>` entry
 * compiles, passes every other check in this file, and reaches a reader as the
 * English fallback — which is exactly the failure the code contract was built
 * to remove.
 */
describe("error codes", () => {
  const codes = Object.keys(ERROR_CATALOG) as ErrorCode[];

  it("every code has a key in every language", () => {
    const missing: string[] = [];

    for (const code of codes) {
      const key = `error.${code}` as MessageKey;
      for (const language of UI_LOCALES) {
        const value = catalogFor(language)[key];
        if (value === undefined || value.trim() === "") missing.push(`${language}: ${key}`);
      }
    }

    expect(missing).toEqual([]);
  });

  it("no error key exists without a code behind it", () => {
    // The other direction, so a renamed code does not leave a stale sentence
    // behind that nothing can ever reach.
    const known = new Set(codes.map((code) => `error.${code}`));
    const orphans = EN_KEYS.filter((key) => key.startsWith("error.") && !known.has(key));

    expect(orphans).toEqual([]);
  });

  it("a code renders with its values in every language", () => {
    const key = "error.arc.hasChapters" as MessageKey;

    expect(translate("en", key, { count: 3 })).toContain("3");
    expect(translate("it", key, { count: 3 })).toContain("3");
    expect(translate("es", key, { count: 3 })).toContain("3");
    expect(translate("fr", key, { count: 3 })).toContain("3");
    expect(translate("de", key, { count: 3 })).toContain("3");
  });

  it("a code that takes no values renders as a finished sentence", () => {
    // Only the codes whose shared template has no placeholder. The others are
    // *supposed* to leave `{{detail}}` visible when called without values: a
    // visible placeholder is the bug report, a blank one is not.
    const parameterless = codes.filter((code) => !ERROR_CATALOG[code].includes("{{"));
    expect(parameterless.length).toBeGreaterThan(0);

    for (const language of UI_LOCALES) {
      for (const code of parameterless) {
        const rendered = translate(language, `error.${code}` as MessageKey);
        expect(rendered).not.toContain("{{");
        expect(rendered.trim()).not.toBe("");
      }
    }
  });

  it("a missing value stays visible instead of blanking the sentence", () => {
    // The behaviour the interpolation rule exists for, checked on a real code:
    // a caller that forgets to pass `count` must see `{{count}}` on the screen,
    // not "The arc contains  chapters".
    expect(translate("en", "error.arc.hasChapters")).toContain("{{count}}");
  });
});
