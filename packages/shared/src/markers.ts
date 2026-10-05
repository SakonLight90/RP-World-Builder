/**
 * The marks that tell a player's beat apart from everything else.
 *
 * In an opencode session everything that is not the player's also lands: the
 * canon and state the engine injects on every turn, and the automatic
 * "Continue" and "Retry" requests. If the history mixed them, reopening the
 * chat would show `## CANON` blocks as if they were your messages, and the
 * "Continue" ones would come back as if you had written them.
 *
 * They live in `shared` because there are two writers: the server builds the
 * context block and decides what counts as silent, the interface sends the
 * Continue and Retry requests. A constant duplicated on both sides eventually
 * diverges, and the symptom is not a wrong word — it is the marker no longer
 * matching, so "Continue" reappears in the transcript as a line the player
 * apparently wrote. That reads as a memory bug and is not one.
 */

/** Heading of the context block injected on every turn. */
export const CANONE_HEADING = "## CANON";

/** The requests that are not from the player. */
export const SILENT_PREFIX = "[narrator request]";

/**
 * Asks the narrator to carry on without the player acting.
 *
 * It has to be said once and well: carrying on does not mean deciding in their
 * place, and it does not mean closing the scene. It is what game tables do when
 * the narrator needs to catch their breath.
 */
export const CONTINUE_REQUEST =
  "Continue the scene from where it was interrupted. The player's character does not act and does not speak: no sentence of theirs, no decision of theirs. Do not close the scene and do not ask what to do. Add only what happens around them and leave them an open decision.";

/** Asks to rewrite the last scene, keeping the canon. */
export const RETRY_REQUEST =
  "Redo the scene just narrated, changing how it went. The same circumstances, the same canon, a different outcome. Do not repeat the previous version and do not change the facts of the world.";

/** This message is from the engine, not from the player. */
export function isSilent(text: string): boolean {
  return text.startsWith(SILENT_PREFIX);
}

/** This message is the context the engine injects. */
export function isContext(text: string): boolean {
  return text.startsWith(CANONE_HEADING);
}

/** The text to send to the model, with the mark if needed. */
export function mark(text: string, silent: boolean): string {
  return silent ? `${SILENT_PREFIX} ${text}` : text;
}
