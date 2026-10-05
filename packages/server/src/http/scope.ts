/**
 * The routes' shared space: repositories, roots, bridge, and the helpers
 * serving more than one domain.
 *
 * It exists because `routes.ts` built everything in a single closure, and splitting the
 * routes without a place for what they share would have meant
 * either duplicating it or passing ten parameters to every call. The scope is one
 * thing to pass, and functions in here receive it first.
 */

import type { OpencodeClient } from "@opencode-ai/sdk";
import type { World } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import type { ProjectRoots } from "../config/paths.js";
import { ArcRepository } from "../db/repo/arcs.js";
import { CanonRepository } from "../db/repo/canon.js";
import { CastRepository } from "../db/repo/cast.js";
import { ChapterRepository } from "../db/repo/chapters.js";
import { TurnRepository } from "../db/repo/turns.js";
import { WorldRepository } from "../db/repo/worlds.js";
import { cleanNarration, isContext, isSilent } from "../opencode/markers.js";
import type { Narrator } from "../opencode/narrator.js";
import { narratorFor } from "../opencode/narrator-adapter.js";
import { TurnPipeline } from "../turns/pipeline.js";
import { prepareNarrator } from "../turns/session.js";
import type { RouteDeps } from "./routes.js";

export interface RouteScope {
  db: Database;
  roots: ProjectRoots;
  bridge: RouteDeps["bridge"];
  dataDir: string;
  worlds: WorldRepository;
  canon: CanonRepository;
  cast: CastRepository;
  chapters: ChapterRepository;
  arcs: ArcRepository;
  turns: TurnRepository;
}

/** Builds the scope once, in `registerRoutes`. */
export function createScope(
  db: Database,
  roots: ProjectRoots,
  bridge: RouteDeps["bridge"],
): RouteScope {
  // Local alias to avoid repeating `roots.` in every route: a single source remains,
  // the one passed by `createApp`.
  const dataDir = roots.data;
  return {
    db,
    roots,
    bridge,
    dataDir,
    worlds: new WorldRepository(db),
    canon: new CanonRepository(db),
    cast: new CastRepository(db),
    chapters: new ChapterRepository(db),
    arcs: new ArcRepository(db),
    turns: new TurnRepository(db),
  };
}
/** A conversation message, as the player sees it. */
interface ConversationMessage {
  role: string;
  text: string;
  createdAt: number;
}

/**
 * A world's path. Opens its opencode server, but **first** writes the
 * narrator agent file.
 *
 * The order is not a detail: opencode registers agents at boot by reading
 * `.opencode/agents/`, so a server started without `gm.md` does not know
 * `gm` and every `prompt` with that agent dies with a generic error that says
 * nothing. The case only shows on a new world's first run,
 * and looks like a session problem.
 */
export const prepareWorld = async (scope: RouteScope, worldId: string): Promise<World | null> => {
  if (!scope.bridge) throw new Error("opencode is not available");
  const world = scope.worlds.get(worldId);
  if (!world) return null;
  await prepareNarrator(world, scope.worlds.getBible(world.id), scope.roots.lore);
  return world;
};

export const pipelineFor = async (scope: RouteScope, worldId: string): Promise<TurnPipeline> => {
  const world = await prepareWorld(scope, worldId);
  const client = await scope.bridge?.ensureServer(world?.opencodeDir ?? scope.dataDir);
  if (!client) throw new Error("opencode is not available");
  return new TurnPipeline(scope.db, narratorFor(client), scope.roots.lore);
};

/** Like `pipelineFor`, but for endpoints that do not play a turn. */
export const clientForWorld = async (
  scope: RouteScope,
  worldId: string,
): Promise<OpencodeClient> => {
  if (!scope.bridge) throw new Error("opencode is not available");
  const world = await prepareWorld(scope, worldId);
  return await scope.bridge.ensureServer(world?.opencodeDir ?? scope.dataDir);
};

/**
 * A world's narrator, that is the client with the contract up front.
 *
 * It is the only place where opencode becomes a `Narrator`: below, routes and pipeline
 * only speak to the contract. Call it when a narrator is needed, not
 * when a client is needed: they are two different questions.
 */
export const narratorForWorld = async (scope: RouteScope, worldId: string): Promise<Narrator> =>
  narratorFor(await clientForWorld(scope, worldId));

/** How many visible messages exist now, prologue included. */
export const visibleCount = async (scope: RouteScope, world: World): Promise<number> => {
  try {
    return (await conversation(scope, world, world.opencodeSessionId ?? "")).length;
  } catch {
    return 0;
  }
};

