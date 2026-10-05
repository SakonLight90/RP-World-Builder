/**
 * What a translation is, and where the language list comes from.
 *
 * The list itself is not here. It lives in `@rpwb/shared`, because the server
 * validates `uiLocale` against the same five codes: a second copy in the
 * interface is a second thing to forget when a language is added.
 */

/**
 * A flat record, not a nested tree: nesting buys nothing here, and a flat key
 * can be grepped across the whole project and diffed between two languages
 * without walking a structure. The key itself carries the grouping
 * (`world.cast.title`), so the catalog reads like an outline.
 *
 * Values are plain strings. Anything dynamic is a `{{placeholder}}` the
 * translator fills in, which keeps word order with the translator: "1 chapter
 * left" is not "chapter left: 1" in every language.
 */
export type Messages = Record<string, string>;

/** Values substituted into a `{{placeholder}}` before the string is shown. */
export type MessageValues = Record<string, string | number>;

export type { UiLocale } from "@rpwb/shared";
// Re-exported rather than redeclared: these are the interface's language, and
// they are the same five codes the server validates against.
export { DEFAULT_UI_LOCALE, LOCALE_NAMES, UI_LOCALES } from "@rpwb/shared";
