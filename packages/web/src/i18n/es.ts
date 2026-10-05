import type { MessageKey } from "./en";
import { chatsEs } from "./fragments/chats";
import { commonEs } from "./fragments/common";
import { createEs } from "./fragments/create";
import { errorsEs } from "./fragments/errors";
import { exploreEs } from "./fragments/explore";
import { homeEs } from "./fragments/home";
import { navEs } from "./fragments/nav";
import { playEs } from "./fragments/play";
import { setupEs } from "./fragments/setup";
import { worldEs } from "./fragments/world";

export const es: Record<MessageKey, string> = {
  ...commonEs,
  ...navEs,
  ...homeEs,
  ...chatsEs,
  ...errorsEs,
  ...exploreEs,
  ...createEs,
  ...setupEs,
  ...worldEs,
  ...playEs,
};