/**
 * Moves the deletion bookmark forward by how many messages arrived.
 *
 * `kept_messages` says how many of the visible messages to keep. The problem starts
 * when a world is restarted or deeply deleted: the bookmark stays at
 * `1` (the prologue, which is never deleted) and from then on the transcript shows
 * **only** the prologue, whatever gets written. The narrator replies, the
 * session grows, and the UI looks as if the prompt never started: the
 * campaign moved on with nobody watching.
 *
 * It is not taken to `-1` because that would lose deletions: if the
 * player removed three messages, they must stay removed. So only what
 * arrived after is added, keeping the previous cut while the new part
 * shows.
 */
export const advanceKept = async (
  scope: RouteScope,
  world: World,
  before: number,
): Promise<void> => {
  try {
    const kept = scope.worlds.keptMessages(world.id);
    if (kept < 0) return;
    const after = await visibleCount(scope, world);
    const added = after - before;
    if (added > 0) scope.worlds.setKeptMessages(world.id, kept + added);
  } catch {
    // The transcript may be unreadable: the turn already went through,
    // and failing here would leave an error on an already-written response.
  }
};

/**
 * The conversation, as the player sees it.
 *
 * The world's prologue is message 1 and lives in history. Behind it, there are
 * only the narrator's messages and the player's lines: the canon injected at
 * every turn and the automatic "Continue" and "Retry" requests are engine
 * business, and if they showed here they would look like lines written by you.
 *
 * It lives in a single function because "Delete" uses it too: two lists built
 * in two places diverge at the first change, and the deletion count
 * ends up cutting the wrong message.
 */
export const conversation = async (
  scope: RouteScope,
  world: World,
  sessionId: string,
): Promise<ConversationMessage[]> => {
  /**
   * Message 1, and it always exists.
   *
   * It used to be assembled on every read out of `bible.premise` and
   * `bible.rules`, and it returned `null` when both were empty. That made the
   * prologue something the campaign could simply not have: create a world, do
   * not fill the Bible in, play, and resetting the conversation left the
   * transcript with nothing in it. The narrator had written the whole story and
   * the opening had never been there to begin with, so "restarting" looked like
   * a deletion.
   *
   * The premise and the rules are the first choice because they are what the
   * prologue is made of. The description is the second, and it is not a
   * decoration: it is the one line the player typed about their own campaign, so
   * it opens the story in their own words and in their own language. Only when
   * all three are empty is there nothing honest left to say, and that case says
   * so rather than pretending.
   *
   * A selected start comes before all of them. When the player has chosen how to
   * begin, that choice *is* the opening: the transcript opens on the narration
   * they picked, and the Bible is what the narrator follows afterwards. Ranking it
   * third would mean choosing a start and still being shown the generic prologue,
   * with the choice visible nowhere except in a field.
   */
  const prologueOf = (): ConversationMessage | null => {
    const starts = world.starts;
    if (starts.selectedId !== null) {
      const selected = starts.list.find((entry) => entry.id === starts.selectedId);
      // A start with no narration is not an opening. It is a start that was
      // written without a scene, and falling through to the Bible keeps the
      // campaign readable instead of opening the transcript on an empty bubble.
      if (selected !== undefined && selected.narration.trim() !== "") {
        return { role: "assistant", text: cleanNarration(selected.narration), createdAt: 0 };
      }
    }

    const bible = scope.worlds.getBible(world.id);
    const fromBible = [bible.premise, bible.rules]
      .filter((section) => section.trim() !== "")
      .join("\n\n");
    const text =
      fromBible.trim() !== ""
        ? fromBible
        : world.description.trim() !== ""
          ? world.description.trim()
          : "";
    if (text === "") return null;
    return { role: "assistant", text: cleanNarration(text), createdAt: 0 };
  };

  // A freshly opened campaign has no session yet: it asks with an empty
  // id and opencode answers with an error about a session. The
  // history of a world that has not started yet is just the prologue.
  if (sessionId === "") {
    const only = prologueOf();
    return only === null ? [] : [only];
  }

  const raw = await (await narratorForWorld(scope, world.id)).messages(sessionId);
  const visible = raw
    .filter((m) => !isContext(m.text) && !isSilent(m.text))
    .map((m) => ({
      role: m.role,
      text: m.role === "assistant" ? cleanNarration(m.text) : m.text,
      createdAt: m.createdAt,
    }));

  const prologue = prologueOf();
  return prologue === null ? visible : [prologue, ...visible];
};
