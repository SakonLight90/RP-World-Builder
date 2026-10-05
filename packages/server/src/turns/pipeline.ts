import type { ContextState, Era, TokenUsage, World } from "@rpwb/shared";
import {
  computeChapterThreshold,
  contextFootprint,
  emptyTokenUsage,
  localeName,
} from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import { renderArcMemory } from "../canon/arc-memory.js";
import { type ChapterSummary, closeChapter } from "../canon/chapterer.js";
import { buildCanonSlice } from "../canon/inject.js";
import { buildLexicon, detectNames } from "../canon/lexicon.js";
import { renderCanonSlice, summarizeSlice } from "../canon/render.js";
import { writeArcSpine } from "../canon/spine.js";
import { buildStateCard } from "../canon/state-card.js";
import { ArcRepository } from "../db/repo/arcs.js";
import { CanonRepository } from "../db/repo/canon.js";
import { CastRepository } from "../db/repo/cast.js";
import { ChapterRepository } from "../db/repo/chapters.js";
import { WorldRepository } from "../db/repo/worlds.js";
import { findInLibrary, renderLibraryHits } from "../lore/lookup.js";
import { resolveLibraries } from "../lore/registry.js";
import { isRecord } from "../opencode/bridge.js";
import { contextLimitFor, shouldCloseChapter, snapshot } from "../opencode/context.js";
import { mark } from "../opencode/markers.js";
import type { EventSubscription, Narrator } from "../opencode/narrator.js";
import { currentContextUsage } from "../opencode/session.js";
import { CampaignSession } from "./session.js";

/**
 * A turn, in order.
 *
 * 1. the overdue chapters are closed, before anything new is written
 * 2. canon and state are injected, which generate no answer
 * 3. the player's action is sent and the text is streamed as it comes
 *
 * Point 1 comes first on purpose: if the context is full, the chapter is written
 * **before** the turn that would make it overflow, not after.
 */

/**
 * The narrator agent's name.
 *
 * It has to be passed **explicitly** on every prompt. Without it, opencode uses
 * its own default agent, which is a coding agent with the tools active: it tries
 * to do its job instead of narrating, and the turn never ends. With the right
 * agent, which has no tools, the turn ends with `session.idle`.
 */
const GM_AGENT = "gm";

/**
 * How long a turn can last before the work is given up on.
 *
 * There are two limits in two different places, and it is the difference that
 * makes the deadline safe. This is the **outer limit**: it covers the whole
 * `#run`, that is also what happens before the stream (chapters, context,
 * `promptAsync`) and what happens after. The one inside `#readTurn` covers only
 * the reading of the events, and if the waiting is upstream it covers nothing: it
 * is exactly the hole for which a turn could stay `running` forever.
 *
 * The value is the pipeline's timeout plus a margin. It has to be **greater**,
 * otherwise the outer deadline cuts a turn the pipeline was still closing
 * properly and that would have finished on its own; and it has to stay below
 * `RUNNING_STALE_MS` in the repository, which is the threshold past which a
 * `running` row is shown as `interrupted`: the turn has to become `failed`
 * **by decision**, with a written reason, not by ageing.
 */
export const TURN_TIMEOUT_MS = 240_000;

/**
 * An opencode event, reduced to what the turn uses.
 *
 * It lives here because it is born here and consumed here: `parseTurnEvent`
 * produces it, `#run` and `#readTurn` filter it and `play` accumulates it. A
 * separate module for this type had ended up containing also a whole second copy
 * of `streamTurn`, that is a stream-reading path nobody used and that had a
 * `finally` that never closed: dead code with a known flaw inside is a trap for
 * whoever re-imports it.
 */
export type TurnEvent =
  | { kind: "text"; delta: string; partId: string }
  | { kind: "reasoning"; delta: string }
  | { kind: "usage"; usage: TokenUsage }
  | { kind: "error"; message: string }
  | { kind: "done"; usage: TokenUsage | null };

