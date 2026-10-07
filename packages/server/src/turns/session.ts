import type { Arc, World } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import {
  type AgentLibraries,
  ensureAgentFile,
  loadTemplate,
  NO_LIBRARIES,
} from "../canon/gm-agent.js";
import { ArcRepository } from "../db/repo/arcs.js";
import { TurnRepository } from "../db/repo/turns.js";
import { WorldRepository } from "../db/repo/worlds.js";
import { libraryIndex, readableRoots, resolveLibraries } from "../lore/registry.js";
import type { Narrator } from "../opencode/narrator.js";

/*
 * A campaign is three things that must exist before the first turn: the world's directory,
 * the narrator agent with the Bible inside, and the opencode session holding its
 * conversation. The session changes when a chapter closes the context, so only the bootstrap
 * belongs here: `ensure` must cost nothing and lose nothing.
 */

/**
 * Prepares a world's narrator without an opencode client.
 *
 * For the routes: opencode registers agents at boot, so a server started without `gm.md` does
 * not know `gm`.
 */
export async function prepareNarrator(
  world: World,
  bible: Record<string, string>,
  loreRoot: string,
): Promise<void> {
  const template = await loadTemplate();
  let libraries: AgentLibraries = NO_LIBRARIES;
  if (world.libraries.length > 0) {
    const resolved = await resolveLibraries(loreRoot, world.libraries);
    libraries = { readableRoots: readableRoots(resolved), index: libraryIndex(resolved) };
  }
  await ensureAgentFile(world.opencodeDir, world, bible, template, libraries);
}

export class CampaignSession {
  readonly #db: Database;
  /** The narrator as a contract: here there is no knowing what is behind it. */
  readonly #narrator: Narrator;
  readonly #worlds: WorldRepository;
  readonly #arcs: ArcRepository;
  readonly #turns: TurnRepository;
  /** Libraries root: it comes from outside, it is not deduced. See `prepareNarrator`. */
  readonly #loreRoot: string;
  /** Sessions not to reuse, per world. In memory: it marks the session that just failed. */
  readonly #sessioniFallite = new Map<string, string>();
  #template: string | null = null;

  constructor(db: Database, narrator: Narrator, loreRoot: string) {
    this.#db = db;
    this.#narrator = narrator;
    this.#loreRoot = loreRoot;
    this.#worlds = new WorldRepository(db);
    this.#arcs = new ArcRepository(db);
    this.#turns = new TurnRepository(db);
  }

  world(worldId: string): World {
    const world = this.#worlds.get(worldId);
    if (!world) throw new CampaignError(`World not found: ${worldId}`);
    return world;
  }

  arcs(): ArcRepository {
    return this.#arcs;
  }

  worlds(): WorldRepository {
    return this.#worlds;
  }

  /** Prepares the world and returns the session to use for this turn. */
  async ensure(world: World): Promise<string> {
    await this.ensureAgent(world);

    if (world.opencodeSessionId !== null && this.#riutilizzabile(world)) {
      if (await this.#narrator.sessionExists(world.opencodeSessionId)) {
        return world.opencodeSessionId;
      }
    }

    const sessionId = await this.#narrator.createSession(world.name);
    this.#worlds.update(world.id, { opencodeSessionId: sessionId });
    // A new session is no longer the marked one.
    this.#sessioniFallite.delete(world.id);
    return sessionId;
  }

  /**
   * Whether a session is reusable.
   *
   * A marked session exists and is no longer good for the conversation, so asking opencode
   * whether it exists is not enough. Compared by id, since a chapter may have changed the
   * session.
   *
   * The last closed turn is checked too: a backend that restarted mid-turn leaves a `running`
   * row whose session is still the world's, and that is where a campaign never unsticks.
   */
  #riutilizzabile(world: World): boolean {
    if (this.#sessioniFallite.get(world.id) === world.opencodeSessionId) return false;
    return this.latestFailedSession(world.id) !== world.opencodeSessionId;
  }

  /**
   * Marks the session a turn ended badly on, so the next turn opens a new one.
   *
   * Retrying on an errored session does not fix it: the assistant's message stays in `error`
   * inside it and every later prompt starts from there, so the campaign stops advancing while
   * every turn appears to start.
   *
   * Worse, the session can stay **busy**: a session that believes it is writing queues the
   * next prompt forever.
   *
   * Getting it wrong costs a conversation restarting from the prologue; not getting it wrong
   * costs a campaign blocked forever.
   */
  markSessionFailed(worldId: string, sessionId: string): void {
    if (sessionId === "") return;
    this.#sessioniFallite.set(worldId, sessionId);
  }

  /** The session this world must not reuse, if there is one. */
  failedSession(worldId: string): string | null {
    return this.#sessioniFallite.get(worldId) ?? null;
  }

  /** Remembers the new session when a chapter has changed it. */
  rememberSession(worldId: string, sessionId: string): void {
    this.#worlds.update(worldId, { opencodeSessionId: sessionId });
  }

  /**
   * The Bible is in the agent, in the system prompt, so it survives compaction.
   *
   * Written only when it really changed, so the file is not touched while opencode reads it.
   */
  async ensureAgent(world: World): Promise<void> {
    if (this.#template === null) this.#template = await loadTemplate();
    const bible = this.#worlds.getBible(world.id);
    const libraries = await this.#libraries(world);
    await ensureAgentFile(world.opencodeDir, world, bible, this.#template, libraries);
  }

  /**
   * Resolves the world's library requirements.
   *
   * Redone on each `ensureAgent`, not memoised: a permission frozen at the first turn would no
   * longer reflect the world.
   */
  async #libraries(world: World): Promise<AgentLibraries> {
    if (world.libraries.length === 0) return NO_LIBRARIES;
    const resolved = await resolveLibraries(this.#loreRoot, world.libraries);
    return { readableRoots: readableRoots(resolved), index: libraryIndex(resolved) };
  }

  /** The arc being written in. If there is none, the campaign has not started yet. */
  currentArc(worldId: string, chapterNumber: number): Arc {
    const open = this.#arcs.current(worldId);
    if (open) return open;
    return this.#arcs.create(worldId, {
      title: `Arc ${this.#arcs.nextNumber(worldId)}`,
      logline: "",
      firstChapter: chapterNumber,
    });
  }

  /**
   * The most recent turn that ended badly, with its session.
   *
   * Read from `turns`, the only trace that survives a restart. A `running` turn that has not
   * expired does not count: somebody is carrying it forward.
   */
  latestFailedSession(worldId: string): string | null {
    for (const turn of this.#turns.list(worldId, 5)) {
      if (turn.state === "running") continue;
      return turn.state === "failed"
        ? (this.#worlds.get(worldId)?.opencodeSessionId ?? null)
        : null;
    }
    return null;
  }

  /** For whoever closes the campaign, so no sessions are left hanging. */
  get db(): Database {
    return this.#db;
  }
}

export class CampaignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignError";
  }
}
