import { chatsEn } from "./fragments/chats";
import { commonEn } from "./fragments/common";
import { createEn } from "./fragments/create";
import { errorsEn } from "./fragments/errors";
import { exploreEn } from "./fragments/explore";
import { homeEn } from "./fragments/home";
import { navEn } from "./fragments/nav";
import { playEn } from "./fragments/play";
import { setupEn } from "./fragments/setup";
import { worldEn } from "./fragments/world";

/**
 * English, and the reference catalog.
 *
 * The key set is defined here and nowhere else: the other four languages are
 * typed against it, so a key added to English and forgotten in Italian is a
 * compile error rather than an English word in a Spanish page.
 *
 * English is the fallback at runtime too, not only at compile time, because a
 * language can be half-translated for a release and a half-translated page is
 * worse than one that shows English in the gaps.
 */
export const en = {
  ...commonEn,
  ...navEn,
  ...homeEn,
  ...chatsEn,
  ...errorsEn,
  ...exploreEn,
  ...createEn,
  ...setupEn,
  ...worldEn,
  ...playEn,
};

/** Every key the interface may ask for. */
export type MessageKey = keyof typeof en;

/** The English string for a key, with no fallback logic applied. */
export function english(key: MessageKey): string {
  return en[key];
}
