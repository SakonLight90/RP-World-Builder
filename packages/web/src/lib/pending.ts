/**
 * What hasn't entered the story yet.
 *
 * A failing prompt never lands in the opencode session, so it can't be
 * reviewed by re-reading history: without this list, a page refresh
 * would erase what you'd written, and your work would be gone. The
 * turn failed, but your text is yours and must be kept.
 *
 * It lives in the browser, nothing else. Not a convenience choice: it's a project
 * without accounts and without a sync server, so the honest place for
 * stuff that's still yours and not yet canon is your computer, until you decide
 * to throw it away with "Delete".
 */

const PREFIX = "rpwb:pending:";

/** Cap on how many interrupted prompts are remembered per world. */
const KEEP = 20;

export interface PendingTurn {
  /** Identifies it, and removes it from the list. */
  id: string;
  /** What you wrote. */
  prompt: string;
  /** What the narrator had started writing, if that happened. */
  partial: string;
  /** Why it failed. */
  problem: string;
  /** Attempt time, to tell what happened when. */
  at: number;
}

function read(worldId: string): PendingTurn[] {
  try {
    const raw = localStorage.getItem(PREFIX + worldId);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Don't trust what's inside: it can be from an older
    // version, or a half-written file.
    return parsed.filter(
      (item): item is PendingTurn =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as PendingTurn).prompt === "string" &&
        typeof (item as PendingTurn).id === "string",
    );
  } catch {
    return [];
  }
}

function write(worldId: string, items: PendingTurn[]): void {
  try {
    if (items.length === 0) {
      localStorage.removeItem(PREFIX + worldId);
      return;
    }
    localStorage.setItem(PREFIX + worldId, JSON.stringify(items.slice(-KEEP)));
  } catch {
    // Private browsing or no space left: chat still works, only the
    // interrupted prompt won't survive refresh. Better than writing
    // nothing and pretending it's a decision.
  }
}

export function pendingTurns(worldId: string): PendingTurn[] {
  return read(worldId);
}

/** Remembers an interrupted turn, or updates the one with the same id. */
export function rememberPending(worldId: string, turn: PendingTurn): void {
  const items = read(worldId).filter((item) => item.id !== turn.id);
  write(worldId, [...items, turn]);
}

export function forgetPending(worldId: string, id: string): void {
  write(
    worldId,
    read(worldId).filter((item) => item.id !== id),
  );
}

/**
 * Forgets every interrupted attempt with that text.
 *
 * No id needed: when a retry succeeds, the id no longer matches the
 * saved one — every attempt has its own. Delete by text, which is what
 * truly tells "it went through" from "still pending".
 */
export function forgetPendingByPrompt(worldId: string, prompt: string): void {
  write(
    worldId,
    read(worldId).filter((item) => item.prompt !== prompt),
  );
}

export function forgetAllPending(worldId: string): void {
  write(worldId, []);
}

/** An id that won't collide with rows already on screen. */
export function pendingId(worldId: string, prompt: string, at: number): string {
  return `${worldId}:${at}:${prompt.length}`;
}
