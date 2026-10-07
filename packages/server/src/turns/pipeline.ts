import type { ContextState, Era, TokenUsage, World } from "@rpwb/shared";
import {
  BIBLE_SECTIONS,
  computeChapterThreshold,
  contextFootprint,
  emptyTokenUsage,
  estimateTextTokens,
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
import { log } from "../logging.js";
import { findInLibrary, renderLibraryHits } from "../lore/lookup.js";
import { resolveLibraries } from "../lore/registry.js";
import { isRecord } from "../opencode/bridge.js";
import { contextLimitFor, shouldCloseChapter, snapshot } from "../opencode/context.js";
import { mark } from "../opencode/markers.js";
import type { EventSubscription, Narrator } from "../opencode/narrator.js";
import { currentContextUsage } from "../opencode/session.js";
import { CampaignSession } from "./session.js";

/*
 * A turn, in order:
 *
 * 1. overdue chapters are closed
 * 2. canon and state are injected, generating no answer
 * 3. the player's action is sent and the text streams
 *
 * 1 comes first: a full context is written **before** the turn that would overflow it.
 */

/**
 * The narrator agent's name.
 *
 * Passed explicitly on every prompt. Without it opencode uses its default coding agent,
 * which tries to do its job instead of narrating and the turn never ends.
 */
const GM_AGENT = "gm";

/**
 * How long a turn can last before the work is given up on.
 *
 * The **outer** limit, covering the whole `#run`: chapters, context injection and
 * what comes after the stream. The inner one in `#readTurn` covers only the reading of
 * the events, and waiting upstream it covers nothing — that is the hole where a turn
 * stayed `running` forever.
 *
 * The pipeline's timeout plus a margin: it has to be greater, or the outer deadline
 * cuts a turn the pipeline was still closing, and below `RUNNING_STALE_MS`, or the row
 * ages into `stale` instead of becoming `failed` by decision.
 */
export const TURN_TIMEOUT_MS = 240_000;

/** An opencode event, reduced to what the turn uses. */
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
   * A narrator request, not a player line: it does not appear in the chat.
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
  /** What the provider reported, or null if it reported nothing. */
  usage: TokenUsage | null;
  text: string;
  debug: TurnDebug;
  /**
   * What the turn cost in the provider's currency.
   *
   * `null` for a model with no price and `0` for a free one. The distinction travels to
   * the summary: a priced-and-free turn is counted in the money total and an unpriced
   * one is counted beside it.
   */
  cost: number | null;
}

/**
 * One slice of the narrator's context, and what it weighs.
 *
 * The answer to "why did the narrator forget that": a full meter says how much was
 * used, not what to write less.
 *
 * An estimate, never a measurement: the same four-characters-per-token rule as the
 * meter, so the parts sum to the whole on screen.
 */
export interface ContextSlice {
  /** Machine name, so the interface can label it without parsing a sentence. */
  key: string;
  tokens: number;
  /** What this slice is, in words. Shown as the row's subtitle. */
  detail: string;
}

/**
 * The whole context, broken down.
 *
 * `known` is the sum of the slices and `state.tokensUsed` is what the model reports,
 * and they are rarely equal: the provider counts its own formatting and the session
 * carries the injected context and its markers. Showing both is the point — the gap is
 * where the unaccounted text lives.
 */
export interface ContextBreakdown {
  slices: ContextSlice[];
  /** Sum of the slices. */
  known: number;
  /** What the model says it has used, which is `state.tokensUsed`. */
  reported: number;
}

