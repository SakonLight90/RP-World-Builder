import type { CanonEntry, Era } from "@rpwb/shared";
import { ERROR_CATALOG, type ErrorCode } from "@rpwb/shared";
import { type MessageKey, type MessageValues, translate, type UiLocale } from "../i18n/index";
import { API } from "./config";

/**
 * Local API calls.
 *
 * No cache and no `credentials`: the API runs on the same machine, has no
 * accounts, and there is nothing to authenticate. Adding tokens here would
 * invent a problem this project doesn't have.
 */
/**
 * A call that never starts, or dies halfway, arrives from the browser as a textless
 * error: "NetworkError" or "Failed to fetch". It says nothing useful, and whoever
 * sees it can't tell whether the server is running, the address is wrong, or the
 * connection dropped.
 *
 * Here we name the address and say what to try. The message is the
 * difference between a problem and a blank page.
 *
 * The sentence is not written here: it leaves as the key `common.error.networkUnreachable`
 * plus the two values it needs, because the word order belongs to the translator and this
 * function has no language to know. `error.message` still holds the English rendering, so
 * anything reading it directly is never left with a bare "Failed to fetch".
 */
async function fetchOrExplain(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    const values: MessageValues = { url, cause };
    throw new ApiError(
      translate("en", "common.error.networkUnreachable", values),
      0,
      undefined,
      "common.error.networkUnreachable",
      values,
    );
  }
}

/** A plain object, which is all a params bag ever is. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  /**
   * `content-type: application/json` only when there is a body to describe.
   *
   * It used to be set unconditionally, and Fastify refuses that combination with
   * `FST_ERR_CTP_EMPTY_JSON_BODY`: a `DELETE` carries no body, so every delete
   * from the interface came back 400 before reaching its route. The response had
   * no code and no problem in it, so the page could only say "request failed with
   * status 400", which is how "deleting a world does not work" survived every
   * other fix. The header describes the body; with no body there is nothing to
   * describe.
   */
  const hasBody = init?.body !== undefined && init.body !== null;
  const response = await fetchOrExplain(`${API}${path}`, {
    ...init,
    headers: hasBody ? { "content-type": "application/json", ...init?.headers } : init?.headers,
    cache: "no-store",
  });

  const text = await response.text();
  const body: unknown = text === "" ? null : safeParse(text);

  if (!response.ok) {
    // A code means the interface has a sentence for it in the reader's language,
    // so it is the first thing to look for. The English `problem` rides along
    // because it is built from the same shared table and because something that
    // only reads the old field still gets a sentence.
    if (typeof body === "object" && body !== null) {
      const shape = body as { code?: unknown; problem?: unknown; params?: unknown };
      const code = typeof shape.code === "string" ? shape.code : "";
      const problem = typeof shape.problem === "string" ? shape.problem : "";
      if (code in ERROR_CATALOG) {
        const params = isRecord(shape.params) ? (shape.params as MessageValues) : undefined;
        throw new ApiError(problem, response.status, code as ErrorCode, undefined, params);
      }
      // A problem with no code: a server that has not been updated yet, or a
      // route that answers in prose. It still beats a blank page.
      if (problem !== "") {
        throw new ApiError(problem, response.status);
      }
    }
    // Nothing usable in the body: the status is all there is to report, and the
    // sentence naming it is written here, so it travels as a key.
    const values: MessageValues = { status: response.status };
    throw new ApiError(
      translate("en", "common.error.httpStatus", values),
      response.status,
      undefined,
      "common.error.httpStatus",
      values,
    );
  }

  return body as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { problem: text };
  }
}

/**
 * An API failure, and where its sentence comes from.
 *
 * `messageKey` and `values` are what the client generated: a key in the common
 * catalog plus the placeholders it needs. They are optional because the other
 * kind of failure has no key at all — the server wrote the sentence — and
 * `problem` is what `super()` receives so `error.message` keeps working for
 * anything reading it directly.
 */
