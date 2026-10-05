import type { MessageKey } from "./en";
import { chatsIt } from "./fragments/chats";
import { commonIt } from "./fragments/common";
import { createIt } from "./fragments/create";
import { errorsIt } from "./fragments/errors";
import { exploreIt } from "./fragments/explore";
import { homeIt } from "./fragments/home";
import { navIt } from "./fragments/nav";
import { playIt } from "./fragments/play";
import { setupIt } from "./fragments/setup";
import { worldIt } from "./fragments/world";

/**
 * Italian.
 *
 * Typed as `Record<MessageKey, string>` on purpose: this is the annotation that
 * makes a forgotten translation a build failure. `noUncheckedIndexedAccess` and
 * a partial type would both let a missing key through to a screen that renders
 * `undefined`.
 */
export const it: Record<MessageKey, string> = {
  ...commonIt,
  ...navIt,
  ...homeIt,
  ...chatsIt,
  ...errorsIt,
  ...exploreIt,
  ...createIt,
  ...setupIt,
  ...worldIt,
  ...playIt,
};