export interface TurnInput {
  worldId: string;
  /** What the player wants to do, in free-form language. */
  text: string;
  /** Language the narrator must write in. */
  locale: string;
  /** Current place, chosen by the player. */
  locationId: string | null;
  /**
   * The turn is the narrator's, not the player's: "Continue" is not a line and
   * must not appear in the chat. The text is for the model, but the interface
   * does not make a bubble out of it.
   */
  silent?: boolean;
}

export interface TurnDebug {
  context: ContextState;
  canon: {
    entries: number;
    tokens: number;
    tiers: ReturnType<typeof summarizeSlice>;
    overBudget: boolean;
    truncated: boolean;
    dropped: number;
  };
  stateCardTokens: number;
  /** Library names found in the player's text and injected into the context. */
  library?: { hits: string[] };
  chapter: { closed: boolean; n: number; recovery: string; tokens: number } | null;
  arc: { id: string; n: number; title: string; chapters: number; remaining: number } | null;
  names: { surface: string; known: boolean }[];
}

export interface TurnResult {
  sessionId: string;
  usage: TokenUsage;
  text: string;
  debug: TurnDebug;
}

/**
 * A turn that ended badly, with the reason why.
 *
 * It goes as an error and not as an empty result for a precise reason: a turn
 * with no text that comes back as a success is indistinguishable, for whoever
 * reads the row, from a narrator that decided to stay silent. Whoever closes the
 * turn has to be able to write the reason in the row, and a result with
 * `text: ""` carries no reason with it.
 */
export class TurnFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnFailed";
  }
}

/** Pipeline clock. It is for the tests, so they do not have to wait four minutes. */
export type Clock = () => number;

export class TurnPipeline {
  readonly #narrator: Narrator;
  readonly #campaign: CampaignSession;
  readonly #worlds: WorldRepository;
  readonly #canon: CanonRepository;
  readonly #cast: CastRepository;
  readonly #chapters: ChapterRepository;
  readonly #arcs: ArcRepository;
  /** Libraries root, received from whoever builds the pipeline. */
  readonly #loreRoot: string;
  readonly #clock: Clock;

  /**
   * `loreRoot` is the libraries root and it is received from whoever builds the
   * pipeline: the worlds' folder already has it for every world, in `opencodeDir`,
   * and the libraries live outside the worlds on purpose. A `worldDirHint` parameter
   * was there, nobody used it and it got dropped: it remained only as the
   * signature of a piece of code that no longer exists, so it went away instead of
   * staying to occupy a position where the libraries root belongs today.
   *
   * The narrator is a contract and not a client: the pipeline does not know what
   * is behind it, and that is the point of the whole change.
   */
  constructor(db: Database, narrator: Narrator, loreRoot: string, clock: Clock = Date.now) {
    this.#narrator = narrator;
    this.#clock = clock;
    this.#worlds = new WorldRepository(db);
    this.#canon = new CanonRepository(db);
    this.#cast = new CastRepository(db);
    this.#chapters = new ChapterRepository(db);
    this.#arcs = new ArcRepository(db);
    this.#loreRoot = loreRoot;
    this.#campaign = new CampaignSession(db, narrator, loreRoot);
  }

  /**
   * A complete turn, from the player's action to the last line.
   *
   * `onText` receives every piece as soon as the narrator produces it. Callers
   * who do not pass it still get the final text in `result.text`: streaming is an
   * extra, not an obligation.
   */
  async play(
    input: TurnInput,
    onText?: (delta: string) => void,
    timeoutMs = TURN_TIMEOUT_MS,
  ): Promise<TurnResult> {
    let text = "";
    let usage: TokenUsage = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
    const debug: TurnDebug = {
      context: {
        model: "",
        contextLimit: 0,
        tokensUsed: 0,
        ratio: 0,
        chapterThreshold: 0,
        canonBudgetTokens: 0,
        chapterNumber: 0,
      },
      canon: { entries: 0, tokens: 0, tiers: [], overBudget: false, truncated: false, dropped: 0 },
      stateCardTokens: 0,
      chapter: null,
      arc: null,
      names: [],
    };

    const sessionId = await this.#run(
      input,
      timeoutMs,
      (event) => {
        if (event.kind === "text") {
          text += event.delta;
          onText?.(event.delta);
        }
        if (event.kind === "done") usage = event.usage ?? usage;
      },
      debug,
    );

