import type { MessageKey } from "./en";
import { chatsDe } from "./fragments/chats";
import { commonDe } from "./fragments/common";
import { createDe } from "./fragments/create";
import { errorsDe } from "./fragments/errors";
import { exploreDe } from "./fragments/explore";
import { homeDe } from "./fragments/home";
import { navDe } from "./fragments/nav";
import { playDe } from "./fragments/play";
import { setupDe } from "./fragments/setup";
import { worldDe } from "./fragments/world";

export const de: Record<MessageKey, string> = {
  ...commonDe,
  ...navDe,
  ...homeDe,
  ...chatsDe,
  ...errorsDe,
  ...exploreDe,
  ...createDe,
  ...setupDe,
  ...worldDe,
  ...playDe,
};
