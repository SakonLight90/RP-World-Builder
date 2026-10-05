/**
 * How much of the conversation still stands.
 *
 * opencode does not delete messages: `session.revert` reports success
 * and leaves everything as it was, flagging it for its own use only. So if "Clear"
 * relied on that, the message would vanish from the screen and reappear
 * on the first refresh, which is the ugliest way of doing nothing.
 *
 * Here we keep count of how many messages the player chose to keep.
 * `-1` means "all", that is nothing was deleted yet: a negative
 * default keeps "no deletion" apart from "zero
 * messages left", which are two different things.
 */
export const KEPT_MESSAGES_SCHEMA = `
ALTER TABLE worlds ADD COLUMN kept_messages INTEGER NOT NULL DEFAULT -1;
`;
