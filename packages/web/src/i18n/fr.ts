import type { MessageKey } from "./en";
import { chatsFr } from "./fragments/chats";
import { commonFr } from "./fragments/common";
import { createFr } from "./fragments/create";
import { errorsFr } from "./fragments/errors";
import { exploreFr } from "./fragments/explore";
import { homeFr } from "./fragments/home";
import { navFr } from "./fragments/nav";
import { playFr } from "./fragments/play";
import { setupFr } from "./fragments/setup";
import { worldFr } from "./fragments/world";

export const fr: Record<MessageKey, string> = {
  ...commonFr,
  ...navFr,
  ...homeFr,
  ...chatsFr,
  ...errorsFr,
  ...exploreFr,
  ...createFr,
  ...setupFr,
  ...worldFr,
  ...playFr,
};