    return { sessionId, usage, text, debug };
  }

  /**
   * Walks the turn and returns the session it happened on. The session can change
   * halfway, when a chapter is closed: that is why it is returned and not only
   * kept local.
   */
  async #run(
    input: TurnInput,
    timeoutMs: number,
    onEvent: (event: TurnEvent) => void,
    debug: TurnDebug,
  ): Promise<string> {
    const world = this.#campaign.world(input.worldId);
    const contextLimit = await contextLimitFor(this.#narrator, world.model, world.contextLimit);
    let sessionId = await this.#campaign.ensure(world);

    // --- 1. close the overdue chapters, before writing -----------------------
    const state = await this.#contextState(world, sessionId, contextLimit);
    debug.context = state;
    if (shouldCloseChapter(state)) {
      const closed = await this.#closeChapter(world, sessionId);
      if (closed === null) {
        // The chapter could not be closed. Play goes on, but the session could be
        // full, and the caller has to be told.
        debug.chapter = { closed: false, n: 0, recovery: "none", tokens: 0 };
      } else {
        sessionId = closed.sessionId;
        debug.chapter = {
          closed: true,
          n: closed.n,
          recovery: closed.recovery,
          tokens: closed.tokens,
        };
        this.#campaign.rememberSession(world.id, sessionId);
        debug.context = await this.#contextState(world, sessionId, contextLimit);
      }
    }

    // --- 2. canon and state, without generating an answer -------------------
    const activeEras = this.#activeEras(world.id, input.locale);
    await this.#injectContext(world, sessionId, input, activeEras, debug);

    // --- 3. the player's action ---------------------------------------------
    //
    // The stream is opened **before** the prompt, not after. It has to be opened
    // first for a reason that is not about style: if it were opened afterwards, the
    // narrator may already be done and the `session.idle` that closes the turn has
    // passed with nobody listening. The turn would wait for an event that will
    // never come and stay hanging until the deadline, with the answer already
    // written.
    const subscription = await this.#narrator.events();

    // The messages that are not the narrator's, that is the ones to discard: when
    // you subscribe to an opencode event stream it also replays the state of what
    // is already there, so without this filter the player's prompt text and the
    // canon block would appear at the top of the answer.
    //
    // The filter is on the **message ids**, not on the text, because the player's
    // prompt has no marks that distinguish it. And they are read **after** the
    // prompt, not before: the prompt is itself a user message and it comes from
    // the same call that sends it. Reading them before, what is missing is exactly
    // the prompt, and it is the only thing that would end up at the top of the
    // answer.
    let failure: string | null = null;
    try {
      await this.#narrator.prompt(sessionId, {
        agent: GM_AGENT,
        modelRef: world.model,
        // The narrator's text does not come back from here: it arrives through the
        // events, and waiting for it here would mean hanging until the deadline.
        delivery: "fire-and-forget",
        text: mark(input.text, input.silent === true),
      });

      const daScartare = await this.#playerMessageIds(sessionId);

      failure = await this.#readTurn(
        subscription,
        sessionId,
        daScartare,
        world,
        contextLimit,
        timeoutMs,
        onEvent,
        debug,
      );
    } finally {
      // The stream has to be closed in any case, even when everything went well:
      // without this the connection stays open until opencode closes it, and every
      // turn leaves a hanging stream.
      subscription.close();
    }

    // A timed out or interrupted turn leaves opencode working. It has to be
    // aborted, otherwise the campaign stays busy and the next turn gets stuck.
    if (failure !== null) {
      await this.#narrator.abort(sessionId).catch(() => false);
      // The session the turn ended badly on is not reused: the next turn opens a
      // new one. See `markSessionFailed` for the why.
      this.#campaign.markSessionFailed(world.id, sessionId);
      throw new TurnFailed(failure);
    }

    debug.names = this.#detectNames(world.id, input);
    return sessionId;
  }

  /**
   * The ids of the messages that are not the narrator's.
   *
   * It has to be called **after** the prompt and not before: the player's prompt
   * is a user message like the others and comes from the same call that sends it.
   * Reading the ids before the prompt, what is missing is exactly the prompt, and
   * it is the only one that would arrive at the top of the narrator's answer.
   *
   * If they cannot be read an empty set is returned: everything is let through,
   * which is the behaviour from before. Better to show something extra than to
   * hide the narrator's answer.
   */
  async #playerMessageIds(sessionId: string): Promise<Set<string>> {
    try {
      const ids = new Set<string>();
      for (const message of await this.#narrator.messages(sessionId)) {
        if (message.role !== "user") continue;
        // A message without an id is not a message: putting it in the set would
        // mean discarding any part that has an empty id.
        if (message.id !== "") ids.add(message.id);
      }
      return ids;
    } catch {
      return new Set<string>();
    }
  }

  /**
   * Reads the turn's events until it ends, and returns the failure reason, or
   * `null` if it went well.
   *
   * The deadline is in here for a precise reason: it is the only place where time
   * can be counted **from the start of the work**, that is also everything that
   * happened before and that no tighter timeout would cover. It is not a
   * `setTimeout` that closes the turn from outside: it waits together with
   * `readTurn`, and when it expires it closes the stream and aborts the session,
   * so the waiting cannot go on.
   */
  async #readTurn(
    subscription: EventSubscription,
    sessionId: string,
    daScartare: Set<string>,
    world: World,
    contextLimit: number,
    timeoutMs: number,
    onEvent: (event: TurnEvent) => void,
    debug: TurnDebug,
  ): Promise<string | null> {
    const deadline = this.#clock() + timeoutMs;
    let usage: TokenUsage | null = null;

    for await (const evento of subscription.events) {
      if (this.#clock() >= deadline) break;

      const parsed = parseTurnEvent(evento, sessionId, daScartare);
      if (parsed === null) continue;

      if (parsed.kind === "text" || parsed.kind === "reasoning") {
        onEvent(parsed);
        continue;
      }
      if (parsed.kind === "usage") {
        usage = parsed.usage;
        continue;
      }
      if (parsed.kind === "error") {
        onEvent(parsed);
        return parsed.message;
      }
      if (parsed.kind === "done") {
        onEvent({ kind: "done", usage: usage });
        debug.context = await this.#contextState(world, sessionId, contextLimit);
        return null;
      }
    }

    return `The narrator did not finish the turn within ${Math.round(timeoutMs / 1000)} seconds.`;
  }

  #activeEras(worldId: string, locale: string): Era[] {
    const eras = this.#worlds.listEras(worldId);
    if (eras.length > 0) return eras;
    // A world with no declared eras has a single era, the current one.
    return [{ key: "current", label: locale, summary: "" }];
  }

  async #contextState(
    world: World,
    sessionId: string,
    contextLimit: number,
  ): Promise<ContextState> {
    const messages = await this.#narrator.messages(sessionId);
    return snapshot({
      world,
      contextLimit,
      usage: currentContextUsage(messages),
      chapterNumber: this.#chapters.latest(world.id)?.n ?? 0,
    });
  }

  /**
   * Canon and state generate no answer (`noReply`): they cost zero output tokens
   * and are there to orient the narrator on the turn.
   */
  async #injectContext(
    world: World,
    sessionId: string,
    input: TurnInput,
    activeEras: Era[],
    debug: TurnDebug,
  ): Promise<void> {
    const activeEras_ = activeEras;
    const base = this.#canon.list({ worldId: world.id, activeEras: [], includeDisputed: false });
    const usable = base.filter(
      (entry) => entry.era === "any" || activeEras_.some((era) => era.key === entry.era),
    );

    const search = this.#canon.search({
      worldId: world.id,
      activeEras: activeEras_.map((era) => era.key),
      includeDisputed: false,
      text: input.text,
      limit: 8,
    });

    const present =
      input.locationId === null ? [] : this.#cast.charactersAt(world.id, input.locationId);

    const slice = buildCanonSlice({
      activeEras: activeEras_,
      entries: [...usable, ...search],
      playerText: input.text,
      budgetTokens: debug.context.canonBudgetTokens,
      presentCharacterNames: present.map((character) => character.name),
      locationChain: [],
    });

    const card = buildStateCard({
      world,
      currentLocation:
        input.locationId === null ? null : this.#cast.getLocation(world.id, input.locationId),
      locationAncestry:
        input.locationId === null ? [] : this.#cast.locationAncestry(world.id, input.locationId),
      presentCharacters: present,
      relationships: present.flatMap((character) =>
        this.#cast.relationshipsOf(world.id, character.id),
      ),
      charactersById: new Map(),
      currentChapter: this.#chapters.latest(world.id),
      activeEras: activeEras_.map((era) => era.key),
    });

    debug.canon = {
      entries: slice.entries.length,
      tokens: slice.tokens,
      tiers: summarizeSlice(slice),
      overBudget: slice.overBudget,
      truncated: slice.truncated,
      dropped: slice.droppedCount,
    };
    debug.stateCardTokens = card.tokens;

    const canonText = renderCanonSlice(slice);

    // Reference from the library, searched by the engine. It goes into the same
    // block as the canon and for the same reason: if it depended on the narrator
    // deciding to search, it would never search, and the turn would run on memory
    // instead of on sources.
    const libraryText = await this.#libraryFor(world, input.text, debug);

    // The language has to be **declared**, not deduced, and it goes at the end of
    // the block for two reasons. The first is that the narrator used to deduce it
    // from the player's text: on its own that is not enough, because the injected
    // prompt and the library are in English while the player writes in another
    // language, and what landed on it was a mix of the two. The second is that
    // `isContext` recognises the
    // context block from its head: with this at the end, the history keeps
    // recognising it as context and not as a line of the player's.
    const blocks = [canonText, card.text, libraryText, languageBlock(input.locale)].filter(
      (block) => block !== "",
    );
    const body = blocks.join("\n\n");
    if (body === "") return;

    await this.#narrator.prompt(sessionId, {
      agent: GM_AGENT,
      delivery: "no-reply",
      text: body,
    });
  }

  /**
   * Library entries quoted by the player, to inject into the context.
   *
   * It fails silently: an unreadable library or an unbuilt index must not stop
   * the turn. The narrator will answer without references, which is the behaviour
   * from before, and not with an error the player can do nothing about.
   */
  async #libraryFor(world: World, playerText: string, debug: TurnDebug): Promise<string> {
    try {
      if (world.libraries.length === 0) return "";
      const resolved = await resolveLibraries(this.#loreRoot, world.libraries);
      const hits = await findInLibrary(resolved, playerText);
      debug.library = { hits: hits.map((hit) => hit.subject) };
      return renderLibraryHits(hits);
    } catch {
      return "";
    }
  }

  async #closeChapter(
    world: World,
    sessionId: string,
  ): Promise<{ sessionId: string; n: number; recovery: string; tokens: number } | null> {
    const bible = this.#worlds.getBible(world.id);
    const chapterNumber = this.#chapters.nextNumber(world.id);
    const arc = this.#campaign.currentArc(world.id, chapterNumber);
    const canonSubjects = this.#canon
      .list({
        worldId: world.id,
        activeEras: [],
        includeDisputed: false,
        kinds: ["character", "location", "faction"],
      })
      .map((entry) => entry.subject);

    const usage = currentContextUsage(await this.#narrator.messages(sessionId));

    // The closed arcs go in as compressed memory. Their chapters are not rewritten:
    // they are already inside the spine, and repeating them would cost tokens on
    // every chapter forever.
    const memories = this.#arcs.list(world.id).map((arc) => ({
      arc,
      chapters: this.#arcs.chaptersIn(arc.id),
    }));
    const arcMemory = renderArcMemory(memories, world.activeLocale);
    const summarisedBy = memories
      .filter((memory) => memory.arc.status === "closed")
      .reduce((sum, memory) => Math.max(sum, memory.arc.lastChapter), 0);

    const closed = await closeChapter({
      narrator: this.#narrator,
      world,
      worldDir: world.opencodeDir,
      sessionId,
      locale: world.activeLocale,
      chapterNumber,
      arcId: arc.id,
      premise: bible.premise,
      rules: bible.rules,
      canonSubjects,
      recentTurns: 24,
      chapters: this.#chapterSummaries(world.id).filter((row) => row.n > summarisedBy),
      arcMemory,
      tokenStart: 0,
      tokenEnd: contextFootprint(usage),
    });

    this.#chapters.add({
      worldId: world.id,
      locale: world.activeLocale,
      title: closed.title,
      summary: closed.summary,
      path: closed.path,
      tokenStart: 0,
      tokenEnd: contextFootprint(usage),
      canonRefs: closed.canonRefs,
      arcId: arc.id,
    });
    this.#arcs.attachChapter(arc.id, chapterNumber);

    // The arc closes at the tenth chapter: from there the memory of its chapters
    // goes in as the spine.
    if (this.#arcs.needsClosing(arc.id)) {
      await this.#closeArc(world, arc.id);
    }

    return {
      sessionId: closed.sessionId,
      n: closed.n,
      recovery: closed.recovery,
      tokens: contextFootprint(usage),
    };
  }

  async #closeArc(world: World, arcId: string): Promise<void> {
    const arc = this.#arcs.get(arcId);
    if (!arc || arc.status === "closed") return;
    const chapters = this.#arcs.chaptersIn(arcId);
    if (chapters.length === 0) return;

    const spine = await writeArcSpine({
      narrator: this.#narrator,
      modelRef: world.model,
      arcNumber: arc.n,
      arcTitle: arc.title,
      chapters: chapters.map((chapter) => ({
        n: chapter.n,
        title: chapter.title,
        summary: chapter.summary,
      })),
      locale: world.activeLocale,
    });
    if (spine.ok) this.#arcs.close(arcId, spine);
  }

  #chapterSummaries(worldId: string): ChapterSummary[] {
    return this.#chapters.list(worldId).map((chapter) => ({
      n: chapter.n,
      title: chapter.title,
      summary: chapter.summary,
    }));
  }

  #detectNames(worldId: string, input: TurnInput): { surface: string; known: boolean }[] {
    const lexicon = buildLexicon({
      canonSubjects: this.#canon
        .list({ worldId, activeEras: [], includeDisputed: false })
        .map((entry) => ({ id: entry.id, subject: entry.subject, aliases: entry.aliases })),
      characters: this.#cast.listCharacters(worldId).map((character) => ({
        id: character.id,
        name: character.name,
      })),
      locations: this.#cast.listLocations(worldId).map((location) => ({
        id: location.id,
        name: location.name,
        aliases: location.aliases,
      })),
    });
    return detectNames(input.text, lexicon).map((name) => ({
      surface: name.surface,
      known: name.known,
    }));
  }

  /** Exposes the data for the context endpoint, without duplicating logic. */
  async inspect(worldId: string): Promise<{
    state: ContextState;
    chapterNumber: number;
    arcs: number;
  }> {
    const world = this.#campaign.world(worldId);
    const sessionId = await this.#campaign.ensure(world);
    const contextLimit = await contextLimitFor(this.#narrator, world.model, world.contextLimit);
    const state = await this.#contextState(world, sessionId, contextLimit);
    return {
      state,
      chapterNumber: this.#chapters.latest(worldId)?.n ?? 0,
      arcs: this.#arcs.list(worldId).length,
    };
  }

  /** Chapter threshold, to show it to the user without waiting for the turn. */
  chapterThresholdFor(contextLimit: number, world: World): number {
    return computeChapterThreshold(contextLimit, world.chapterThresholdRatio);
  }
}