/**
 * An error the API reported.
 *
 * `code` is the contract: the server sends one code from `ERROR_CATALOG` and
 * the interface has a sentence for it in every language. `message` is the
 * English fallback the server built from the same table, kept because a script
 * or an older client reads it and because it is the last resort when a
 * response arrives with a code this build does not know.
 *
 * `messageKey` is for the two errors this file invents itself — the network is
 * unreachable, the status has no body — which the server never sees and
 * therefore has no code for.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: ErrorCode;
  readonly messageKey?: MessageKey;
  readonly values?: MessageValues;
  constructor(
    problem: string,
    status: number,
    code?: ErrorCode,
    messageKey?: MessageKey,
    values?: MessageValues,
  ) {
    super(problem);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.messageKey = messageKey;
    this.values = values;
  }
}

/**
 * Tells the user what to do, not just what went wrong.
 *
 * It lives here and not in every page because the copy had spread to twenty spots,
 * each reporting only `error.message`: a 503 said "opencode unavailable" without
 * saying the campaign was intact and starting it was enough, which is the difference
 * between a problem and a campaign that looks lost.
 *
 * A sentence reaches the screen through one of four layers, checked in this order:
 *
 * 1. **A code from the server.** Translated through the catalog, because a code
 *    is the one thing about an error that survives a rewrite of its wording.
 * 2. **A status whose sentence says what to do.** 503 means the narrator is not
 *    listening and 404 means the campaign is gone. Both earn their own sentence,
 *    and both come *before* the generic one below: "opencode is not running,
 *    the campaign is intact" is actionable and "request failed with status 503"
 *    is not. This is the layer that catches an answer from something that is not
 *    this API, since such an answer carries no code.
 * 3. **A key this client generated.** `fetchOrExplain` and the `request`
 *    fallback carry no sentence of their own: they carry a key and its values,
 *    and the language is applied here, the one place that knows it. This is why
 *    the language is a parameter and not a read from context: `explainError` is
 *    a plain function with no provider above it, so the caller — a component that
 *    does have the interface language — passes it in.
 * 4. **The server's English sentence, passed through.** Re-inventing it here
 *    would trade a real explanation for a generic one.
 */
