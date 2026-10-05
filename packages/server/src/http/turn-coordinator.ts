/**
 * The turn coordinator: what happens to a turn when it does not finish.
 *
 * It lives outside `routes.ts` because nothing here is HTTP. A route receives a
 * request, answers a code and hands the work to someone else; the timeout, the
 * race between work and time, and the "completed" vs "failed" decision are domain
 * logic. Mixing them made `routes.ts` grow for pages with nobody
 * able to test them alone anymore, because testing them required a server.
 *
 * So here an `runTurnWithDeadline` can be built with fake work and a fake
 * repository, without opening a port and without a model.
 */

import { apiProblem, errorFallback } from "@rpwb/shared";
import type { TurnRepository } from "../db/repo/turns.js";
import { cleanNarration } from "../opencode/markers.js";
import { TURN_TIMEOUT_MS, type TurnResult } from "../turns/pipeline.js";

/**
 * A turn's work timeout.
 *
 * It is the **outer** cap on the background path, and it lives here because
 * this is the last point where the row can still be closed. The pipeline already
 * has its limits, but they only cover stream reading: if the work stalls
 * earlier, or an opencode call never returns, none of those limits
 * fires and the row stays `running` forever.
 *
 * The value is higher than `TURN_TIMEOUT_MS`, the inner limit: if it were
 * lower, the timeout here would cut a turn the pipeline was still
 * closing properly. It still stays below `RUNNING_STALE_MS` (5 minutes), the
 * threshold beyond which a `running` row is shown as `stale`:
 * the turn must become `failed` **by decision and with a written reason**, not
 * by aging.
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
 * `play()` may never return: if the stream never starts, or a call never
 * answers, the promise stays pending and waiting on it never ends. Here
 * `play()` is not awaited but **raced** against the deadline, and when the
 * deadline wins the row is closed anyway, with `session.abort`
 * interrupting the lagging work.
 *
 * The orphaned `play()` keeps running: a promise cannot be cancelled. But it no
 * longer writes anything, because only this function writes the outcome and an already
 * closed row never reopens. That is the difference between a forgotten promise and a turn
 * lying about still writing.
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
    // The rejection branch serves two purposes: keeping the reason for an error,
    // and avoiding an `unhandledRejection` when the promise loses the race.
    work.play().then(
      (result) => ({ kind: "done" as const, result }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    new Promise<{ kind: "timeout" }>((resolve) => {
      // Time is checked with an interval and not with a second `setTimeout`
      // racing: two competing timers cancel each other out fragily, and here the row to close is just one.
      const ticker = setInterval(() => {
        if (!expired) return;
        clearInterval(ticker);
        resolve({ kind: "timeout" });
      }, 25);
    }),
  ]);

  clearTimeout(timer);

  if (outcome.kind === "timeout") {
    await work.abort();
    /*
     * The row and the stream are written here, so they are built from the same
     * code: `why` is the sentence `ERROR_CATALOG` gives for `turn.timeout`, and it
     * is both what the database keeps and what the event reports. Writing the
     * sentence twice, once for each, is how a turn ends up saying in the chat
     * something different from what the row says on reload.
     */
    const params = { seconds: Math.round(deadlineMs / 1000) };
    const why = errorFallback("turn.timeout", params);
    turns.fail(turnId, why);
    close(turnId, "error", apiProblem("turn.timeout", params));
    return;
  }

  if (outcome.kind === "error") {
    // A rejection is a reason, not an excuse: the message the provider wrote is
    // the only thing that says what to fix, so it travels inside `turn.aborted`.
    const params = {
      reason: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
    };
    const why = errorFallback("turn.aborted", params);
    turns.fail(turnId, why);
    close(turnId, "error", apiProblem("turn.aborted", params));
    return;
  }

  const cleanedText = cleanNarration(outcome.result.text);

  // A turn that **produced nothing** is a failed turn, not an empty
  // turn. This is said because it really happened: the provider can close the stream
  // with an error without the pipeline propagating it, and in that case there is no error
  // to propagate. The result would be a `completed` row with empty text,
  // which in the UI is indistinguishable from a narrator choosing silence.
  if (cleanedText.trim() === "") {
    const why = errorFallback("turn.emptyOutput");
    turns.fail(turnId, why);
    close(turnId, "error", apiProblem("turn.emptyOutput"));
    return;
  }

  turns.complete(turnId, cleanedText);
  close(turnId, "done", {
    text: cleanedText,
    usage: outcome.result.usage,
    debug: outcome.result.debug,
  });
}
