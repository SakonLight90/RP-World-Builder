import type { Narrator } from "./narrator.js";
import { extractJson } from "./structured.js";

export interface JsonRequest {
  /** Session title, so it can be found again in a list of sessions. */
  sessionTitle: string;
  /** Model to use, already in the `provider/model` form. */
  modelRef: string;
  /** The text of the request. */
  text: string;
}

/**
 * Asks the narrator for JSON and returns the object, or `null`.
 *
 * It exists because the "open a session, ask, read the JSON, close" skeleton
 * was written by hand in four places under `canon/`, and in two of them it was
 * identical line for line. Four copies means that a quarter of any fix — for
 * example closing the session even when parsing fails — gets applied to one
 * copy only, while the others keep losing it.
 *
 * `null` means "I got nothing usable": session not created, prompt failed,
 * answer without JSON, JSON that is not an object. It is deliberately a single
 * value instead of one error per case, because **all four callers have the same
 * fallback** and none distinguishes the causes. Shape validation is left to the
 * caller: here there is no way to know what the object should contain, and
 * guessing would produce a parameter no schema asks for.
 */
export async function askJson(
  narrator: Narrator,
  request: JsonRequest,
): Promise<Record<string, unknown> | null> {
  let sessionId: string | null = null;
  try {
    const created = await narrator.createSession(request.sessionTitle);
    sessionId = created;

    const risposta = await narrator.prompt(created, {
      modelRef: request.modelRef,
      text: request.text,
    });

    const parsed = extractJson(risposta);
    if (!parsed.ok) return null;

    const value = parsed.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    // The caller already has its fallback: here the failure is let through as
    // "no JSON", without adding an error channel none of the four callers would
    // read.
    return null;
  } finally {
    // The close sits in the `finally` and not in the happy path because a
    // session left open after a format error stays in `config.json` and is found
    // in memory on the next start. The `?.catch` is there so that a failing
    // close does not replace the result already obtained.
    if (sessionId !== null) {
      await narrator.closeSession(sessionId).catch(() => undefined);
    }
  }
}
