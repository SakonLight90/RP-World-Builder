/*
 * Turns and everything around them: starting, following, listing, deleting, history,
 * context, verification, and conversation reset.
 *
 * The progress registry lives here because it only serves streams: it is preview memory,
 * not truth, and when the turn ends the truth is the `turns` row.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import { apiProblem, type World } from "@rpwb/shared";
import type { FastifyInstance } from "fastify";
import { type ArcMemory, carryoverCost } from "../canon/arc-memory.js";
import { verifyCanon } from "../canon/verify.js";
import { CastRepository } from "../db/repo/cast.js";
import { errorDetail, log } from "../logging.js";
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
  /** A preview of a running turn, in memory and only for its duration. Not the truth. */
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

  /* Drops a finished turn's preview once nobody is watching it. */
  function releaseProgress(turnId: string): void {
    const entry = progress.get(turnId);
    if (entry === undefined) return;
    if (entry.fine !== null && entry.listeners.size === 0) progress.delete(turnId);
  }

  /**
   * The turn, awaited by no HTTP request: closing the tab must not stop the narrator.
   */
  async function runTurn(
    scope: RouteScope,
    turnId: string,
    world: World,
    narrator: Narrator,
    pipeline: TurnPipeline,
    input: TurnInput,
  ): Promise<void> {
    // Created here and not on connect: someone joining halfway sees the chunks already written.
    progressFor(turnId);

    log.info("turn.started", {
      turnId,
      worldId: world.id,
      model: world.model,
      locale: input.locale,
      silent: input.silent === true,
    });

    const work: TurnWork = {
      play: async () => {
        // Visible messages before the turn, to move the deletion bookmark forward.
        const before = await visibleCount(scope, world);
        const result = await pipeline.play(input, (delta) => {
          // The preview is cleaned chunk by chunk; the stored text is cleaned whole.
          const chunk = cleanNarration(delta);
          if (chunk !== "") publish(turnId, chunk);
        });
        await advanceKept(scope, world, before);
        return result;
      },
      abort: async () => {
        // Re-read: the turn's own result is gone when it expired.
        const sessionId = scope.worlds.get(world.id)?.opencodeSessionId ?? null;
        if (sessionId === null || sessionId === "") return;
        await narrator.abort(sessionId).catch(() => undefined);
      },
    };

    await runTurnWithDeadline(turnId, scope.turns, work, closeTurn);

    // Logged whichever way the turn went: a failed turn is the expensive one.
    const finished = scope.turns.get(world.id, turnId);
    log.info("turn.finished", {
      turnId,
      worldId: world.id,
      state: finished?.state ?? "unknown",
      inputTokens: finished?.usage?.input ?? null,
      outputTokens: finished?.usage?.output ?? null,
      cost: finished?.cost ?? null,
      reported: finished?.usage !== null && finished?.usage !== undefined,
      reason: finished?.error ?? undefined,
    });
  }

  app.get("/api/worlds/:id/transcript", async (request, reply) => {
    const { id } = request.params as { id: string };
    // "no such world" and "opencode is off" are different answers: 404 on the second reads as
    // a lost campaign.
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));

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
      // The client gets the sentence, the log gets the cause.
      log.error("context.read.failed", { worldId: id, reason: errorDetail(error) });
      return reply.code(500).send(
        apiProblem("server.unexpected", {
          reason: errorDetail(error) ?? "unknown error",
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

    // The world's server starts before answering, and its failure is still an HTTP error: a
    // turn that cannot reach the narrator has not begun.
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

    // Born before narration starts, so the UI knows the narrator is working.
    const turn = scope.turns.start(id, body.data.text, body.data.locale);

    // Not awaited: the answer must not wait for the text.
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
      // `runTurn` closes the row however the turn goes; anything reaching here would leave it
      // running, and a rejected promise kills the process.
    });

    // 202: acknowledged and running, not done.
    return reply.code(202).send({ turnId: turn.id });
  });

  /**
   * The turns and the running one.
   *
   * `active` is in the same response so the two facts come from one moment: with two requests
   * the page can read "writing" and "finished" on the same screen.
   */
  app.get("/api/worlds/:id/turns", async (request) => {
    const { id } = request.params as { id: string };
    const requested = Number.parseInt((request.query as { limit?: string }).limit ?? "", 10);
    const limit = Number.isFinite(requested) ? Math.min(200, Math.max(1, requested)) : 30;
    return { turns: scope.turns.list(id, limit), active: scope.turns.active(id)?.id ?? null };
  });

  /**
   * What the campaign has cost.
   *
   * Tokens and money are separate because they are not the same figure: a turn that read its
   * cache is billed far below its token count. `costCovered` says how many turns the money
   * total covers.
   */
  app.get("/api/worlds/:id/spend", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));
    return { spend: scope.turns.spendSummary(id) };
  });

  app.delete("/api/worlds/:id/turns/:turnId", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    const turn = scope.turns.get(id, turnId);
    if (!turn) return reply.code(404).send(apiProblem("turn.notFound"));

    // Aborted before the row goes, and the abort must not block the delete: an orphaned turn
    // ages into `stale` on its own.
    const wasRunning = turn.state === "running";
    if (wasRunning && scope.bridge) {
      try {
        const sessionId = scope.worlds.get(id)?.opencodeSessionId ?? null;
        if (sessionId !== null && sessionId !== "") {
          await (await narratorForWorld(scope, id)).abort(sessionId).catch(() => undefined);
        }
      } catch {
        // Deleted anyway.
      }
    }

    return { ok: scope.turns.remove(id, turnId) };
  });

  /**
   * The flowing text of a running turn.
   *
   * Separate from the route that starts it: a route cannot hold a response open for work
   * lasting minutes. Closes when the turn closes in the database, so an event that never
   * arrives cannot hang the connection.
   */
  app.get("/api/worlds/:id/turns/:turnId/stream", async (request, reply) => {
    const { id, turnId } = request.params as { id: string; turnId: string };
    if (!scope.worlds.get(id)) return reply.code(404).send(apiProblem("world.notFound"));
    const turn = scope.turns.get(id, turnId);
    if (!turn) return reply.code(404).send(apiProblem("turn.notFound"));

    // From here the response is ours: Fastify sends nothing more.
    reply.hijack();

    // Written here too: after the hijack Fastify no longer does it, and the browser blocks an
    // answer that arrived without them.
    const cors = corsHeaders(request.headers.origin, wantsPrivateNetwork(request.headers)) ?? {};

    reply.raw.writeHead(200, {
      ...cors,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    // A closed tab makes writing fail, and without this guard the failure lands in the `catch`
    // of a dead stream and breaks the connection too.
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

    // A chunk moves forward, the outcome closes. `done` and `error` are a preview:
    // the UI re-reads the outcome from the row.
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

    // Already over: the outcome comes from the row, since the event that would have announced
    // it will never arrive.
    if (turn.state !== "running") {
      // A stored error is the real reason; no error means it never finished, and the two stay
      // distinct so a timed-out turn is not read as a rejected one.
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

    // Safety net: the row is what says the turn is over.
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
   * Deletes the last message, one only.
   *
   * The count left is stored, so reopening shows what was left behind. `session.revert` is not
   * the way: it reports success, deletes nothing, and the message returns on the next refresh.
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

      // Below the prologue there is no campaign left.
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
      // Logged at `error` even though the answer is a 400: a deletion is the one edit that loses
      // something, and the failure may be about the message count rather than a malformed
      // request.
      log.error("message.drop.failed", { worldId: id, reason: errorDetail(error) });
      return reply.code(400).send(
        apiProblem("server.unexpected", {
          reason: errorDetail(error) ?? "unknown error",
        }),
      );
    }
  });

  /**
   * Restarts the conversation: a new session, the old one closed.
   *
   * Exists because "Delete" cannot go below the first message, and that first message may be
   * from another session and of no use.
   *
   * Canon, eras, Bible, arcs and chapters stay: the campaign continues, the conversation
   * changes.
   */
  app.post("/api/worlds/:id/conversation/reset", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!scope.bridge) return reply.code(503).send(apiProblem("opencode.unavailable"));
    const world = scope.worlds.get(id);
    if (!world) return reply.code(404).send(apiProblem("world.notFound"));

    const previous = world.opencodeSessionId ?? "";
    scope.worlds.update(id, { opencodeSessionId: null });
    scope.worlds.setKeptMessages(id, -1);

    // The characters belong to the conversation: one promoted by mistake in the previous one
    // would stay in the list with no way to remove it from the chat.
    const removedCharacters = new CastRepository(scope.db).deleteAllCharacters(id);

    if (previous !== "") {
      // Closed, not deleted, so a wrongly reset conversation is recoverable.
      await (await narratorForWorld(scope, id)).closeSession(previous).catch(() => undefined);
    }

    return { ok: true, removedCharacters: removedCharacters };
  });
}
