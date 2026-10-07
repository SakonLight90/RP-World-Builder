import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonEntry } from "@rpwb/shared";
import type { Database } from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { buildLexicon, decidePromotion } from "../src/canon/lexicon.js";
import { resolveRoots } from "../src/config/paths.js";
import { openMemory } from "../src/db/connection.js";
import { CanonRepository } from "../src/db/repo/canon.js";
import { CastRepository } from "../src/db/repo/cast.js";
import { WorldRepository } from "../src/db/repo/worlds.js";
import { registerRoutes } from "../src/http/routes.js";

/**
 * A location isn't a character, even when the player asks for it.
 *
 * The defect: a name the narrator cited as a place and one it cited as a person were both
 * offered, and with `kind` defaulting to "character" they both landed among the characters.
 * A location the state card looks for among people is a location the narrator keeps citing as
 * a person.
 *
 * Proven in two places: the pure decision and the route. The route matters more, because a
 * schema with a default always accepts — the wrong default does the damage first and then
 * corrects itself.
 */

/** A canon entry of kind `location`, with a shorter alias. */
const FLATWOODS: CanonEntry = {
  id: "canon-flatwoods",
  worldId: "w1",
  subject: "Flatwoods Lookout",
  kind: "location",
  aliases: ["Flatwoods"],
  summary: "Torre di avvistamento dei vigili del fuoco.",
  facts: [],
  era: "2287",
  status: "active",
  priority: 60,
  tokens: 10,
};

const lexicon = buildLexicon({
  canonSubjects: [
    { id: FLATWOODS.id, subject: FLATWOODS.subject, aliases: FLATWOODS.aliases, kind: "location" },
    { id: "canon-guerra", subject: "Grande Guerra", aliases: [], kind: "event" },
  ],
  characters: [{ id: "c-vera", name: "Vera" }],
  locations: [{ id: "loc-v12", name: "Vault 12", aliases: ["V12"] }],
});

describe("promotion: the decision", () => {
  it("a known location can't be promoted to character", () => {
    const verdict = decidePromotion("Vault 12", "character", lexicon);
    expect(verdict.ok).toBe(false);
    expect(verdict.expected).toBe("location");
    expect(verdict.problem).toContain("Vault 12");
    expect(verdict.problem).toContain("a location");
  });

  it("a known character can't be promoted to location", () => {
    const verdict = decidePromotion("Vera", "location", lexicon);
    expect(verdict.ok).toBe(false);
    expect(verdict.expected).toBe("character");
    expect(verdict.problem).toContain("Vera");
  });

  it("a canon location can't become a character even before it's among the locations", () => {
    // A canon entry and not a `locations` row: without the entry's kind, classification
    // would only say "it's in the canon" and could refuse nothing.
    const verdict = decidePromotion("Flatwoods", "character", lexicon);
    expect(verdict.ok).toBe(false);
    expect(verdict.expected).toBe("location");
  });

  it("aliases count as much as names", () => {
    expect(decidePromotion("V12", "character", lexicon).ok).toBe(false);
    expect(decidePromotion("flatwoods", "character", lexicon).ok).toBe(false);
  });

  it("the right kind always passes", () => {
    expect(decidePromotion("Vault 12", "location", lexicon).ok).toBe(true);
    expect(decidePromotion("Flatwoods Lookout", "location", lexicon).ok).toBe(true);
    expect(decidePromotion("Vera", "character", lexicon).ok).toBe(true);
  });

  it("an unknown name can be promoted", () => {
    const verdict = decidePromotion("Brennan", "character", lexicon);
    expect(verdict.ok).toBe(true);
    expect(verdict.problem).toBe("");
    expect(decidePromotion("Caverna del Nord", "location", lexicon).ok).toBe(true);
  });

  it("a canon entry that isn't a promotable kind blocks nothing", () => {
    // "Grande Guerra" is an event: there's no wrong kind to contradict, and
    // refusing here would punish the player for a limit of our vocabulary.
    expect(decidePromotion("Grande Guerra", "character", lexicon).ok).toBe(true);
  });
});

