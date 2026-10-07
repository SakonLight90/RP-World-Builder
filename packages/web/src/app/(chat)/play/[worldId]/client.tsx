"use client";

import { CONTINUE_REQUEST, RETRY_REQUEST } from "@rpwb/shared";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Art, CastTile } from "../../../../components/Art";
import { LocalePicker } from "../../../../components/locale-picker";
import { ModelPicker } from "../../../../components/model-picker";
import { ReasoningPicker } from "../../../../components/reasoning-picker";
import type { MessageKey } from "../../../../i18n";
import { useI18n } from "../../../../i18n/provider";
import {
  api,
  explainError,
  type TurnDebug,
  type TurnRecord,
  type World,
  watchTurn,
} from "../../../../lib/api";
import {
  forgetAllPending,
  forgetPending,
  forgetPendingByPrompt,
  type PendingTurn,
  pendingId,
  pendingTurns,
  rememberPending,
} from "../../../../lib/pending";

interface Props {
  worldId: string;
}

interface Line {
  id: number;
  role: "player" | "narrator";
  text: string;
}

type Tab = "overview" | "history" | "adaptation";

/**
 * Tells the user what to do, not just what went wrong.
 *
 * The originating case is the 503: opencode isn't listening, the campaign is
 * intact on disk and starting it is enough. Showing "Error 503" says nothing
 * useful and pushes you to believe the world is gone. 404 is the only other
 * code deserving its own sentence, because it's the only one meaning the
 * requested campaign no longer exists.
 */
/*
 * `descrivi` used to live here as a local function, and became `explainError` in
 * `lib/api.ts` because the same logic had spread across pages: a 503 and a 404
 * showed the same text and the user couldn't tell whether the campaign was gone or
 * the narrator was simply off.
 */

/**
 * How long the page waits before re-reading the database while a turn runs.
 *
 * Not a soul: under a second it feels alive, over a second it feels broken.
 * And what it reads is the database, so waiting longer loses
 * nothing, it only waits longer.
 */
const POLL_MS = 1_200;

/**
 * A turn left running too long is a turn nobody is writing.
 *
 * The text isn't "nobody writes" but what happened: the backend carrying
 * the turn forward is gone. Saying "writing" here is the bug this page
 * had before, and it isn't fixed by showing it differently.
 *
 * A key and not the sentence: module scope has no translator, the language only
 * exists inside the component, so the message travels as its key and is turned
 * into words where `t` lives.
 */
const STALE_KEY: MessageKey = "play.error.stale";

/**
 * Three-column chat: art, conversation, settings.
 *
 * Narrator quotes are amber and the rest of the text stays
 * light. Not decoration: on a long-text page the eye needs to
 * know where the narrator's voice ends and a character's begins,
 * otherwise you can't tell who said what.
 */