/**
 * The turn's language, stated to the narrator in its own words.
 *
 * It has to be repeated on every turn and the agent's one is not enough, for two
 * reasons. The first is recency: the instruction closest to the prompt is the one
 * the model follows, and the canon and the library sit in between, with a bag of
 * English inside them. The second is that the two languages are not necessarily
 * the same: the agent's file carries the language of the **world**, declared when
 * the world was created, and the turn carries the one the interface asked for
 * now. When they differ the turn wins, and that is why the line does not say "as
 * before".
 *
 * The block is not written in the narrator's language, and that is fine: it does
 * not need to be, it needs to name that language.
 */
export function languageBlock(locale: string): string {
  const language = localeName(locale);
  return [
    "## LANGUAGE",
    "",
    `This turn is written in ${language}: use the spelling and the grammar of`,
    `whoever writes in ${language}, not a mix with those of another language.`,
    "Proper names from the canon are never translated.",
    "The reference material you read is in English: use its facts and",
    `write in ${language}, not its words.`,
  ].join("\n");
}

/**
 * Translates an opencode event into a turn event, discarding what does not
 * concern us.
 *
 * opencode's events are **global**, not per session: without the session filter
 * two campaigns open at the same time would write into each other's answer.
 *
 * There is a second filter, and it is the one that makes the chat readable. When
 * you subscribe to the stream, opencode also replays the state of the messages
 * that are already there: so the first piece that arrives is the player's prompt
 * text and the canon injected on the previous turn, that is hundreds of
 * characters of world rules at the top of the answer. `daScartare` are the ids of
 * those messages.
 *
 * The filter is on the **ids**, not on the text: the player's prompt is arbitrary
 * text and has no mark that distinguishes it from an answer. A text-based filter
 * would let the prompt through, and the result would be an answer that repeats
 * the player's line at the top.
 */