describe("promotion: the route", () => {
  let db: Database;
  let app: FastifyInstance;
  let cast: CastRepository;
  let worldId: string;

  const promote = (payload: unknown) =>
    app.inject({
      method: "POST",
      url: `/api/worlds/${worldId}/promote`,
      payload: payload as object,
    });

  const names = async () => ({
    characters: cast.listCharacters(worldId).map((character) => character.name),
    locations: cast.listLocations(worldId).map((location) => location.name),
  });

  beforeEach(async () => {
    db = openMemory();
    const worlds = new WorldRepository(db);
    const canon = new CanonRepository(db);
    cast = new CastRepository(db);
    worldId = worlds.create({
      name: "Appalachia 2287",
      slug: "appalachia-2287",
      model: "opencode/space-bunny-free",
      smallModel: "opencode/space-bunny-free",
      opencodeDir: join(tmpdir(), "rpwb-promote", "appalachia-2287"),
    }).id;

    canon.upsertMany([
      { ...FLATWOODS, worldId },
      {
        ...FLATWOODS,
        id: "canon-michael",
        worldId,
        subject: "Michael",
        kind: "character",
        aliases: [],
        era: "any",
      },
    ]);
    cast.addLocation(worldId, {
      name: "Vault 12",
      description: "",
      parentId: null,
      aliases: ["V12"],
      era: "any",
    });
    cast.addCharacter(worldId, {
      name: "Vera",
      role: "",
      description: "",
      personality: "",
      secret: "",
      status: "",
      locationId: null,
      isPlayer: false,
      canonical: true,
      era: "any",
    });

    app = Fastify({ logger: false });
    // Routes receive the roots from whoever builds them: here only data is
    // pointed at something temporary, everything else stays the real project one.
    const roots = resolveRoots();
    registerRoutes(app, {
      db,
      roots: {
        ...roots,
        data: join(tmpdir(), "rpwb-promote"),
        worlds: join(tmpdir(), "rpwb-promote", "worlds"),
      },
      bridge: null,
    });
    await app.ready();
  });

  it("refuses to create a character that is a location, and writes nothing", async () => {
    const response = await promote({ name: "Flatwoods", kind: "character" });
    expect(response.statusCode).toBe(409);
    expect(response.json().problem).toContain("a location");
    // The right kind comes back, so whoever pressed can retry without guessing again.
    expect(response.json().expected).toBe("location");
    expect(await names()).toEqual({ characters: ["Vera"], locations: ["Vault 12"] });
  });

  it("refuses to create a location that is a character, and writes nothing", async () => {
    const response = await promote({ name: "Vera", kind: "location" });
    expect(response.statusCode).toBe(409);
    expect(response.json().expected).toBe("character");
    expect(await names()).toEqual({ characters: ["Vera"], locations: ["Vault 12"] });
  });

  it("refuses a location already present among the world's locations", async () => {
    const response = await promote({ name: "Vault 12", kind: "character" });
    expect(response.statusCode).toBe(409);
    expect(await names()).toEqual({ characters: ["Vera"], locations: ["Vault 12"] });
  });

  it("has no default: without a kind the request is an error, not a choice", async () => {
    // The default used to be "character" and that's what caused the defect:
    // without a declared kind, the server can't choose in the player's place.
    const response = await promote({ name: "Brennan" });
    expect(response.statusCode).toBe(400);
    expect(await names()).toEqual({ characters: ["Vera"], locations: ["Vault 12"] });
  });

  it("an unknown name is promoted to the declared kind", async () => {
    const response = await promote({ name: "Brennan", kind: "character", role: "mercante" });
    expect(response.statusCode).toBe(200);
    expect(response.json().kind).toBe("character");
    expect((await names()).characters).toContain("Brennan");
  });

  it("an unknown location is promoted as a location", async () => {
    const response = await promote({ name: "Caverna del Nord", kind: "location" });
    expect(response.statusCode).toBe(200);
    expect((await names()).locations).toContain("Caverna del Nord");
  });

  it("a canon location is promoted as a location", async () => {
    const response = await promote({ name: "Flatwoods Lookout", kind: "location" });
    expect(response.statusCode).toBe(200);
    expect((await names()).locations).toContain("Flatwoods Lookout");
  });

  it("a world that doesn't exist is promoted to nothing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/worlds/w-morto/promote",
      payload: { name: "Brennan", kind: "character" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("a faction doesn't become a character when there's nowhere to write it", async () => {
    // Before it used to land among the characters silently, that is: the wrong
    // entity. Here the route says it only creates characters and locations.
    const response = await promote({ name: "Brotherhood of Steel", kind: "faction" });
    expect(response.statusCode).toBe(400);
    expect(response.json().problem).toContain("faction");
    expect(await names()).toEqual({ characters: ["Vera"], locations: ["Vault 12"] });
  });
});
