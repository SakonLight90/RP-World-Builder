/**
 * Turns and everything around them: starting, following, listing, deleting,
 * history, context, verification, and conversation reset.
 *
 * The progress registry lives here because it only serves streams: it is
 * preview memory, not truth, and when the turn ends truth lives in the
 * database. Keeping it in the turns module stops anything else from starting
 * to depend on it.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import { apiProblem, type World } from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { type ArcMemory, carryoverCost } from "../canon/arc-memory.js";
import { verifyCanon } from "../canon/verify.js";
import { CastRepository } from "../db/repo/cast.js";
import { contextLimitFor } from "../opencode/context.js";
import { cleanNarration } from "../opencode/markers.js";
import type { Narrator } from "../opencode/narrator.js";
import { narratorFor } from "../opencode/narrator-adapter.js";
import { dropLastMessage } from "../opencode/session.js";
import { type TurnInput, TurnPipeline } from "../turns/pipeline.js";
import { corsHeaders, wantsPrivateNetwork } from "./cors.js";
import { TurnBody, VerifyBody } from "./schema.js";
import {
  advanceKept,
  clientForWorld,
  conversation,
  narratorForWorld,
  pipelineFor,
  type RouteScope,
  visibleCount,
} from "./scope.js";
import { runTurnWithDeadline, type TurnWork } from "./turn-coordinator.js";

export function registerTurnRoutes(app: FastifyInstance, scope: RouteScope): void {
  /**
   * A turn's progress, held in memory and only for the turn's duration.
   *
   * Before, the streaming text was the same response that started the turn: one
   * connection did two jobs, and closing the tab cut it mid-sentence.
   * Now the command is a JSON response arriving at once, the narrator writes
   * with nobody watching, and this registry is what remains: **a preview**
   * for those still connected, plus the chunks already arrived for anyone joining a started
   * turn.
   *
   * It is not the truth: truth is the row in `turns`, and when the turn ends
   * the UI re-reads that. If this buffer is lost a preview is lost,
   * nothing more, which is why there is nothing here to depend on.
   */
  interface TurnProgress {
    /** Chunks already arrived, for anyone joining a started turn. */
    chunks: string[];
    /** Who is connected now. A `null` means "the turn is over, close". */
    listeners: Set<(chunk: string | null) => void>;
    /** The outcome every stream ends with. */
    fine: { event: string; data: unknown } | null;
  }

  const progress = new Map<string, TurnProgress>();

  function progressFor(turnId: string): TurnProgress {
    let entry = progress.get(turnId);
    if (entry === undefined) {
      entry = { chunks: [], listeners: new Set(), fine: null };
      progress.set(turnId, entry);
    }
    return entry;
  }

  /** A narration chunk, to whoever is connected and waiting for a later chunk. */
  function publish(turnId: string, chunk: string): void {
    const entry = progressFor(turnId);
    entry.chunks.push(chunk);
    for (const listener of entry.listeners) listener(chunk);
  }

  /** Closes the stream for everyone connected, with the turn's outcome. */
  function closeTurn(turnId: string, event: string, data: unknown): void {
    const entry = progressFor(turnId);
    entry.fine = { event, data };
    for (const listener of entry.listeners) listener(null);
    releaseProgress(turnId);
  }

  /**
   * Drops a finished turn's preview.
   *
   * It must be done: every turn passing through here leaves a piece of text in memory, and
   * without this it grows forever. It is kept only while someone watches, because
   * past that point nobody reads the preview and the answer is already in the
   * database.
   */
  function releaseProgress(turnId: string): void {
    const entry = progress.get(turnId);
    if (entry === undefined) return;
    if (entry.fine !== null && entry.listeners.size === 0) progress.delete(turnId);
  }

  /**
   * The real turn, awaited by no HTTP request.
   *
   * It lives here, and not inside the route starting it, for a single reason: when the
   * tab closes the narrator must not die too. The turn's row is already
   * created, so from this moment everything happening has a place to
   * go: the answer on success, the error on failure, and in both cases closing
   * the row. There is no longer any response to write to, and none is needed: what
   * the player must see is already saved.
   */
  async function runTurn(
    scope: RouteScope,
    turnId: string,
    world: World,
    narrator: Narrator,
    pipeline: TurnPipeline,
    input: TurnInput,
  ): Promise<void> {
    // The registry is created here and not when someone connects: if nobody watches,
    // the turn still runs, and when someone opens the stream halfway they want to see
    // what was already written and not a three-seconds-ago spinner.
    progressFor(turnId);

    const work: TurnWork = {
      play: async () => {
        // How many visible messages exist **before** the turn, to move the
        // deletion bookmark forward without losing deletions.
        const before = await visibleCount(scope, world);
        const result = await pipeline.play(input, (delta) => {
          // The preview goes through clean markers, chunk by chunk as before. The
          // text staying in the database is cleaned on the whole text, which is what
          // the UI shows at the end.
          const chunk = cleanNarration(delta);
          if (chunk !== "") publish(turnId, chunk);
        });
        await advanceKept(scope, world, before);
        return result;
      },
      abort: async () => {
        // The session is re-read from the world: if the work expired the result
        // is missing, and the session to close is the last one the world saved.
        const sessionId = scope.worlds.get(world.id)?.opencodeSessionId ?? null;
        if (sessionId === null || sessionId === "") return;
        await narrator.abort(sessionId).catch(() => undefined);
      },
    };

    await runTurnWithDeadline(turnId, scope.turns, work, closeTurn);
  }

  app.get("/api/worlds/:id/transcript", async (request, reply) => {
    const { id } = request.params as { id: string };
    // Both conditions must stay distinct: "this world does not exist" and "opencode is
    // not on" are not the same error, and answering 404 to the second
    // convinced users the campaign was gone while it was intact and
    // restarting opencode was enough.
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));

    // The world's prologue is message 1, and history puts it ahead of
    // everything. What follows are the real messages: no injected canon and
    // no automatic requests, which would otherwise read as lines
    // written by the player.
    const kept = scope.worlds.keptMessages(id);
    const messages = await conversation(scope, world, world.opencodeSessionId ?? "");
    const shown = kept < 0 ? messages : messages.slice(0, kept);

    return {
      messages: shown,
      /** How many messages really exist, to tell "all" from "cut". */
      total: messages.length,
    };
  });

  app.get("/api/worlds/:id/context", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));
    try {
      const pipeline = await pipelineFor(scope, id);
      const inspected = await pipeline.inspect(id);
      const world = scope.worlds.get(id);
      if (!world) return reply.code(404).send(apiProblem("world.notFound"));

      const list = scope.arcs.list(id);
      const memory: ArcMemory[] = list.map((arc) => ({
        arc,
        chapters: scope.arcs
          .chaptersIn(arc.id)
          .map((c) => ({ n: c.n, title: c.title, summary: c.summary })),
      }));

      return {
        ...inspected,
        model: world.model,
        reasoningEffort: world.reasoningEffort,
        chapterThresholdRatio: world.chapterThresholdRatio,
        carryover: carryoverCost(memory),
        contextLimit: await contextLimitFor(
          await narratorForWorld(scope, id),
          world.model,
          world.contextLimit,
        ),
      };
    } catch (error) {
      return reply.code(500).send(
        apiProblem("server.unexpected", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  app.post("/api/worlds/:id/turn", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = TurnBody.safeParse(request.body);
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));

    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));

    // The world's server starts **before** answering, and its possible
    // failure is still an HTTP error.
    //
    // Two things can go wrong before the turn exists, and
    // they stay distinct: a malformed request and a world that is missing are caller
    // errors, answered as before. The opencode server not
    // starting is a machine matter, and until it starts it cannot even be said
    // that the turn began: answering "started" here would lie, because
    // the narrator will never be there.
    let client: OpencodeClient;
    try {
      client = await clientForWorld(scope, id);
    } catch (error) {
      return reply.code(503).send(
        apiProblem("narrator.unavailable", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    const narrator = narratorFor(client);

    // The row is born before narration starts: from here on the UI
    // knows the narrator is working even when it sees nothing more.
    const turn = scope.turns.start(id, body.data.text, body.data.locale);

    // And the work starts **without being awaited**. It is not a hidden `await`: if it
    // were, the answer would arrive after the text and we would have rebuilt exactly
    // the earlier problem, with the very same flaw.
    void runTurn(
      scope,
      turn.id,
      world,
      narrator,
      new TurnPipeline(scope.db, narrator, scope.roots.lore),
      {
        worldId: id,
        text: body.data.text,
        locale: body.data.locale,
        locationId: body.data.locationId,
        silent: body.data.silent,
      },
    ).catch(() => {
      // Nothing should arrive here: `runTurn` closes the row even when the
      // narrator fails, and even when the work never returns. If anything
      // still arrived, the row would stay `running`: better a row that will age
      // into `stale` than a rejected promise killing the process.
    });

    // 202 and not 200: acknowledged and running, not done. The answer carries the turn's
    // id and nothing else, because the text does not come back from here.
    return reply.code(202).send({ turnId: turn.id });
  });

  /**
   * The world's turns, from the database.
   *
   * The UI draws from here: the text there is what the backend
   * wrote, so reopening the tab, switching tabs or restarting the server
   * changes nothing on display.
   *
   * `active` lives in the same response and not in a separate route for a single
   * reason: the UI must know whether the narrator is writing on every read, and with two
   * requests both facts can come from two different moments, that is saying "it is
   * writing" and "no, it finished" on the same screen. With a field next to
   * the list the answer is a single snapshot.
   */
  app.get("/api/worlds/:id/turns", async (request) => {
    const { id } = request.params as { id: string };
    const requested = Number.parseInt((request.query as { limit?: string }).limit ?? "", 10);
    const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, requested)) : 30;
    return { turns: scope.turns.list(id, limit), active: scope.turns.active(id)?.id ?? null };
  });

  app.delete("/api/worlds/:id/turns/:turnId", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const turn = scope.turns.get(id, turnId);
    if (!turn) return reply.code(404).send(apiProblem("turn.notFound"));

    /*
     * A running turn must be stopped before removing its row: without abort the
     * narrator would keep writing and the coordinator would close a row
     * that is gone. Abort must not block deletion though: if
     * opencode does not answer, the row still goes away and the orphaned work ages
     * into `stale` with nobody watching it anymore.
     */
    if (turn.state === "running" && scope.bridge) {
      try {
        const sessionId = scope.worlds.get(id)?.opencodeSessionId ?? null;
        if (sessionId !== null && sessionId !== "") {
          await (await narratorForWorld(scope, id)).abort(sessionId).catch(() => undefined);
        }
      } catch {
        // It is deleted anyway: see above.
      }
    }

    return { ok: scope.turns.remove(id, turnId) };
  });

  /**
   * A turn's progress, for those still connected.
   *
   * A separate route and not inside the one starting the turn, because a route cannot
   * do two things: start work lasting minutes and keep the answer open for
   * all that time. Only the flowing text is kept here, closing when the
   * turn is closed **in the database**: the row is the truth, so an event that never
   * arrives cannot leave the connection hanging forever.
   *
   * Anyone joining an already-started turn first receives what was already
   * written, then what follows.
   */
  app.get("/api/worlds/:id/turns/:turnId/stream", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));
    const turn = scope.turns.get(id, turnId);
    if (!turn) return reply.code(404).send(apiProblem("turn.notFound"));

    // From here the response is ours: Fastify must send nothing more.
    reply.hijack();

    // CORS headers must be written **here**, with the rest, because from this
    // moment `writeHead` sends headers and Fastify no longer does. If they
    // were left to Fastify alone, preflight would pass and this answer
    // would arrive without `Access-Control-Allow-Origin`: the browser blocks it, and the
    // message shown ("origin match policy") does not reveal
    // that a header was written in the wrong place.
    const cors = corsHeaders(request.headers.origin, wantsPrivateNetwork(request.headers)) ?? {};

    reply.raw.writeHead(200, {
      ...cors,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    // If the browser closes the tab while the narrator writes, writing
    // fails. That is no campaign error: without this guard, the
    // failure would land in the `catch` trying to send an event on a dead
    // stream, and that would break the connection too.
    let open = true;
    const send = (event: string, data: unknown): void => {
      if (!open) return;
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        open = false;
      }
    };

    const entry = progressFor(turnId);
    let closed = false;
    let watchdog: ReturnType<typeof setInterval> | undefined;

    const close = (event: string, data: unknown): void => {
      if (closed) return;
      closed = true;
      if (watchdog !== undefined) clearInterval(watchdog);
      send(event, data);
      open = false;
      try {
        reply.raw.end();
      } catch {
        // The connection was already gone: the turn finished anyway.
      }
      releaseProgress(turnId);
    };

    // A text chunk moves forward, the outcome closes. The `done` and `error`
    // coming from the backend are the outcome's preview: the UI does nothing
    // with them, because it re-reads the true outcome from the row.
    const listen = (chunk: string | null): void => {
      if (chunk === null) {
        const fine = entry.fine;
        close(fine?.event ?? "end", fine?.data ?? { turnId });
        return;
      }
      send("text", { delta: chunk });
    };

    entry.listeners.add(listen);
    for (const chunk of entry.chunks) listen(chunk);

    request.raw.on("close", () => {
      closed = true;
      if (watchdog !== undefined) clearInterval(watchdog);
      entry.listeners.delete(listen);
      releaseProgress(turnId);
    });

    // The turn was already over when the stream was opened: nobody is waited
    // for, the outcome is said right away and the stream is closed. The outcome
    // comes from the row, which is the only source, and not from an event that
    // by now would never arrive.
    if (turn.state !== "running") {
      // A stored error is the reason the turn really failed; a row closed
      // without one says only that the narrator never finished it. The two stay
      // distinct, because a player who sees "did not finish" for a turn that
      // timed out is sent looking in the wrong place.
      const failure =
        turn.error === null
          ? apiProblem("turn.notFinished")
          : apiProblem("turn.failed", { reason: turn.error });
      entry.fine = {
        event: turn.state === "completed" ? "done" : "error",
        data: turn.state === "completed" ? { text: turn.text ?? "" } : failure,
      };
      listen(null);
      return reply;
    }

    // Safety net, not a mechanism: the backend closes the stream on its own. If
    // for any reason the notice never arrives, the database check closes the
    // stream anyway, because the row is what says the turn is over.
    watchdog = setInterval(() => {
      const fresh = scope.turns.get(id, turnId);
      if (fresh === null || fresh.state !== "running") close("end", { turnId });
    }, 1_000);

    return reply;
  });

  app.post("/api/worlds/:id/verify", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = VerifyBody.safeParse(request.body ?? {});
    if (!body.success)
      return reply
        .code(400)
        .send(apiProblem("body.invalid", { detail: body.error.issues[0]?.message ?? "" }));
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    const result = await verifyCanon({
      narrator: await narratorForWorld(scope, id),
      world,
      chapters: scope.chapters.list(id),
      locale: body.data.locale,
    });
    return { entries: result };
  });

  /**
   * Deletes **one single** message, the last one. One only, never two.
   *
   * This is not a cosmetic deletion: the count of how many messages are left
   * is saved in the database, so reopening the chat shows exactly what you
   * left behind. Leaning on `session.revert` looked like the right way and it
   * is not: it answers that it went fine and deletes nothing, so the message
   * vanished and came back on the first refresh.
   */
  app.post("/api/worlds/:id/message/drop", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));

    const sessionId = world.opencodeSessionId ?? "";
    if (sessionId === "") {
      return reply.code(409).send(apiProblem("conversation.notStarted"));
    }

    try {
      const messages = await conversation(scope, world, sessionId);
      const before = scope.worlds.keptMessages(id);
      const current = before < 0 ? messages.length : Math.min(before, messages.length);

      // Below the prologue there is no world and no campaign left.
      if (current <= 1) {
        return reply.code(400).send(apiProblem("conversation.prologueProtected"));
      }

      const outcome = await dropLastMessage(
        await clientForWorld(scope, id),
        sessionId,
        messages.length,
        before,
      );
      scope.worlds.setKeptMessages(id, outcome.kept);

      return { kept: outcome.kept, removed: 1 };
    } catch (error) {
      return reply.code(400).send(
        apiProblem("server.unexpected", {
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  /**
   * Restarts the conversation.
   *
   * It does not delete the messages one by one: it opens a new session and leaves the
   * old one behind. It exists because "Delete" cannot go below the first
   * message — without that one the campaign has nowhere to start from — and that first
   * message may be something that is not yours, or that is simply from two
   * weeks ago and is of no use anymore.
   *
   * Deleting **the characters too**, which is the requested choice: they are
   * the cast of the previous session, not of the campaign. Canon, eras,
   * Bible, arcs and chapters stay: the campaign continues, the conversation changes.
   */
  app.post("/api/worlds/:id/conversation/reset", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));

    const previous = world.opencodeSessionId ?? "";
    scope.worlds.update(id, { opencodeSessionId: null });
    scope.worlds.setKeptMessages(id, -1);

    // The cast goes away too: the characters belong to **this** campaign.
    // Without this, a name or a place promoted by mistake in the previous
    // session stays in the new campaign's character list, invisible from the
    // chat and impossible to remove from there.
    const removedCharacters = new CastRepository(scope.db).deleteAllCharacters(id);

    if (previous !== "") {
      // The old session is closed, not deleted: if for any reason it were
      // still needed, having it is better than not being able to get it back.
      await (await narratorForWorld(scope, id)).closeSession(previous).catch(() => undefined);
    }

    return { ok: true, removedCharacters: removedCharacters };
  });
}
