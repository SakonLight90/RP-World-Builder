/*
 * The routes' shared space: repositories, roots, bridge, and the helpers serving
 * more than one domain.
 *
 * One thing to pass, and the functions here receive it first.
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
import { CatalogCache } from "../opencode/catalog-cache.js";
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
  /**
   * The model catalogue, read at most once in a few seconds.
   *
   * On the scope because it belongs to the bridge: one bridge, one catalogue. A module
   * variable would make a second bridge read the first one's answer.
   */
  catalog: CatalogCache;
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
  // the one passed to `createApp`.
  const dataDir = roots.data;
  return {
    db,
    roots,
    bridge,
    dataDir,
    // Built here so every route shares one: a cache per route would be a cache that
    // never hits, and a cache per call would be no cache at all.
    catalog: new CatalogCache(() => {
      if (!bridge) throw new Error("opencode is not available");
      return bridge.clientFor(dataDir);
    }),
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
 * A world's path: opens its opencode server, and **first** writes the agent file.
 *
 * opencode registers agents at boot, so a server started without `gm.md` does not know
 * `gm` and every prompt with that agent dies with a generic error.
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

/** A world's narrator: the client with the contract up front. */
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
 * Without this the bookmark stays at 1 after a restart and the transcript shows only
 * the opening whatever gets written: the campaign moves on with nobody watching.
 *
 * Not reset to `-1`, because that would lose deletions. Only what arrived after is
 * added, keeping the previous cut.
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
    // The transcript may be unreadable: the turn already went through.
  }
};

/**
 * The conversation, as the player sees it.
 *
 * Message 1 is the opening. Behind it, only the narrator's messages and the player's
 * lines: the injected canon and the automatic Continue/Retry requests are engine
 * business and would look like lines the player wrote.
 *
 * One function because "Delete" uses it too: two lists built in two places diverge at
 * the first change and the deletion count cuts the wrong message.
 */
export const conversation = async (
  scope: RouteScope,
  world: World,
  sessionId: string,
): Promise<ConversationMessage[]> => {
  /**
   * Message 1.
   *
   * A selected start comes first: when the player has chosen how to begin, that choice
   * *is* the opening, and the Bible is what the narrator follows afterwards.
   *
   * Without a start, the premise and the rules are what the opening is made of, and
   * the description comes second — it is the one line the player wrote about their own
   * campaign. When all three are empty there is nothing honest to say.
   */
  const prologueOf = (): ConversationMessage | null => {
    const starts = world.starts;
    if (starts.selectedId !== null) {
      const selected = starts.list.find((entry) => entry.id === starts.selectedId);
      // A start with no narration is not an opening: falling through to the Bible
      // keeps the campaign readable instead of opening on an empty bubble.
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

  // A campaign that has not started has no session, and asking opencode with an
  // empty id is an error. Its history is just the opening.
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