export default function PlayClient({ worldId }: Props) {
  const { locale, t } = useI18n();
  const [world, setWorld] = useState<World | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  /**
   * The running turn, or `null`.
   *
   * It comes from the database, not a page flag, because the page has nothing
   * telling it whether the narrator is working: the backend knows, and writes it. It's
   * also why closing the tab leaves nothing busy: reopening,
   * the id is still there and the page goes back to watching what the narrator is
   * doing, instead of waiting for a reply that will never come.
   */
  const [active, setActive] = useState<string | null>(null);
  /**
   * True only between the moment the narrator model is actually changed and
   * the end of the turn in flight.
   *
   * The hint used to show on `active !== null` alone, which meant it appeared on
   * every single turn, saying "the new model applies from the next turn" about a
   * model that had never been touched. A notice about a change nobody made is
   * worse than no notice: it teaches the reader to ignore the one line in that
   * panel that would have mattered.
   */
  const [modelChanged, setModelChanged] = useState(false);
  /** Turns as stored in the database, newest first. */
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  /*
   * Load failure, kept apart from `problem`.
   *
   * They're two different things and showing them in the same spot would hide
   * one behind the other: `problem` is "that turn failed" and clears next
   * round, while this is "this screen didn't load" and stays
   * until resolved. Without this state a failed load left
   * an empty page with no explanation line, indistinguishable from
   * a freshly created, still-empty campaign.
   */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [debug, setDebug] = useState<TurnDebug | null>(null);
  const [context, setContext] = useState<Awaited<ReturnType<typeof api.context>> | null>(null);
  const [chapter, setChapter] = useState<{ n: number; title: string; summary: string } | null>(
    null,
  );
  const [cast, setCast] = useState<{ id: string; name: string }[]>([]);
  const [places, setPlaces] = useState<{ id: string; name: string }[]>([]);
  const [newNames, setNewNames] = useState<string[]>([]);
  /**
   * The last prompt that failed, if any. Feeds the "Retry" button, which
   * retries what was already written — not an order to the
   * narrator to rewrite the scene.
   */
  const [failed, setFailed] = useState<string | null>(null);
  /**
   * Prompts that never became turns, re-read from the browser disk.
   *
   * The database knows all the others, holding prompt, error and moment.
   * These are the only thing left out: when the start request fails
   * before creating the row, the database holds nothing, and losing the prompt
   * would lose what you wrote.
   */
  const [localTurns, setLocalTurns] = useState<PendingTurn[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const bottom = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(0);
  /** The running turn's narrator bubble: the one that fills. */
  const bubble = useRef<number | null>(null);
  /** The last turn seen running, to tell when it ended. */
  const closing = useRef<string | null>(null);

  /** The narrator is writing iff a turn is running. */
  const writing = active !== null;

  // Once the turn is over the notice has done its job: the next turn really is
  // the first one on the new model, and repeating it would be noise.
  useEffect(() => {
    if (active === null) setModelChanged(false);
  }, [active]);

  /**
   * The playable starts of the world, and whether the player has chosen one.
   *
   * Only the playable ones are offered. A lore-only game is in the library so the
   * narrator can cite it, not so a campaign can begin there: there is no scenario
   * to step into, and offering it would hand the player a start with no opening.
   *
   * Derived and not stored: the filter is two conditions, and a second copy of the
   * list in state is a second copy that can disagree with the world's.
   */
  const playableStarts = useMemo(() => {
    const starts = world?.starts;
    if (starts === undefined) return [];
    return starts.list.filter((entry) => entry.playable);
  }, [world]);

  /**
   * True while the player still has to say how the campaign begins.
   *
   * It is a world with starts and no selection, and nothing more: a world with no
   * starts at all has no selector to show, and a campaign already underway has
   * messages and is past this. The conversation itself is not the test, because a
   * world can have a prologue in the transcript and still be waiting for a start.
   */
  const awaitingStart =
    world !== null && playableStarts.length > 0 && world.starts.selectedId === null;

  /*
   * Where the player is, worked out and never asked for.
   *
   * The start says where the scenario begins and the name is matched against the world's
   * places. There is no picker: the player chose a scenario and that choice already named the
   * place, and a second control would let them contradict it without ever being told they had.
   *
   * A picker existed, and its empty option said "undeclared place": it asked the player to
   * state something the scenario had already stated, and a campaign that had not touched it
   * arrived with no location at all — so the narrator did not know where the scenario begins.
   *
   * `null` when the start names no place, or the world has no place by that name, and both are
   * ordinary: a hand-written start may not name one, and a world whose places have not been
   * declared yet has nothing to match.
   *
   * Derived and not stored, because it comes from two things that change independently: the
   * player can pick a different start after this renders, and the places arrive after the
   * world does.
   */
  const startLocationId = useMemo(() => {
    const starts = world?.starts;
    if (starts === undefined || starts.selectedId === null) return null;
    const start = starts.list.find((entry) => entry.id === starts.selectedId);
    const name = start?.location?.trim();
    if (name === undefined || name === "") return null;
    // Exact match first, then a prefix: a scenario can name a more specific place than the
    // canon declares, and a substring match would take the first place alphabetically.
    const wanted = name.toLowerCase();
    const exact = places.find((place) => place.name.toLowerCase() === wanted);
    if (exact !== undefined) return exact.id;
    const byPrefix = places.find((place) => place.name.toLowerCase().startsWith(wanted));
    return byPrefix?.id ?? null;
  }, [world, places]);

  /**
   * Failure of the selection, kept apart from `problem`.
   *
   * The two refusals the server can answer with are worth telling apart: a start
   * that does not exist means the campaign was forked from a template that has
   * since changed, and the player has to choose again, while a lore-only start is
   * the interface offering something it should not have.
   */
  const [startProblem, setStartProblem] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  /**
   * Chooses the start, and re-reads the transcript so the opening narration is the
   * first message.
   *
   * The transcript is re-read rather than the narration inserted by hand: the
   * prologue is built on the server out of the selected start, so the page would
   * be guessing at a thing it can simply ask for. Guessing would also mean two
   * copies of "what the first message is", and the one on screen would stop being
   * what the narrator was given.
   */
  const chooseStart = useCallback(
    async (startId: string | null): Promise<void> => {
      setStartProblem(null);
      try {
        const data = await api.selectStart(worldId, startId);
        setWorld(data.world);
        const transcript = await api.transcript(worldId);
        setLines(
          transcript.messages
            .filter((message) => message.text.trim() !== "")
            .map((message) => ({
              id: nextId.current++,
              role: message.role === "user" ? ("player" as const) : ("narrator" as const),
              text: message.text,
            })),
        );
      } catch (error) {
        setStartProblem(explainError(error, locale));
      }
    },
    [worldId, locale],
  );

  const refresh = useCallback(() => {
    api
      .context(worldId)
      .then(setContext)
      .catch(() => undefined);
    api
      .chapters(worldId)
      .then((d) => setChapter(d.chapters.at(-1) ?? null))
      .catch(() => undefined);
  }, [worldId]);

  /**
   * Re-reads turns from the database.
   *
   * After a send nothing is patched by hand: what the page shows is
   * what the backend wrote. A missed read is fine: leave
   * as is, because the narrator keeps writing and it's found next
   * round.
   */
  const readTurns = useCallback(async (): Promise<void> => {
    try {
      const data = await api.turns(worldId);
      setTurns(data.turns);
      setActive(data.active);
    } catch {
      // The API didn't answer. Don't touch what's already on screen.
    }
  }, [worldId]);

  useEffect(() => {
    /*
     * `Promise.all` on a single request is a single request: if the world
     * fails, cast and places are never asked, and vice versa. With
     * `allSettled` every read starts, each writes its result, and
     * failures are collected: two calls out of three could work while the
     * third doesn't, and showing only the first error would make the page
     * look entirely broken.
     */
    const reads = Promise.allSettled([
      api.world(worldId).then((d) => setWorld(d.world)),
      api.characters(worldId).then((d) => setCast(d.characters)),
      api.locations(worldId).then((d) => setPlaces(d.locations)),
      // Chat doesn't restart from zero: history is re-read from the opencode
      // session, the same one the narrator is reading. Re-reading
      // it, not rebuilding it by hand, is also why what you see
      // here and what the narrator knows can't diverge.
      api.transcript(worldId).then((data) => {
        setLines(
          data.messages
            .filter((message) => message.text.trim() !== "")
            .map((message) => ({
              id: nextId.current++,
              role: message.role === "user" ? ("player" as const) : ("narrator" as const),
              text: message.text,
            })),
        );
      }),
    ]);
    void reads.then((results) => {
      const failures = results.filter((e) => e.status === "rejected");
      if (failures.length === 0) {
        setLoadError(null);
        return;
      }
      const texts = failures.map((e) => explainError(e.reason, locale));
      const unique = [...new Set(texts)];
      setLoadError(
        unique.length === 1
          ? `${t("play.error.loadFailed")} ${unique[0]}`
          : `${t("play.error.loadPartial")} ${unique.join(" ")}`,
      );
    });

    // And above history, what was left halfway.
    setFailed(null);
    setLocalTurns(pendingTurns(worldId));

    // Turns are re-read at startup, not just after a send: if the narrator is
    // writing in another tab, or this page was reopened while
    // writing, the running turn is already in the database and must show.
    void readTurns();

    refresh();
  }, [worldId, refresh, readTurns, t, locale]);

  // Scrolling follows row changes and writing state,
  // even when they aren't read inside: they're the signal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: they're the signal
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines, writing]);

  /**
   * The narrator bubble, when a turn is running.
   *
   * It's created even when Send wasn't pressed on this page, because the running
   * turn may have started earlier: reopening the tab mid-generation
   * must show the narrator writing and complete on its own, not a frozen
   * chat looking like always.
   */
  useEffect(() => {
    if (active === null || bubble.current !== null) return;
    const id = nextId.current++;
    bubble.current = id;
    setLines((prev) => [...prev, { id, role: "narrator", text: "" }]);
  }, [active]);

  /**
   * How the running turn ended.
   *
   * It's where the outcome is applied, and only the row tells the outcome. The stream
   * event is never used for anything: it's a notice, and a notice arriving
   * halfway would tell half a result.
   */
  useEffect(() => {
    const previous = closing.current;
    closing.current = active;
    if (previous === null || active !== null) return;

    const turnBubble = bubble.current;
    bubble.current = null;
    const turn = turns.find((t) => t.id === previous);
    // If the turn isn't listed there's nothing to apply: the world was
    // deleted, or the list is too short. No outcome is invented.
    if (turn === undefined) return;

    if (turn.state === "completed") {
      // The visible text was the preview: now the backend's writing replaces it.
      if (turnBubble !== null) {
        const text = turn.text ?? "";
        setLines((prev) =>
          prev.map((line) => (line.id === turnBubble ? { ...line, text: text } : line)),
        );
      }
      setFailed(null);
      // A successful attempt closes the matter of failed ones with the same
      // text: otherwise the memory of the botched attempt lingers on top with
      // its message still looking current. Now they're truly removed, because
      // the server can delete rows.
      forgetPendingByPrompt(worldId, turn.prompt);
      const superseded = turns.filter(
        (t) => t.prompt === turn.prompt && (t.state === "failed" || t.state === "stale"),
      );
      if (superseded.length > 0) {
        setTurns((prev) => prev.filter((t) => t.prompt !== turn.prompt || t.id === turn.id));
        void (async () => {
          for (const attempt of superseded) {
            await api.deleteTurn(worldId, attempt.id).catch(() => undefined);
          }
          refresh();
        })();
      }
      refresh();
      return;
    }

    // It didn't succeed. The prompt stays in chat, the answer doesn't: never
    // write "the narrator said" when the narrator said nothing, and never
    // assume the prompt arrived.
    setProblem(turn.error ?? t(STALE_KEY));
    setFailed(turn.prompt);
    if (turnBubble !== null) {
      setLines((prev) => prev.filter((line) => line.id !== turnBubble));
    }
  }, [active, turns, refresh, worldId, t]);

  // While a turn runs the page re-reads the database: the only honest
  // way to know whether the narrator finished, working even when the progress
  // stream dropped, or never arrived.
  useEffect(() => {
    if (active === null) return;
    const timer = setInterval(() => void readTurns(), POLL_MS);
    return () => clearInterval(timer);
  }, [active, readTurns]);

  /**
   * The preview: text streaming in as it arrives.
   *
   * It decides nothing. When the turn ends the outcome is re-read from the database
   * and replaces this text. If the stream drops, the bubble stays as is and the
   * narrator carries on regardless: losing the preview is one thing, losing the
   * answer another.
   */
  useEffect(() => {
    if (active === null) return;
    let live = true;
    let buffer = "";

    void (async () => {
      for await (const event of watchTurn(worldId, active)) {
        if (!live) return;
        if (event.type === "done") {
          // The turn's summary isn't in the database, and names the narrator
          // cited are needed to propose them to canon.
          if (event.debug) {
            setDebug(event.debug);
            setNewNames(event.debug.names.filter((n) => !n.known).map((n) => n.surface));
          }
          continue;
        }
        if (event.text === undefined) continue;
        buffer += event.text;
        const id = bubble.current;
        if (id === null) continue;
        setLines((prev) => prev.map((line) => (line.id === id ? { ...line, text: buffer } : line)));
      }
    })();

    return () => {
      live = false;
    };
  }, [active, worldId]);

  /**
   * Turns that didn't succeed, with their reason.
   *
   * They come from the database, and for a failed turn the database holds everything:
   * prompt, error and moment. Added are the ones that never became turns,
   * because the database knows nothing of those, and without the prompt you'd written
   * the page would show an error with no text it refers to.
   */
  const failedTurns = useMemo(
    () => [
      ...turns
        .filter((turn) => turn.state === "failed" || turn.state === "stale")
        .map((turn) => ({
          key: `turn:${turn.id}`,
          id: turn.id,
          origin: "turn" as const,
          prompt: turn.prompt,
          partial: "",
          reason:
            turn.state === "stale"
              ? t("play.error.turnUnfinished")
              : t("play.error.turnNotFinished"),
          detail: turn.error ?? t(STALE_KEY),
        })),
      ...localTurns.map((item) => ({
        key: `prompt:${item.id}`,
        id: item.id,
        origin: "prompt" as const,
        prompt: item.prompt,
        partial: item.partial,
        reason: t("play.error.neverReached"),
        detail: item.problem,
      })),
    ],
    [turns, localTurns, t],
  );

  /**
   * Sends a turn.
   *
   * `silent` feeds the "Continua" button: the narrator continues, but it is not the player
   * speaking, so no line appears in chat. The text feeds the model; the cursor must not
   * impersonate the player.
   *
   * Start and exit here: what answers is the turn's id, not the text. The
   * narrator carries on even if the tab closes a second later, and what it
   * writes is re-read from the database.
   */
  async function send(text?: string, silent = false): Promise<void> {
    const body = (text ?? input).trim();
    if (body === "" || writing) return;

    if (!silent) setInput("");
    setProblem(null);

    const playerId = nextId.current++;
    const narratorId = nextId.current++;
    if (!silent) {
      setLines((prev) => [...prev, { id: playerId, role: "player", text: body }]);
    }
    setLines((prev) => [...prev, { id: narratorId, role: "narrator", text: "" }]);
    bubble.current = narratorId;

    try {
      const started = await api.startTurn(worldId, {
        text: body,
        locale: world?.activeLocale ?? "it",
        locationId: startLocationId,
        silent,
      });
      setActive(started.turnId);
    } catch (error) {
      // No turn was born here: the row doesn't exist, and the prompt never reached
      // the narrator. It must be kept somewhere or your text is lost, and nobody
      // could retry it again.
      const why = error instanceof Error ? error.message : String(error);
      setProblem(why);
      setFailed(body);
      bubble.current = null;
      setLines((prev) => prev.filter((line) => line.id !== narratorId));
      rememberPending(worldId, {
        id: pendingId(worldId, body, Date.now()),
        prompt: body,
        partial: "",
        problem: why,
        at: Date.now(),
      });
      setLocalTurns(pendingTurns(worldId));
    }
  }

  /**
   * Retry a prompt.
   *
   * It goes like a normal send, not silently: if it's your line, in chat it must
   * appear as such, otherwise after the retry you can't tell what you
   * wrote. Before sending, the leftover line with the same text from the failed attempt is
   * removed, otherwise two copies of the same sentence back to back look like you wrote it
   * twice.
   *
   * The only exception is "Continua": that's not a player turn, so
   * retrying it must not put words in your mouth that aren't yours.
   */
  async function retry(prompt: string): Promise<void> {
    if (writing || prompt.trim() === "") return;

    setProblem(null);
    setFailed(null);
    forgetPendingByPrompt(worldId, prompt);
    setLocalTurns(pendingTurns(worldId));
    // The previous attempt's line, if any.
    setLines((prev) => {
      const last = prev[prev.length - 1];
      return last !== undefined && last.role === "player" && last.text.trim() === prompt.trim()
        ? prev.slice(0, -1)
        : prev;
    });

    await send(prompt, prompt === CONTINUE_REQUEST);
  }

  /**
   * Deletes **one** message only: the last, nothing more.
   *
   * Not a line more. One message is one message — your text is one, the narrator's
   * reply is another — and pressing once must remove a single thing, or the
   * button ends up eating the conversation two chunks at a time and nobody knows
   * where it stood.
   *
   * The server keeps count of remaining messages, so a refresh doesn't
   * requeue what you just deleted.
   */
  async function dropLast(): Promise<void> {
    try {
      await api.dropMessage(worldId);
      setLines((prev) => prev.slice(0, -1));
      setProblem(null);
      refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Restarts the conversation.
   *
   * "Delete" can't go below the world prologue, and sometimes the first
   * remaining message is something that isn't yours. This opens a new session,
   * clears the previous game's cast and leaves canon, eras,
   * Bible, arcs and chapters intact: a new conversation, not a new world.
   */
  async function resetConversation(): Promise<void> {
    if (!window.confirm(t("play.confirm.reset"))) {
      return;
    }
    try {
      await api.resetConversation(worldId);
      setLines([]);
      setTurns([]);
      // Prompts that never started go too, not just on-screen ones: the
      // page re-reads them from `localStorage` at startup, so clearing state
      // without clearing disk would bring back on next refresh
      // what the user just zeroed.
      forgetAllPending(worldId);
      setLocalTurns([]);
      setFailed(null);
      setProblem(null);
      /*
       * The server also deleted the cast: without re-reading it, the
       * `adaptation` tab would keep showing the old game's characters,
       * looking like the reset didn't work.
       */
      const [freshCast, freshPlaces] = await Promise.all([
        api.characters(worldId),
        api.locations(worldId),
      ]);
      setCast(freshCast.characters);
      setPlaces(freshPlaces.locations);
      refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  async function promote(name: string): Promise<void> {
    try {
      await api.promote(worldId, { name, kind: "character" });
      setNewNames((prev) => prev.filter((item) => item !== name));
      const fresh = await api.characters(worldId);
      setCast(fresh.characters);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }

  const ratio = context === null ? 0 : Math.min(1, context.state.ratio);
  const over = context !== null && context.state.tokensUsed >= context.state.chapterThreshold;
  const near = context !== null && context.state.tokensUsed >= context.state.chapterThreshold * 0.8;

  return (
    <div className="theatre">
      {/* art column: the world, full height */}
      <aside className="rail">
        <Art seed={world?.name ?? worldId} title={world?.name} />
      </aside>

      {/* conversation column */}
      <section className="stage">
        <header className="stage-head">
          <Link href="/" aria-label={t("play.aria.backHome")} className="btn btn-sm btn-outline">
            ‹
          </Link>
          <h1 className="clamp2">{world?.name ?? "…"}</h1>
          <span className="spacer" />
          {/*
              Reopening the selector, for a campaign already under way.

              It is offered and not forced: the opening narration is the first
              message of the transcript, and changing the start of a campaign that
              has been played does not rewrite that message. The player is left to
              decide, which is why this is a button in the header rather than
              something the page does on its own.
            */}
          {playableStarts.length > 0 && !awaitingStart && (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              aria-label={t("play.start.aria.open")}
              title={t("play.start.change")}
              onClick={() => setChoosing((open) => !open)}
            >
              ◆
            </button>
          )}
          <Link href={`/world/${worldId}`} className="btn btn-sm btn-outline">
            ⚙
          </Link>
        </header>

        <div className="stream">
          <div className="stream-in">
            {/*
                The load failure lives here, not in a separate notice, because it competes
                with the text: if the campaign didn't load, what shows
                below isn't "an empty chat", it's the result of a failed
                read. Without this line the user can't tell the two
                apart and concludes the campaign was lost.
              */}
            {loadError !== null && (
              <div className="pad">
                <div className="note note-bad">
                  <strong>{t("play.error.loadTitle")}</strong>
                  <div style={{ marginTop: 4 }}>{loadError}</div>
                </div>
              </div>
            )}

            {/* The world prologue is message 1 and comes from history, not
                from here. Exactly once: placed at this point too,
                it would appear twice atop the chat, looking like the
                narrator says it then repeats it. */}
            {/*
                The selector, inside the conversation and not on the creation form.

                The player chooses how to begin here, where the narration of the
                start is the first message they will read. A form at creation time
                would have asked the same question earlier and with less to go on:
                the names of the scenarios are what make the choice meaningful, and
                here they can already see the one they will start from.

                It is a panel and not a replacement for the empty state: below it
                the world is still shown, because a world with no start chosen is a
                world waiting, not an empty one.
              */}
            {world !== null && (awaitingStart || choosing) && (
              <div className="pad">
                <section
                  className="note"
                  aria-label={t("play.start.aria.group")}
                  style={{ marginBottom: 20 }}
                >
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{t("play.start.title")}</strong>
                      <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                        {t("play.start.hint")}
                      </div>
                    </div>
                    {!awaitingStart && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        aria-label={t("play.start.aria.close")}
                        onClick={() => setChoosing(false)}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {startProblem !== null && (
                    <div className="note note-bad" style={{ marginTop: 12 }}>
                      {startProblem}
                    </div>
                  )}

                  {/*
                      Buttons, not radios.

                      A radio group would be the semantically correct choice for "pick
                      one of these", and it is refused for one reason: these are not
                      values in a form, they are actions. Choosing one writes the
                      selection and changes the opening the narrator will write from,
                      and a radio only holds a value without submitting it. The
                      pressed state carries the meaning instead, and `aria-pressed` is
                      what a screen reader announces on a control that acts.

                      `aria-pressed` and not a checked state, for the same reason: a
                      radio announces "checked", which is a promise about a form value
                      that does not exist here.
                    */}
                  <div className="stack" style={{ gap: 8, marginTop: 14 }}>
                    {playableStarts.map((start) => {
                      const isSelected = world.starts.selectedId === start.id;
                      return (
                        <button
                          key={start.id}
                          type="button"
                          aria-pressed={isSelected}
                          className="btn btn-block"
                          style={{ textAlign: "left", justifyContent: "flex-start" }}
                          onClick={() => void chooseStart(start.id)}
                        >
                          <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <strong>{start.name}</strong>
                              {isSelected && (
                                <span className="tag" style={{ marginLeft: "auto" }}>
                                  {t("play.start.chosen")}
                                </span>
                              )}
                            </span>
                            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                              {start.narration}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </div>
            )}

            {/* The world prologue is message 1 and comes from history, not
                from here. Exactly once: placed at this point too,
                it would appear twice atop the chat, looking like the
                narrator says it then repeats it. */}
            {lines.length === 0 && failedTurns.length === 0 && loadError === null && (
              <div className="pad center">
                <p style={{ fontFamily: "var(--font-gold)", fontSize: 20, color: "var(--gold)" }}>
                  {world?.name ?? t("play.state.worldFallback")}
                </p>
                <p className="muted" style={{ maxWidth: 460, margin: "8px auto 0" }}>
                  {t("play.state.emptyHint")}
                </p>
              </div>
            )}
          </div>

          {lines.length > 0 || failedTurns.length > 0 ? (
            <>
              <div className="stream-in stack" style={{ gap: 24 }}>
                {lines.map((line) =>
                  line.role === "player" ? (
                    <article key={line.id} className="you">
                      <div className="who">
                        <span className="who-mark" aria-hidden="true">
                          ✧
                        </span>
                        {t("play.turn.you")}
                      </div>
                      <div className="narr">
                        <PlayerText text={line.text} />
                      </div>
                    </article>
                  ) : (
                    <article key={line.id}>
                      <div className="who">
                        <span className="who-mark" aria-hidden="true">
                          ✦
                        </span>
                        {t("play.turn.narrator")}
                      </div>
                      <div className="narr">
                        <Narration text={line.text} />
                        {writing && line.id === lines[lines.length - 1]?.id && (
                          <span className="caret" aria-hidden="true" />
                        )}
                      </div>
                      <div className="stamp">
                        <span>{context?.model.replace("opencode/", "") ?? ""}</span>
                        <span className="chip chip-green">{t("play.settings.freeBadge")}</span>
                      </div>
                    </article>
                  ),
                )}
                {writing && lines[lines.length - 1]?.text === "" && (
                  <span className="typing" role="status" aria-label={t("play.turn.typing")}>
                    <i />
                    <i />
                    <i />
                  </span>
                )}
                <div ref={bottom} />
                <p className="disclaimer">{t("play.turn.disclaimer")}</p>
              </div>

              {/* The error and the warning sit **at the bottom of the history**, after
                  the last message. They used to be on top, even above the prologue: an
                  error appearing before what it refers to makes you read the story
                  backwards, and it looks like the first thing went wrong when it is
                  the last. */}
              {failedTurns.length > 0 && (
                <div className="note note-warn" style={{ marginBottom: 14 }}>
                  <div style={{ marginBottom: 8 }}>
                    {failedTurns.length === 1
                      ? t("play.turn.failedOne")
                      : t("play.turn.failedMany", { count: failedTurns.length })}{" "}
                    {t("play.turn.failedWhy")}
                  </div>
                  <div className="stack">
                    {failedTurns.map((item) => (
                      <div
                        key={item.key}
                        className="panel"
                        style={{ padding: 12, background: "var(--indigo-2)" }}
                      >
                        <p className="narr" style={{ borderBottom: 0, paddingBottom: 8 }}>
                          <PlayerText text={item.prompt} />
                        </p>
                        {item.partial !== "" && (
                          <p
                            className="narr"
                            style={{ borderBottom: 0, paddingBottom: 8, fontSize: 15 }}
                          >
                            <Narration text={item.partial} />
                          </p>
                        )}
                        <div className="row" style={{ gap: 8 }}>
                          <span className="muted clamp2" style={{ flex: 1, minWidth: 0 }}>
                            {item.reason} {item.detail}
                          </span>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={writing}
                            onClick={() => void retry(item.prompt)}
                          >
                            {t("play.action.retry")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              if (item.origin === "prompt") {
                                forgetPending(worldId, item.id);
                                setLocalTurns(pendingTurns(worldId));
                                return;
                              }
                              // Now the row really goes: the server deletes the
                              // turn from the registry, so it doesn't come back on refresh.
                              void (async () => {
                                try {
                                  await api.deleteTurn(worldId, item.id);
                                  setTurns((prev) => prev.filter((t) => t.id !== item.id));
                                } catch (failure) {
                                  setProblem(
                                    failure instanceof Error ? failure.message : String(failure),
                                  );
                                }
                              })();
                            }}
                          >
                            {t("play.action.discard")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {newNames.length > 0 && (
                <div className="note note-warn">
                  <div style={{ marginBottom: 8 }}>{t("play.context.newNames")}</div>
                  <div className="row">
                    {newNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="btn btn-sm"
                        onClick={() => promote(name)}
                      >
                        + {name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {problem !== null && (
                <div className="note note-bad">
                  <strong>{t("play.error.turnFailed")}</strong>
                  <div style={{ marginTop: 4 }}>{problem}</div>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div className="composer">
          <div className="composer-in">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t("play.composer.placeholder")}
              rows={3}
              disabled={writing}
            />

            <div className="row" style={{ marginTop: 10, gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void send()}
                disabled={writing || input.trim() === ""}
                style={{ flex: 1 }}
              >
                {writing ? t("play.composer.writing") : t("play.action.send")}
              </button>
            </div>

            <div className="acts" style={{ paddingTop: 10 }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void send(CONTINUE_REQUEST, true)}
                disabled={writing || lines.length === 0}
                title={t("play.composer.continueTitle")}
              >
                {t("play.action.continue")}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void send(RETRY_REQUEST, true)}
                disabled={writing || lines.length === 0}
                title={t("play.composer.redoTitle")}
              >
                {t("play.action.retry")}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={writing || failed === null}
                onClick={() => {
                  if (failed === null) return;
                  // The failed prompt's line stays: that is what you wrote.
                  // It retries that one, without adding a second copy.
                  void retry(failed);
                }}
                title={
                  failed === null
                    ? t("play.composer.retryIdleTitle")
                    : t("play.composer.retryTitle")
                }
              >
                {t("play.action.retry")}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={writing || lines.length === 0}
                onClick={() => void dropLast()}
                title={t("play.composer.deleteTitle")}
              >
                {t("play.action.delete")}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={writing}
                onClick={() => void resetConversation()}
                title={t("play.composer.resetTitle")}
              >
                {t("play.action.reset")}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* settings column */}
      <aside className="inspector">
        <div className="ins-head">
          <span className="spacer">{t("play.settings.title")}</span>
          <span className="chip chip-green">{t("play.locale.chip")}</span>
        </div>

        {/* The tab list stays here, inside the component: a module-scope array
            would hold labels nobody can translate yet, so it carries keys and the
            words are resolved at render time. */}
        <div className="tabs" role="tablist">
          {(
            [
              ["overview", "play.tabs.overview"],
              ["history", "play.tabs.history"],
              ["adaptation", "play.tabs.adaptation"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              className="tabline"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {t(label)}
            </button>
          ))}
        </div>

        <div className="ins-body">
          {tab === "overview" && (
            <>
              <div className="panel" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{world?.name ?? "—"}</div>
                <p className="muted clamp3" style={{ margin: "6px 0 0" }}>
                  {world?.description || t("play.state.noDescription")}
                </p>
              </div>

              <div className="modelcard">
                <h3>
                  {context?.model.replace("opencode/", "") ?? "—"}
                  <span className="chip chip-green">{t("play.settings.freeBadge")}</span>
                </h3>
                {/*
                  The model is changed here, not on another screen: the settings
                  already sit in the column to the right of the chat, and a second
                  copy on another page means it can't be found while playing.

                  The picker only mounts with the world loaded. The type says it's
                  required, but while loading `world` is still null: forcing it with a
                  cast silences the compile error and leaves a crash at runtime,
                  which is worse.
                */}
                {world === null ? null : (
                  <ModelPicker
                    worldId={worldId}
                    world={world}
                    disabled={active !== null}
                    onSaved={(saved) => {
                      if (world !== null && saved.model !== world.model) setModelChanged(true);
                      setWorld(saved);
                    }}
                  />
                )}
                {active !== null && modelChanged ? (
                  <p className="hint">{t("play.settings.writingHint")}</p>
                ) : null}
                <div className="meter-row" style={{ marginTop: 12 }}>
                  <span>{t("play.context.estimated")}</span>
                  <span>
                    {t("play.context.limit", {
                      limit: (context?.state.contextLimit ?? 0).toLocaleString(locale),
                    })}
                  </span>
                </div>
                <div className="meter">
                  <i
                    className={over ? "over" : near ? "warn" : ""}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                <div className="meter-row" style={{ marginTop: 6, marginBottom: 0 }}>
                  <span>
                    {t("play.context.tokens", {
                      count: (context?.state.tokensUsed ?? 0).toLocaleString(locale),
                    })}
                  </span>
                  <span>
                    {context === null
                      ? ""
                      : t("play.context.chapterAt", {
                          limit: context.state.chapterThreshold.toLocaleString(locale),
                        })}
                  </span>
                </div>
              </div>

              {debug !== null && (
                <details className="acc">
                  <summary>{t("play.settings.canonSummary")}</summary>
                  <div>
                    {t("play.context.canonEntries", {
                      entries: debug.canon.entries.toLocaleString(locale),
                      tokens: debug.canon.tokens.toLocaleString(locale),
                    })}
                    <br />
                    <span className="muted">
                      {debug.canon.tiers.join(" · ") || t("play.state.noTier")}
                    </span>
                    {debug.canon.overBudget && (
                      <div className="note note-warn" style={{ marginTop: 8 }}>
                        {t("play.context.canonOverBudget")}
                      </div>
                    )}
                  </div>
                </details>
              )}

              <details className="acc">
                <summary>{t("play.settings.arcMemory")}</summary>
                <div>
                  {context === null
                    ? "…"
                    : t("play.context.arcTokens", {
                        with: context.carryover.withArcs.toLocaleString(locale),
                        without: context.carryover.withoutArcs.toLocaleString(locale),
                      }) +
                      (context.carryover.saved > 0
                        ? t("play.context.arcSaved", {
                            percent: Math.round(context.carryover.savedRatio * 100),
                          })
                        : "")}
                </div>
              </details>

              <details className="acc">
                <summary>{t("play.settings.chat")}</summary>
                <div>
                  {/* Power and language are changed here and not on another
                      screen: while playing you don't go looking for another page, and the
                      column on the right already has them. */}
                  {world === null ? null : (
                    <>
                      <ReasoningPicker
                        worldId={worldId}
                        world={world}
                        disabled={active !== null}
                        onSaved={(saved) => setWorld(saved)}
                      />
                      <LocalePicker
                        worldId={worldId}
                        world={world}
                        onSaved={(saved) => setWorld(saved)}
                      />
                    </>
                  )}
                </div>
              </details>
            </>
          )}

          {tab === "history" && (
            <>
              <div className="panel" style={{ padding: 12 }}>
                <div className="muted" style={{ margin: 0 }}>
                  {t("play.history.chapters")}
                </div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>
                  {chapter === null ? t("play.state.noChapter") : `${chapter.n}. ${chapter.title}`}
                </div>
                {chapter !== null && (
                  <p className="muted clamp3" style={{ margin: "6px 0 0" }}>
                    {chapter.summary}
                  </p>
                )}
              </div>
              <Link href={`/world/${worldId}`} className="btn btn-sm btn-outline">
                {t("play.history.openNotebook")}
              </Link>
            </>
          )}

          {tab === "adaptation" && (
            <>
              <div className="panel" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{t("play.adapt.castTitle")}</div>
                {cast.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {t("play.adapt.castEmpty")}
                  </p>
                ) : (
                  <div className="castrow" style={{ marginTop: 10 }}>
                    {cast.map((person) => (
                      <CastTile
                        key={person.id}
                        name={person.name}
                        onRemove={
                          // Removing a single character from here: the campaign
                          // isn't redone for a wrong name, and from the chat it was
                          // the only place it couldn't be done.
                          () => {
                            if (!confirm(t("play.confirm.removeCharacter", { name: person.name })))
                              return;
                            setCast((previous) => previous.filter((p) => p.id !== person.id));
                            void api
                              .deleteCharacter(worldId, person.id)
                              .catch((failure: unknown) => {
                                void api
                                  .characters(worldId)
                                  .then((r) => setCast(r.characters))
                                  .catch(() => undefined);
                                setProblem(
                                  failure instanceof Error ? failure.message : String(failure),
                                );
                              });
                          }
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="panel" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700 }}>{t("play.adapt.placesTitle")}</div>
                {places.length === 0 ? (
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {t("play.adapt.placesEmpty")}
                  </p>
                ) : (
                  <div className="row" style={{ marginTop: 8 }}>
                    {places.map((place) => (
                      <span key={place.id} className="chip">
                        {place.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * One line from the player.
 *
 * The ** are their convention for meaning "I'm doing this", not the narrator's. They become
 * italics only if they come in pairs: an unpaired one leaves the text as it is, or half a long
 * prompt would render italic and half not.
 */
function PlayerText({ text }: { text: string }) {
  const marks = text.split("**").length - 1;
  const parts = text.split(/\*\*([^*]+)\*\*/g);

  if (marks === 0 || marks % 2 === 1 || parts.length < 3) return <>{text}</>;

  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;
    out.push(i % 2 === 1 ? <em key={`a${i}`}>{part}</em> : <span key={`t${i}`}>{part}</span>);
  }
  return <>{out}</>;
}

/**
 * Renders the narrator's scene.
 *
 * The narrator doesn't use asterisks: it writes plain and puts lines between
 * quotation marks. Those turn yellow, because on a long page the eye needs
 * to know where the narrator's voice ends and a character's begins.
 */
function Narration({ text }: { text: string }) {
  const parts = text.split(/("[^"]*")/g);
  const out: ReactNode[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;
    // Parts alternate text and quotation: the position is the part's identity,
    // so here the key is the position itself.
    out.push(
      part.startsWith('"') && part.endsWith('"') && part.length > 2 ? (
        <span key={`q${i}`} className="said">
          {part}
        </span>
      ) : (
        <span key={`t${i}`}>{part}</span>
      ),
    );
  }

  return <>{out}</>;
}
