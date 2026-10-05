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

/**
 * A campaign is three things that must exist before the first turn: the world's
 * directory, the narrator agent with the Bible inside, and the opencode session
 * that keeps its conversation.
 *
 * The session can change when a chapter closes the context, so only the bootstrap
 * happens here and the pipeline is left to decide the rest.
 *
 * Calling `ensure` on every turn has to cost nothing and lose nothing: that is
 * what keeps the turn path simple.
 */
/**
 * Prepares a world's narrator **without** needing an opencode client.
 *
 * It is for the routes, which have to have the agent's file in place *before*
 * starting the world's server: opencode registers the agents at boot, and a
 * server started without `gm.md` does not know `gm`.
 *
 * It does not need the client because the file is only written to disk.
 *
 * `loreRoot` comes from the caller: the libraries root is a fact of
 * `config/paths.ts`, and deriving it in here would mean one module knows a
 * different version of another.
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
  /**
   * Sessions not to reuse, per world.
   *
   * It lives in memory and not in the database for a precise reason: it marks
   * **the session that has just failed**, and that is information about this
   * process. An old failed turn must not cost a conversation, and `settings` has
   * no room for a row that has to be cleaned at every start.
   */
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
    // A new session is no longer the one marked as poisoned.
    this.#sessioniFallite.delete(world.id);
    return sessionId;
  }

  /**
   * A session already marked as failed is not reused, and asking opencode whether
   * it exists is not enough: it does exist, it is just no longer good for the
   * conversation. The comparison is with the id, not with the world: if a chapter
   * has changed the session in the meantime, the new one has to be used.
   *
   * The last closed turn is checked too, not only the in-memory bookmark: if the
   * backend restarted while a turn was in flight, that turn ended badly with
   * nobody having written it anywhere, and the session it was using is still the
   * one saved on the world. It is the case where the campaign gets stuck and never
   * unsticks.
   */
  #riutilizzabile(world: World): boolean {
    if (this.#sessioniFallite.get(world.id) === world.opencodeSessionId) return false;
    return this.latestFailedSession(world.id) !== world.opencodeSessionId;
  }

  /**
   * Marks the session a turn ended badly on, so the next turn opens a new one.
   *
   * A session on which the provider errored is not fixed by a simple retry, and
   * not even waiting is enough: the assistant's message stays in `error` inside
   * the session, and opencode keeps considering it part of the conversation.
   * Every later prompt starts again from there, with that message inside, and the
   * result is that the campaign does not advance while every turn seems to start.
   *
   * The worst case is not the message, though: it is the session staying
   * **busy**. `session.abort` on an already free session is not a guaranteed
   * no-op, and a session that believes it is writing makes the next prompt queue
   * without ever running it. It is exactly the flaw for which a turn produces
   * nothing and never ends.
   *
   * The cost of getting it wrong is a conversation that restarts from the
   * prologue; the cost of not doing it is a campaign blocked forever. The second
   * is irreversible, the first is not.
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
   * The Bible is in the agent, not in the turn's context: it is the "initial
   * context that must never be lost" and, being in the system prompt, it survives
   * any compaction.
   *
   * The file is rewritten only if it really changed, because regenerating it every
   * turn would touch it while opencode is reading it.
   */
  async ensureAgent(world: World): Promise<void> {
    if (this.#template === null) this.#template = await loadTemplate();
    const bible = this.#worlds.getBible(world.id);
    const libraries = await this.#libraries(world);
    await ensureAgentFile(world.opencodeDir, world, bible, this.#template, libraries);
  }

  /**
   * Resolves the world's library requirements against the disk.
   *
   * It is redone on every `ensureAgent` and not memoised: a library can appear or
   * change while the server is up, and a permission frozen at the first turn would
   * give the narrator an access that no longer reflects the world, or take away one
   * that is its due.
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
   * The most recent turn that ended badly, with the session it happened on.
   *
   * It is read from the **turns** and not from a world field, because it is the
   * only trace that survives a backend restart: if the process dies while a turn
   * is in flight, on return that row is still `running` and the session that turn
   * was using is the one left hanging. Without this check, the first turn after the
   * restart would reuse that session and start again from the hole.
   *
   * A `running` turn that has not expired does not count: it is a turn somebody is
   * carrying forward right now, not a failed turn.
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