/**
 * A turn that ended badly, with the reason why.
 *
 * An error and not an empty result: a silent success is indistinguishable from a
 * narrator that chose to say nothing, and `text: ""` carries no reason into the row.
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
   * The narrator is a contract, not a client: the pipeline does not know what is
   * behind it.
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
   * `onText` receives each piece as it is produced; callers without it still get the
   * whole text in `result.text`.
   */
  async play(
    input: TurnInput,
    onText?: (delta: string) => void,
    timeoutMs = TURN_TIMEOUT_MS,
  ): Promise<TurnResult> {
    let text = "";
    // Read once and used twice: `world.model` is re-read from the database on every turn, so
    // a model changed from another tab mid-turn would otherwise be priced with the new
    // rates against the old tokens.
    const modelRef = this.#campaign.world(input.worldId).model;
    // Null until the provider reports, and not an empty usage: a turn whose provider said
    // nothing has not cost nothing.
    let usage: TokenUsage | null = null;
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
        if (event.kind === "done") usage = event.usage;
      },
      debug,
    );

    return { sessionId, usage, text, debug, cost: await this.#costOf(usage, modelRef) };
  }

  /**
   * What a turn's tokens cost, from the model's own price list.
   *
   * `null` when the usage is unknown or the model has no price, and the two are not the
   * same: an unpriced turn is counted in the tokens total and left out of the money
   * total. Guessing a price puts a plausible figure on a bill.
   *
   * Read per turn and not cached on the pipeline: the model can change between two
   * turns, and a cached price would be the old model's applied to the new one's tokens.
   */
  async #costOf(usage: TokenUsage | null, modelRef: string): Promise<number | null> {
    if (usage === null) return null;
    const catalog = await this.#narrator.models();
    const model = catalog.all.find((entry) => entry.ref === modelRef);
    if (model === undefined) return null;
    // Divided by a million: providers publish a price per million tokens, and the
    // figure is stored in the currency unit rather than in micro-units so that a total
    // over a thousand turns stays readable.
    //
    // A free model gives zero, not null: the provider published a price and it was zero,
    // which is a fact about the model rather than a gap in what we know.
    return (
      (usage.input * model.inputCost +
        usage.output * model.outputCost +
        usage.cache.read * model.cacheReadCost +
        usage.cache.write * model.cacheWriteCost) /
      1_000_000
    );
  }

  /**
   * Walks the turn and returns the session it happened on, which can change halfway when
   * a chapter is closed.
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
        // The chapter could not be closed: play goes on and the caller is told, because the
        // session may be full.
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
    // The stream opens **before** the prompt: opened afterwards, the narrator may already
    // be done and `session.idle` would have passed with nobody listening, leaving the turn
    // waiting for an event that never comes.
    const subscription = await this.#narrator.events();

    // Subscribing replays the messages already in the session, so without this filter the
    // player's prompt and the canon block open the answer. Read **after** the prompt,
    // which is itself a user message: read before, what is missing is exactly the prompt.
    let failure: string | null = null;
    let modelRef = world.model;
    try {
      await this.#narrator.prompt(sessionId, {
        agent: GM_AGENT,
        modelRef,
        // The text arrives through the events: waiting here would hang until the deadline.
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

      /*
       * The fallback, here and not in the route: only the pipeline knows the session, the
       * subscription and the text sent, and rebuilding those would be a second
       * implementation of the turn.
       *
       * Only a real failure is retried (`failure !== null`, set on an error event or a
       * timeout). A turn that produced nothing may be a narrator that chose silence, and
       * asking a second model to answer what the first declined is a different turn.
       */
      if (failure !== null) {
        const alternative = await this.#fallbackModel(modelRef);
        if (alternative !== null) {
          log.warn("turn.fallback", {
            worldId: world.id,
            from: modelRef,
            to: alternative,
            reason: failure,
          });
          modelRef = alternative;
          // A new session, because the one that failed is marked and the next turn
          // would not reuse it. The fallback starts from a clean context rather than
          // from whatever state the failed model left behind.
          sessionId = await this.#narrator.createSession(world.name);
          this.#campaign.rememberSession(world.id, sessionId);
          const retrySubscription = await this.#narrator.events();
          try {
            await this.#narrator.prompt(sessionId, {
              agent: GM_AGENT,
              modelRef,
              delivery: "fire-and-forget",
              text: mark(input.text, input.silent === true),
            });
            const retryDiscard = await this.#playerMessageIds(sessionId);
            failure = await this.#readTurn(
              retrySubscription,
              sessionId,
              retryDiscard,
              world,
              contextLimit,
              timeoutMs,
              onEvent,
              debug,
            );
          } finally {
            retrySubscription.close();
          }
        }
      }
    } finally {
      // Closed in every case: otherwise each turn leaves the connection open until opencode
      // closes it.
      subscription.close();
    }

    if (failure !== null) {
      // Abort, or the campaign stays busy and the next turn gets stuck, and do not reuse
      // the failed session. See `markSessionFailed`.
      await this.#narrator.abort(sessionId).catch(() => false);
      this.#campaign.markSessionFailed(world.id, sessionId);
      throw new TurnFailed(failure);
    }

    debug.names = this.#detectNames(world.id, input);
    return sessionId;
  }

  /**
   * A model to ask when the one the campaign chose did not answer.
   *
   * The widest free model that is not the failed one: the fallback continues a story the
   * first model could not finish, so too small a window fails for the same reason, and a
   * fallback that spends money the player did not agree to spend is a bill.
   *
   * `null` when there is no alternative, which is the common case on a single-provider
   * account. Not an error: the turn fails with the reason it already had.
   */
  async #fallbackModel(exclude: string): Promise<string | null> {
    const catalog = await this.#narrator.models();
    const candidates = catalog.free
      .filter((model) => model.ref !== exclude && model.admissibleByDefault)
      .sort((a, b) => b.contextLimit - a.contextLimit);
    return candidates[0]?.ref ?? null;
  }

  /**
   * The ids of the messages that are not the narrator's.
   *
   * Called **after** the prompt: the player's prompt is a user message like the others and
   * comes from the same call, so reading before it would filter out exactly the prompt.
   *
   * An empty set on failure lets everything through: better to show something extra than
   * to hide the answer.
   */
  async #playerMessageIds(sessionId: string): Promise<Set<string>> {
    try {
      const ids = new Set<string>();
      for (const message of await this.#narrator.messages(sessionId)) {
        if (message.role !== "user") continue;
        // An empty id would filter out every part carrying it.
        if (message.id !== "") ids.add(message.id);
      }
      return ids;
    } catch {
      return new Set<string>();
    }
  }

  /**
   * Reads the turn's events until it ends, returning the failure reason or `null`.
   *
   * The deadline is checked here because this is the only loop covering the whole wait:
   * when it expires the stream closes and the session aborts, so the waiting cannot go on.
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
   * Canon and state are injected with `noReply`: zero output tokens, there only to orient
   * the narrator.
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

    // Searched by the engine, in the same block as the canon: left to the narrator's
    // decision it would never search and the turn would run on memory.
    const libraryText = await this.#libraryFor(world, input.text, debug);

    // Declared, not deduced, and last: the injected text is English while the player writes
    // in another language, and `isContext` recognises the block from its head.
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
   * Fails silently: an unreadable library or an unbuilt index must not stop the turn.
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

    // Closed arcs go in as compressed memory: their chapters are already in the spine, and
    // rewriting them would cost tokens on every chapter forever.
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

    // The arc closes at the tenth chapter: from there its chapters go in as the spine.
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
    breakdown: ContextBreakdown;
  }> {
    const world = this.#campaign.world(worldId);
    const sessionId = await this.#campaign.ensure(world);
    const contextLimit = await contextLimitFor(this.#narrator, world.model, world.contextLimit);
    const state = await this.#contextState(world, sessionId, contextLimit);
    const breakdown = await this.#breakdown(world);
    // The provider's own count. Shown beside the breakdown because the parts never sum to
    // the whole: the provider counts its formatting and the session carries the injected
    // context and its markers.
    breakdown.reported = state.tokensUsed;

    return {
      state,
      chapterNumber: this.#chapters.latest(worldId)?.n ?? 0,
      arcs: this.#arcs.list(worldId).length,
      breakdown,
    };
  }

  /**
   * The context, piece by piece.
   *
   * Slices are counted where they are already built. The Bible is read at startup by the
   * narrator and the library is whatever it looked up on some past turn, so those say
   * they are uncounted rather than showing a guess as a measurement.
   */
  async #breakdown(world: World): Promise<ContextBreakdown> {
    const bible = this.#worlds.getBible(world.id);
    const bibleTokens = estimateTextTokens(
      BIBLE_SECTIONS.map((section) => bible[section] ?? "").join("\n\n"),
    );
    const activeEras = this.#worlds.listEras(world.id);
    const canon = this.#canon.list({
      worldId: world.id,
      activeEras: activeEras.map((era) => era.key),
      includeDisputed: false,
    });
    const canonTokens = canon.reduce((sum, entry) => sum + entry.tokens, 0);

    const slices: ContextSlice[] = [
      {
        key: "bible",
        tokens: bibleTokens,
        detail:
          bibleTokens === 0
            ? "empty"
            : `${BIBLE_SECTIONS.filter((s) => (bible[s] ?? "").trim() !== "").length} sections`,
      },
      {
        key: "canon",
        tokens: canonTokens,
        detail: `${canon.length} entries`,
      },
      {
        // Not measured: rebuilt from the cast and the location on every turn, so there is no
        // stored version to count.
        key: "stateCard",
        tokens: 0,
        detail: "rebuilt every turn",
      },
      {
        // Not measured: the library is not in the context by default, so its cost shows up in
        // the session rather than here.
        key: "library",
        tokens: 0,
        detail: world.libraries.length === 0 ? "none" : `${world.libraries.length} on demand`,
      },
    ];

    return {
      slices,
      known: slices.reduce((sum, slice) => sum + slice.tokens, 0),
      reported: 0,
    };
  }

  /** Chapter threshold, to show it to the user without waiting for the turn. */
  chapterThresholdFor(contextLimit: number, world: World): number {
    return computeChapterThreshold(contextLimit, world.chapterThresholdRatio);
  }
}

/**
 * The turn's language, stated on every turn and not only in the agent.
 *
 * Recency: the instruction closest to the prompt is the one followed, and the canon and
 * the library sit in between in English. The agent's language is the world's declared
 * one, so when they differ the turn wins — which is why the line does not say "as
 * before".
 *
 * The block need only name the language, not be written in it.
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
 * Translates an opencode event into a turn event, discarding the rest.
 *
 * opencode's events are **global**, so the session filter keeps two open campaigns from
 * writing into each other's answer.
 *
 * `daScartare` is the second filter and is what makes the chat readable: subscribing
 * replays the messages already there, so the first pieces arriving are the player's prompt
 * and the canon injected on the previous turn. Filtering on ids and not on text, because
 * a prompt has no mark distinguishing it from an answer.
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
