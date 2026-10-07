/*
 * The turn coordinator: what happens to a turn when it does not finish.
 *
 * Nothing here is HTTP. The timeout, the race between work and time and the
 * completed/failed decision are domain logic, testable with a fake work and a fake
 * repository and without opening a port.
 */

import { apiProblem, errorFallback } from "@rpwb/shared";
import type { TurnRepository } from "../db/repo/turns.js";
import { cleanNarration } from "../opencode/markers.js";
import { TURN_TIMEOUT_MS, type TurnResult } from "../turns/pipeline.js";

/**
 * A turn's work timeout: the outer cap on the background path.
 *
 * Last point where the row can still be closed. The pipeline's limits cover stream
 * reading only, so work that stalls earlier would leave the row `running` forever.
 *
 * Above `TURN_TIMEOUT_MS`, or it would cut a turn the pipeline was still closing
 * properly, and below `RUNNING_STALE_MS`, or the turn would age into `stale` instead
 * of becoming `failed` by decision with a written reason.
 */
const TURN_DEADLINE_MS = TURN_TIMEOUT_MS + 30_000;

export interface TurnWork {
  /** The real turn. It may never return: that is the case this function covers. */
  play: () => Promise<TurnResult>;
  /** Session to close if time runs out, so opencode is not left working. */
  abort: () => Promise<void>;
}

/**
 * A background turn, with a timeout that cannot be dodged.
 *
 * `play()` may never return, so it is **raced** against the deadline rather than
 * awaited: when the deadline wins the row is closed anyway and `session.abort`
 * interrupts the lagging work.
 *
 * The orphaned `play()` keeps running, since a promise cannot be cancelled, but writes
 * nothing: only this function writes the outcome and a closed row never reopens.
 */
export async function runTurnWithDeadline(
  turnId: string,
  turns: TurnRepository,
  work: TurnWork,
  close: (turnId: string, event: string, data: unknown) => void,
  deadlineMs: number = TURN_DEADLINE_MS,
): Promise<void> {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
  }, deadlineMs);

  const outcome = await Promise.race([
    // The rejection branch keeps the reason and avoids an `unhandledRejection`
    // when the promise loses the race.
    work.play().then(
      (result) => ({ kind: "done" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    new Promise<{ kind: "timeout" }>((resolve) => {
      // An interval, not a second racing `setTimeout`: two competing timers
      // cancel each other out and there is only one row to close.
      const ticker = setInterval(() => {
        if (!expired) return;
        clearInterval(ticker);
        resolve({ kind: "timeout" });
      }, 25);
    }),
  ]);

  clearTimeout(timer);

  /*
   * What the turn consumed, worked out once and passed to every exit.
   *
   * The two failures below happen after the model has run, so a total over completed
   * turns only would report them as free.
   *
   * The price comes from the model's catalogue entry: providers price input and output
   * differently and some bill the cache separately, so multiplying the wrong pair by
   * hand is worse than no number. No known price gives `null`, and the summary counts
   * the turns it could not price.
   */
  const usage = outcome.kind === "done" ? outcome.result.usage : null;
  const cost = outcome.kind === "done" ? (outcome.result.cost ?? null) : null;

  if (outcome.kind === "timeout") {
    await work.abort();
    /*
     * The row and the stream are written here, from the same sentence, so the chat
     * and the row cannot disagree on reload.
     */
    const params = { seconds: Math.round(deadlineMs / 1000) };
    const why = errorFallback("turn.timeout", params);
    turns.fail(turnId, why, usage, cost);
    close(turnId, "error", apiProblem("turn.timeout", params));
    return;
  }

  if (outcome.kind === "error") {
    // The provider's message is the only thing that says what to fix.
    const params = {
      reason: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    };
    const why = errorFallback("turn.aborted", params);
    turns.fail(turnId, why, usage, cost);
    close(turnId, "error", apiProblem("turn.aborted", params));
    return;
  }

  const cleanedText = cleanNarration(outcome.result.text);

  // A turn that produced nothing is a failed one: the provider can close the
  // stream with an error the pipeline never sees, and a `completed` row with
  // empty text is indistinguishable from a narrator choosing silence.
  if (cleanedText.trim() === "") {
    const why = errorFallback("turn.emptyOutput");
    turns.fail(turnId, why, usage, cost);
    close(turnId, "error", apiProblem("turn.emptyOutput"));
    return;
  }

  turns.complete(turnId, cleanedText, usage, cost);
  close(turnId, "done", {
    text: cleanedText,
    usage: outcome.result.usage,
    debug: outcome.result.debug,
  });
}