export function explainError(error: unknown, locale: UiLocale): string {
  if (error instanceof ApiError) {
    if (error.code) {
      return translate(locale, `error.${error.code}` as MessageKey, error.values);
    }
    if (error.status === 503) {
      return translate(locale, "common.error.narratorOffline");
    }
    if (error.status === 404) {
      return translate(locale, "common.error.campaignGone");
    }
    if (error.messageKey) {
      return translate(locale, error.messageKey, error.values);
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * A read that may never arrive, without dragging half an error along.
 *
 * For accessory reads — current chapter, context percentage,
 * model list — that must not block the screen. Unlike
 * `.catch(() => undefined)` it **does not silence**: either the read succeeds, or
 * an error carrying its reason propagates.
 *
 * Use only for the non-essential. For the page's main content
 * use `loadError` with a banner: "nothing to show" and "load failed" can't
 * look like the same thing, because the first is an empty campaign and
 * the second is a problem.
 */
export async function readIfNonEssential<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

const json = (value: unknown): RequestInit => ({ body: JSON.stringify(value) });

export interface Toolchain {
  next: string;
  compiler: "native" | "wasm";
  probe: { outcome: "ok" | "failed" | "missing"; binary?: string; problem?: string };
  typescript: string;
  fix: string | null;
  consequence: string;
}

export interface SetupStatus {
  setupCompleted: boolean;
  uiLocale: string;
  dataDir: string;
  toolchain: Toolchain;
}

/** The saved settings from the config file, as the server re-reads them. */
export interface AppSettings {
  uiLocale: string;
  dataDir: string;
  port: number;
  host: string;
  setupCompleted: boolean;
  opencodeBaseUrl: string | null;
  opencodePort: number;
  preferredModel: string | null;
  preferredSmallModel: string | null;
}

/**
 * The Continue and Retry requests come from `@rpwb/shared`, not from here.
 *
 * They used to be written twice, once in the server and once in the interface,
 * with a comment warning that the two copies had to stay identical. They did not
 * stay identical: the server had already been translated and the interface copy
 * was still Italian, so the narrator was being asked to continue in one language
 * and being marked as silent in another. One definition removes the failure mode
 * instead of documenting it.
 */

export interface Health {
  healthy: boolean;
  version: string | null;
  baseUrl: string;
  binary: { found: boolean; version: string | null; path: string | null };
  providers: string[];
  freeModels: string[];
  narratorModels: string[];
  restrictedModels: string[];
  defaultModel: string | null;
  problem: string | null;
}

export interface Model {
  ref: string;
  name: string;
  contextLimit: number;
  free: boolean;
  zeroRetention: boolean;
  trainsOnPrompts: boolean;
  privacyNote: string;
  reasoning: boolean;
  admissibleByDefault: boolean;
}

/**
 * Who plays the player: not the protagonist "on stage right now", but the
 * person holding the turns. It enters the narrator's context every turn, and
 * that's why it has three fields instead of a biography: the narrator must be able
 * to cite the name and role without hunting for them inside a sentence.
 *
 * Absent means a world without a protagonist, on purpose: an empty or
 * whitespace-only name is not a character, it's a half-filled field.
 */
export interface PlayerCharacter {
  name: string;
  role: string;
  description: string;
}

/**
 * What `PATCH /api/worlds/:id` accepts.
 *
 * Fewer fields than the world has: the ones the UI has a
 * reason to change. `player` with three empty fields is the declared way
 * to remove it, because the server re-reads it and discards it on its own.
 */
export interface WorldPatch {
  name?: string;
  description?: string;
  model?: string;
  smallModel?: string;
  reasoningEffort?: string;
  activeLocale?: string;
  contextLimit?: number | null;
  chapterThresholdRatio?: number;
  canonBudgetRatio?: number;
  player?: PlayerCharacter;
}

export interface World {
  id: string;
  name: string;
  slug: string;
  baseLocale: string;
  activeLocale: string;
  description: string;
  model: string;
  smallModel: string;
  reasoningEffort: string;
  contextLimit: number | null;
  chapterThresholdRatio: number;
  canonBudgetRatio: number;
  isTemplate: boolean;
  templateAuthor: string | null;
  player?: PlayerCharacter;
}

export interface Chapter {
  id: string;
  n: number;
  title: string;
  summary: string;
  path: string;
  arcId: string | null;
}

export interface Arc {
  id: string;
  n: number;
  title: string;
  logline: string;
  spine: string;
  status: "open" | "closed";
  firstChapter: number;
  lastChapter: number;
  chapters?: { n: number; title: string; summary: string }[];
  remaining?: number;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  personality: string;
  status: string;
  locationId: string | null;
  isPlayer: boolean;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  parentId: string | null;
}

export interface Relationship {
  fromCharacterId: string;
  toCharacterId: string;
  affinity: number;
  trust: number;
  note: string;
}

export interface TurnDebug {
  context: {
    tokensUsed: number;
    contextLimit: number;
    ratio: number;
    chapterThreshold: number;
    chapterNumber: number;
  };
  canon: { entries: number; tokens: number; tiers: string[]; overBudget: boolean; dropped: number };
  stateCardTokens: number;
  chapter: { closed: boolean; n: number; recovery: string } | null;
  arc: { n: number; title: string } | null;
  names: { surface: string; known: boolean }[];
}

/**
 * A turn's state, as seen by the reader.
 *
 * `stale` is not a row: it's a turn left `running` too long, meaning
 * the backend writing it is gone. It lives here because the reader
 * must tell "still writing" apart from "ended badly": confusing them is
 * the indicator that never turns off.
 */
export type TurnState = "running" | "completed" | "failed" | "stale";

/**
 * A turn, as stored in the database.
 *
 * `text` and `error` are `null` while the turn runs, not empty strings: a freshly
 * born turn hasn't written anything yet, which differs from having written nothing.
 */
export interface TurnRecord {
  id: string;
  worldId: string;
  prompt: string;
  text: string | null;
  error: string | null;
  state: TurnState;
  createdAt: string;
  finishedAt: string | null;
  locale: string;
}

export const api = {
  health: () => request<Health>("/api/health"),
  status: () => request<SetupStatus>("/api/setup/status"),
  settings: () => request<{ settings: AppSettings }>("/api/settings"),
  updateSettings: (body: {
    uiLocale?: string;
    preferredModel?: string | null;
    preferredSmallModel?: string | null;
    setupCompleted?: boolean;
  }) => request<{ settings: AppSettings }>("/api/settings", { method: "PUT", ...json(body) }),
  models: () =>
    request<{
      free: Model[];
      narrator: Model[];
      restricted: Model[];
      default: string | null;
      problem: string | null;
    }>("/api/models"),

  worlds: () =>
    request<{
      worlds: World[];
      templates: {
        id: string;
        name: string;
        slug: string;
        description: string;
        templateAuthor: string | null;
      }[];
    }>("/api/worlds"),
  world: (id: string) =>
    request<{
      world: World;
      bible: Record<string, string>;
      eras: Era[];
      arcs: Arc[];
      canonHealth: { total: number; disputed: number; retconned: number };
    }>(`/api/worlds/${id}`),
  createWorld: (body: {
    name: string;
    model: string;
    smallModel: string;
    reasoningEffort: string;
    baseLocale?: string;
    description?: string;
    fromTemplate?: string;
  }) => request<{ world: World }>("/api/worlds", { method: "POST", ...json(body) }),
  deleteWorld: (id: string) => request<{ ok: boolean }>(`/api/worlds/${id}`, { method: "DELETE" }),

  /**
   * The world as the world's properties: name, model, protagonist.
   *
   * Returns the whole world and not just an ok, because the caller must show
   * what was actually saved: trusting the request is
   * what leaves a box saying one thing and a server saying
   * another.
   */
  updateWorld: (id: string, body: WorldPatch) =>
    request<{ world: World }>(`/api/worlds/${id}`, { method: "PATCH", ...json(body) }),

  bible: (id: string, section: string, body: string) =>
    request<{ bible: Record<string, string> }>(`/api/worlds/${id}/bible`, {
      method: "PUT",
      ...json({ section, body }),
    }),

  /** Replaces the eras with the sent list: missing ones disappear. */
  updateEras: (id: string, eras: Era[]) =>
    request<{ eras: Era[] }>(`/api/worlds/${id}/eras`, { method: "PUT", ...json(eras) }),

  characters: (id: string) => request<{ characters: Character[] }>(`/api/worlds/${id}/characters`),
  locations: (id: string) => request<{ locations: Location[] }>(`/api/worlds/${id}/locations`),
  addLocation: (id: string, body: { name: string; description?: string; era?: string }) =>
    request<{ location: Location }>(`/api/worlds/${id}/locations`, {
      method: "POST",
      ...json(body),
    }),
  updateLocation: (id: string, locationId: string, body: Partial<Omit<Location, "id">>) =>
    request<{ location: Location }>(`/api/worlds/${id}/locations/${locationId}`, {
      method: "PATCH",
      ...json(body),
    }),
  deleteLocation: (id: string, locationId: string) =>
    request<{ ok: boolean }>(`/api/worlds/${id}/locations/${locationId}`, {
      method: "DELETE",
    }),
  relationships: (id: string) =>
    request<{ relationships: Relationship[] }>(`/api/worlds/${id}/relationships`),
  setRelationship: (
    id: string,
    body: {
      fromCharacterId: string;
      toCharacterId: string;
      affinity?: number;
      trust?: number;
      note?: string;
    },
  ) =>
    request<{ relationship: Relationship }>(`/api/worlds/${id}/relationships`, {
      method: "POST",
      ...json(body),
    }),
  deleteRelationship: (id: string, body: { fromCharacterId: string; toCharacterId: string }) =>
    request<{ ok: boolean }>(`/api/worlds/${id}/relationships`, {
      method: "DELETE",
      ...json(body),
    }),
  addCharacter: (id: string, body: Partial<Character> & { name: string }) =>
    request<{ character: Character }>(`/api/worlds/${id}/characters`, {
      method: "POST",
      ...json(body),
    }),
  updateCharacter: (id: string, characterId: string, body: Partial<Omit<Character, "id">>) =>
    request<{ character: Character }>(`/api/worlds/${id}/characters/${characterId}`, {
      method: "PATCH",
      ...json(body),
    }),
  deleteCharacter: (id: string, characterId: string) =>
    request<{ ok: boolean }>(`/api/worlds/${id}/characters/${characterId}`, { method: "DELETE" }),
  promote: (
    id: string,
    body: {
      name: string;
      kind: string;
      role?: string;
      description?: string;
      personality?: string;
      locationId?: string | null;
      era?: string;
    },
  ) =>
    request<{ promoted: Character | Location }>(`/api/worlds/${id}/promote`, {
      method: "POST",
      ...json(body),
    }),

  chapters: (id: string) => request<{ chapters: Chapter[] }>(`/api/worlds/${id}/chapters`),
  chapter: (id: string, n: number) =>
    request<{ chapter: Chapter; text: string | null }>(`/api/worlds/${id}/chapters/${n}`),
  deleteChapter: (id: string, n: number) =>
    request<{ ok: boolean }>(`/api/worlds/${id}/chapters/${n}`, { method: "DELETE" }),

  /**
   * Starts a turn and returns immediately.
   *
   * It doesn't wait for the narrator's reply, and doesn't come back with the text: it
   * comes back with the created turn's id. From then on the work continues even if
   * this tab closes, and the text is re-read from `turns`.
   */
  startTurn: (
    id: string,
    body: { text: string; locale: string; locationId: string | null; silent?: boolean },
  ) =>
    request<{ turnId: string }>(`/api/worlds/${id}/turn`, {
      method: "POST",
      ...json(body),
    }),

  /**
   * The world's turns, and which one is current.
   *
   * It's the source the chat draws itself from: reopening the tab restarts nothing,
   * it re-reads. `active` stays in the same response to avoid two reads that
   * could say two different things on the same screen.
   */
  turns: (id: string) =>
    request<{ turns: TurnRecord[]; active: string | null }>(`/api/worlds/${id}/turns`),

  /**
   * Removes a turn from the job registry.
   *
   * If the turn is still running, the server stops the narrator first: removing
   * the row while it writes would leave a job with nowhere to finish.
   */
  deleteTurn: (id: string, turnId: string) =>
    request<{ ok: boolean }>(`/api/worlds/${id}/turns/${turnId}`, { method: "DELETE" }),

  /**
   * The real conversation, read from the opencode session. It's what lets
   * the chat reopen without starting over: the page doesn't rebuild the
   * story on its own, it re-reads it.
   */
  transcript: (id: string) =>
    request<{ messages: { role: string; text: string; createdAt: number }[] }>(
      `/api/worlds/${id}/transcript`,
    ),
  /** Removes a single message, the last one. Doesn't empty the chat. */
  dropMessage: (id: string) =>
    request<{ kept: number; removed: number }>(`/api/worlds/${id}/message/drop`, {
      method: "POST",
      ...json({}),
    }),

  /**
   * Restarts the conversation: new session, same world.
   *
   * For when "Delete" has hit the bottom and the first message isn't yours, or
   * you no longer need it. The previous game's cast is deleted because it
   * belongs to the old conversation; canon, eras, Bible, arcs and chapters
   * stay where they are.
   */
  resetConversation: (id: string) =>
    request<{ ok: boolean; removedCharacters: number }>(`/api/worlds/${id}/conversation/reset`, {
      method: "POST",
      ...json({}),
    }),
  arcs: (id: string) => request<{ arcs: Arc[] }>(`/api/worlds/${id}/arcs`),
  createArc: (id: string, body: { title: string; logline?: string; firstChapter: number }) =>
    request<{ arc: Arc }>(`/api/worlds/${id}/arcs`, { method: "POST", ...json(body) }),
  closeArc: (id: string, arcId: string, body: { spine: string; title?: string }) =>
    request<{ arc: Arc }>(`/api/worlds/${id}/arcs/${arcId}/close`, {
      method: "POST",
      ...json(body),
    }),
  deleteArc: (id: string, arcId: string, force = false) =>
    request<{ removed: boolean }>(`/api/worlds/${id}/arcs/${arcId}${force ? "?force=true" : ""}`, {
      method: "DELETE",
    }),
  canon: (id: string) =>
    request<{
      /*
       * It was `unknown[]` so the canon list couldn't be used without
       * a cast: the entry type already lives in `@rpwb/shared` and should be reused,
       * otherwise every screen showing canon invents its own copy.
       */
      entries: CanonEntry[];
      health: { total: number; disputed: number; retconned: number };
    }>(`/api/worlds/${id}/canon`),
  canonSearch: (id: string, q: string) =>
    request<{
      results: { subject: string; kind: string; summary: string; status: string }[];
    }>(`/api/worlds/${id}/canon/search?q=${encodeURIComponent(q)}`),

  /**
   * Corrects an entry. Unsent fields stay as they are: the server completes
   * the existing entry, so sending a single field doesn't blank the others.
   */
  editCanon: (id: string, entryId: string, changes: Partial<CanonEntry>, reason = "") =>
    request<{ entry: CanonEntry }>(`/api/worlds/${id}/canon/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...changes, reason: reason }),
    }),

  deleteCanon: (id: string, entryId: string, reason = "") =>
    request<{ removed: boolean }>(`/api/worlds/${id}/canon/${entryId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: reason }),
    }),

  /** History of hand-made corrections, newest first. */
  canonEdits: (id: string) =>
    request<{
      edits: {
        id: string;
        entryId: string;
        subject: string;
        fields: string;
        reason: string;
        createdAt: string;
      }[];
    }>(`/api/worlds/${id}/canon/edits`),

  context: (id: string) =>
    request<{
      state: {
        tokensUsed: number;
        contextLimit: number;
        ratio: number;
        chapterThreshold: number;
        chapterNumber: number;
      };
      carryover: {
        withArcs: number;
        withoutArcs: number;
        saved: number;
        savedRatio: number;
        arcs: number;
        chapters: number;
      };
      model: string;
      reasoningEffort: string;
    }>(`/api/worlds/${id}/context`),

  /**
   * Runs the canonicity review over the chapters already written.
   *
   * `locale` is the campaign's language, not the interface one: it decides which
   * languages the reviewer may answer in, so pinning it to Italian would make a
   * German campaign come back reviewed in Italian.
   */
  verify: (id: string, locale: string) =>
    request<{
      entries: {
        chapterN: number | null;
        claim: string;
        verdict: string;
        canonRef: string;
        suggestion: string;
      }[];
    }>(`/api/worlds/${id}/verify`, { method: "POST", ...json({ chapterId: null, locale }) }),

  exportCampaign: (id: string) => request<Record<string, unknown>>(`/api/worlds/${id}/export`),

  /**
   * Imports a campaign from an exported file.
   *
   * `importCampaign` and not a route under the world: the file describes a
   * **new** campaign, and putting it under `/api/worlds/:id` would suggest
   * overwriting the existing one.
   */
  importCampaign: (file: unknown) =>
    request<{ world: World }>("/api/import", {
      method: "POST",
      body: JSON.stringify(file),
    }),
  loadCorpus: () =>
    request<{ loaded: { slug: string; entries: number }[] }>("/api/corpus/load", {
      method: "POST",
    }),
};

/**
 * Progress of an already-started turn.
 *
 * For one thing only: streaming the text as it arrives, which is the
 * difference between a narrator writing live and one blocking for thirty
 * seconds then opening a wall of text. Not the truth: what happened lives
 * in `api.turns`, and when the stream ends the answer is re-read there.
 *
 * So a network error here isn't reported as a failed turn. If
 * the stream drops but the narrator keeps writing to the database, saying "the turn
 * failed" would be false, and the database reader already has the right answer: just
 * let the stream finish.
 */
export async function* watchTurn(
  worldId: string,
  turnId: string,
): AsyncGenerator<{ type: "text" | "done"; text?: string; debug?: TurnDebug }> {
  const url = `${API}/api/worlds/${worldId}/turns/${turnId}/stream`;

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "text/event-stream" } });
  } catch {
    return;
  }
  if (!response.ok) return;

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        const event = parseEvent(raw);
        if (event) yield event;
        split = buffer.indexOf("\n\n");
      }
    }
  } catch {
    // The stream dropped. Not a turn error: the narrator keeps writing,
    // and `api.turns` tells how it ended.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream was already closed: nothing left to close.
    }
  }
}

function parseEvent(
  raw: string,
): { type: "text" | "done"; text?: string; debug?: TurnDebug } | null {
  let name = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) name = line.slice(7).trim();
    else if (line.startsWith("data: ")) data += line.slice(6);
  }
  if (name === "" || data === "") return null;

  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) return null;
    // `text` is the freshly arrived chunk: updates the preview, nothing more.
    if (name === "text")
      return { type: "text", text: String((parsed as { delta?: unknown }).delta ?? "") };
    // `done` carries the turn's summary, which isn't in the database. The real
    // outcome still comes from `api.turns`.
    if (name === "done") {
      const record = parsed as { text?: string; debug?: TurnDebug };
      return { type: "done", text: record.text ?? "", debug: record.debug };
    }
    return null;
  } catch {
    return null;
  }
}
