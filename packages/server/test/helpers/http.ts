import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpencodeClient } from "@opencode-ai/sdk";
import type { World } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { resolveRoots, slugify } from "../../src/config/paths.js";
import { openMemory } from "../../src/db/connection.js";
import { CastRepository } from "../../src/db/repo/cast.js";
import { WorldRepository } from "../../src/db/repo/worlds.js";
import { type RouteDeps, registerRoutes } from "../../src/http/routes.js";

/**
 * Harness for testing routes without opencode.
 *
 * The bridge is an interface and can be faked: that's why routes needing the
 * narrator can be tested without starting any server and without calling any
 * model. The fake client implements only the three methods these routes call,
 * and every call is recorded, so the test can tell what was requested and not
 * just how the response ended.
 *
 * Each harness has its own in-memory database and temp folder: two tests never
 * see each other and run order doesn't matter.
 */

/** A session message, as opencode sees it. */
export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
}

export interface FakeOpencode {
  client: OpencodeClient;
  /** Messages returned by `session.messages`. */
  session: SessionMessage[];
  /** Sessions deleted with `session.delete`. */
  deleted: string[];
  /** Id of the message left alive, for each `session.revert`. */
  reverted: string[];
  /** Directory a server was requested for. */
  requested: string[];
  /** Directory a server was stopped for. */
  stopped: string[];
  /** When present, `session.messages` responds with an error. */
  messageError: Error | null;
  /** Text returned by `session.prompt`: the fake narrator's reply. */
  promptReply: string;
  /** Providers the client reports as connected. */
  connected: string[];
  /** Providers with their models, as `config.providers` would return them. */
  provider: unknown[];
}

const FIXED_EPOCH = 1_700_000_000_000;

/** Shape that `readMessages` expects from the SDK. */
function storedMessage(id: string, message: SessionMessage, index: number): unknown {
  return {
    info: { id, role: message.role, time: { created: FIXED_EPOCH + index } },
    parts: [{ type: "text", text: message.text }],
  };
}

export function fakeOpencode(session: SessionMessage[] = []): FakeOpencode {
  const fake: FakeOpencode = {
    client: undefined as unknown as OpencodeClient,
    session,
    deleted: [],
    reverted: [],
    requested: [],
    stopped: [],
    messageError: null,
    promptReply: '{"findings":[]}',
    connected: [],
    provider: [],
  };

  fake.client = {
    session: {
      messages: async () =>
        fake.messageError === null
          ? { data: fake.session.map((m, i) => storedMessage(`msg_${i}`, m, i)) }
          : { data: undefined, error: { message: fake.messageError.message } },
      create: async () => ({ data: { id: "ses_verifica" } }),
      prompt: async () => ({
        data: { parts: [{ type: "text", text: fake.promptReply }] },
      }),
      revert: async (opts: { path: { id: string }; body: { messageID: string } }) => {
        fake.reverted.push(opts.body.messageID);
        return { data: true };
      },
      delete: async (opts: { path: { id: string } }) => {
        fake.deleted.push(opts.path.id);
        return { data: true };
      },
    },
    provider: {
      list: async () => ({ data: { connected: fake.connected } }),
    },
    config: {
      providers: async () => ({ data: { providers: fake.provider } }),
    },
  } as unknown as OpencodeClient;

  return fake;
}

/** Fake bridge returning the same client and recording requests. */
export function fakeBridge(fake: FakeOpencode): NonNullable<RouteDeps["bridge"]> {
  return {
    ensureServer: async (directory: string) => {
      fake.requested.push(directory);
      return fake.client;
    },
    clientFor: (directory: string) => {
      fake.requested.push(directory);
      return fake.client;
    },
    stopServer: async (directory: string) => {
      fake.stopped.push(directory);
    },
  };
}

export interface Harness {
  app: FastifyInstance;
  db: Database;
  /** Temp data folder: nothing lands in `%APPDATA%`. */
  data: string;
  worlds: WorldRepository;
  cast: CastRepository;
  fake: FakeOpencode;
  /** Closes the app, database and removes the temp folder. */
  close: () => Promise<void>;
}

export interface HarnessOptions {
  /** With `false` the bridge is absent, as when opencode isn't installed. */
  withBridge?: boolean;
}

export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const data = await mkdtemp(join(tmpdir(), "rpwb-http-"));
  const db = openMemory();
  const fake = fakeOpencode();
  const app = Fastify({ logger: false });

  registerRoutes(app, {
    db,
    // Real project roots come from `createApp`: only data changes here to temp,
    // and worlds must live under temp data so world deletion can reach them.
    roots: { ...resolveRoots(), data, worlds: join(data, "worlds") },
    bridge: options.withBridge === true ? fakeBridge(fake) : null,
  });
  await app.ready();

  return {
    app,
    db,
    data,
    worlds: new WorldRepository(db),
    cast: new CastRepository(db),
    fake,
    close: async () => {
      await app.close();
      db.close();
      await rm(data, { recursive: true, force: true });
    },
  };
}

/** Path of a world inside the temp data folder. */
export function harnessWorldDir(h: Harness, slug: string): string {
  return join(h.data, "worlds", slug);
}

/** A world with its folder under temp data. */
export function makeWorld(h: Harness, nameOf: string): World {
  const slug = `${slugify(nameOf)}-${Math.random().toString(36).slice(2, 8)}`;
  return h.worlds.create({
    name: nameOf,
    slug,
    model: "opencode/space-bunny-free",
    smallModel: "opencode/space-bunny-free",
    opencodeDir: harnessWorldDir(h, slug),
  });
}

/** A character with all required fields, so tests don't repeat them. */
export function makeCharacter(
  h: Harness,
  worldId: string,
  nameOf: string,
  fields: { locationId?: string | null; isPlayer?: boolean } = {},
): string {
  return h.cast.addCharacter(worldId, {
    name: nameOf,
    role: "",
    description: "",
    personality: "",
    secret: "",
    status: "",
    locationId: fields.locationId ?? null,
    isPlayer: fields.isPlayer === true,
    canonical: true,
    era: "any",
  }).id;
}

/** A location, for the same reasons. */
export function makeLocation(
  h: Harness,
  worldId: string,
  nameOf: string,
  parentId: string | null = null,
) {
  return h.cast.addLocation(worldId, {
    name: nameOf,
    description: "",
    parentId,
    aliases: [],
    era: "any",
  });
}