export function parseTurnEvent(
  evento: unknown,
  sessionId: string,
  daScartare: ReadonlySet<string>,
): TurnEvent | null {
  if (!isRecord(evento)) return null;
  const type = evento["type"];
  const properties = evento["properties"];
  if (!isRecord(properties)) return null;

  if (type === "message.part.updated") {
    const part = properties["part"];
    if (!isRecord(part)) return null;
    if (part["sessionID"] !== sessionId) return null;

    const messageId = part["messageID"];
    if (typeof messageId === "string" && daScartare.has(messageId)) return null;

    const delta = properties["delta"] ?? part["text"];
    if (typeof delta !== "string" || delta === "") return null;
    if (part["type"] === "reasoning") return { kind: "reasoning", delta };
    if (part["type"] !== "text") return null;
    const partId = typeof part["id"] === "string" ? part["id"] : "";
    return { kind: "text", delta, partId };
  }

  if (type === "message.updated") {
    const info = properties["info"];
    if (!isRecord(info)) return null;
    if (info["sessionID"] !== sessionId) return null;
    if (info["role"] !== "assistant") return null;
    return { kind: "usage", usage: readEventUsage(info) };
  }

  if (type === "session.error") {
    const target = properties["sessionID"];
    if (typeof target === "string" && target !== sessionId) return null;
    return { kind: "error", message: readEventError(properties["error"]) };
  }

  if (type === "session.idle") {
    if (properties["sessionID"] !== sessionId) return null;
    return { kind: "done", usage: null };
  }

  return null;
}

function readEventUsage(info: Record<string, unknown>): TokenUsage {
  const tokens = info["tokens"];
  if (!isRecord(tokens)) return emptyTokenUsage();
  const cache = isRecord(tokens["cache"]) ? tokens["cache"] : {};
  return {
    input: num(tokens["input"]),
    output: num(tokens["output"]),
    reasoning: num(tokens["reasoning"]),
    cache: { read: num(cache["read"]), write: num(cache["write"]) },
  };
}

function readEventError(error: unknown): string {
  if (typeof error === "string") return error;
  if (!isRecord(error)) return "Unknown narrator error";
  const data = error["data"];
  if (isRecord(data) && typeof data["message"] === "string") return data["message"];
  if (typeof error["name"] === "string") return error["name"];
  return "Unknown narrator error";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
