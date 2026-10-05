import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Harness } from "./helpers/http.js";
import { harness } from "./helpers/http.js";

/**
 * Settings and model catalog: the two routes the wizard calls.
 *
 * Settings live in the config file, not in a side table, because that's where
 * the server reads them at boot: port, host and models written elsewhere would
 * be values nobody rereads. Here it's proven what `PUT` saves is what the
 * server reopens with `GET`, off-list keys are rejected instead of landing
 * somewhere unknown, and the preferred model really becomes the catalog
 * default.
 *
 * The model catalog differs: not a list written here, it arrives from opencode
 * on each request, so the route that matters asks the **main** server not a
 * world's, and the route explaining the problem when no provider is connected
 * instead of returning an empty list without saying why.
 */

let h: Harness;

const get = (route: string) => h.app.inject({ method: "GET", url: route });

const put = (route: string, payload: unknown) =>
  h.app.inject({ method: "PUT", url: route, payload: payload as object });

const FREE_MODEL = {
  id: "opencode",
  models: {
    "space-bunny-free": {
      name: "Space Bunny",
      cost: { input: 0, output: 0 },
      limit: { context: 32_000 },
      capabilities: { reasoning: true },
    },
    // Free, but with a tradeoff: among models the player must choose knowing
    // the story may end up in a training set.
    "muse-spark-1.3-contributor-free": {
      name: "Muse Spark",
      cost: { input: 0, output: 0 },
      limit: { context: 64_000 },
    },
  },
};

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.close();
});

describe("settings", () => {
  it("on a fresh install returns the project-declared values", async () => {
    // Not an empty object nor invented values: readers must know where port
    // and language come from before saving anything.
    const response = await get("/api/settings");
    expect(response.statusCode).toBe(200);
    expect(response.json().settings).toMatchObject({
      uiLocale: "en",
      port: 3311,
      setupCompleted: false,
      preferredModel: null,
      preferredSmallModel: null,
    });
  });

  it("writes and rereads what was saved", async () => {
    const response = await put("/api/settings", {
      uiLocale: "en",
      setupCompleted: true,
      preferredSmallModel: "opencode/space-bunny-free",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings).toMatchObject({
      uiLocale: "en",
      setupCompleted: true,
      preferredSmallModel: "opencode/space-bunny-free",
    });

    const reread = (await get("/api/settings")).json<{ settings: Record<string, unknown> }>();
    expect(reread.settings).toMatchObject({ uiLocale: "en", setupCompleted: true });
  });

  it("a key written twice keeps the last, not both together", async () => {
    await put("/api/settings", { uiLocale: "en" });
    await put("/api/settings", { uiLocale: "fr" });

    const settings = (await get("/api/settings")).json<{ settings: Record<string, unknown> }>();
    expect(settings.settings.uiLocale).toBe("fr");
  });

  it("an off-list key is rejected, not saved somewhere unknown", async () => {
    // This route used to accept any key and write it as a string into a table
    // nobody reread: saving "port" there didn't change any port. Now the list
    // is closed and what's missing is an error.
    const response = await put("/api/settings", { port: 4000 });
    expect(response.statusCode).toBe(400);

    const settings = (await get("/api/settings")).json<{ settings: Record<string, unknown> }>();
    expect(settings.settings.port).toBe(3311);
  });

  it("a body that isn't an object is an error, not an empty save", async () => {
    // `null` here isn't "no settings": it's a malformed request, and if it
    // passed nobody would know whether anything saved.
    const response = await h.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(response.statusCode).toBe(400);
  });

  // Defect found writing another version of this file then fixed: a JSON body
  // that's a list is an object for `typeof`, so the route accepted it and wrote
  // one key per position. The result was a settings screen with "0", "1", "2"
  // keys nobody knew.
  it("a body that's a list isn't mistaken for an object", async () => {
    const response = await put("/api/settings", ["en", "fr"]);
    expect(response.statusCode).toBe(400);
  });

  it("with nothing to save it saves nothing", async () => {
    // An empty object answering 200 would claim a save without changing
    // anything: better to say so.
    expect((await put("/api/settings", {})).statusCode).toBe(400);
  });

  it("an off-list language is rejected", async () => {
    expect((await put("/api/settings", { uiLocale: "xx" })).statusCode).toBe(400);
  });

  it("the preferred model becomes the catalog default", async () => {
    // That's the point of saving a preference: choosing it in UI and seeing it
    // ignored would be a preference preferring nothing.
    const withBridge = await harness({ withBridge: true });
    try {
      withBridge.fake.connected = ["opencode"];
      withBridge.fake.provider = [FREE_MODEL];

      await withBridge.app.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { preferredModel: "opencode/space-bunny-free" },
      });
      const payload = (await withBridge.app.inject({ method: "GET", url: "/api/models" })).json<{
        default: string | null;
      }>();
      expect(payload.default).toBe("opencode/space-bunny-free");
    } finally {
      await withBridge.close();
    }
  });

  it("a favorite that no longer exists doesn't propose an unusable model", async () => {
    const withBridge = await harness({ withBridge: true });
    try {
      withBridge.fake.connected = ["opencode"];
      withBridge.fake.provider = [FREE_MODEL];

      await withBridge.app.inject({
        method: "PUT",
        url: "/api/settings",
        payload: { preferredModel: "opencode/fantasma" },
      });
      const payload = (await withBridge.app.inject({ method: "GET", url: "/api/models" })).json<{
        default: string | null;
      }>();
      expect(payload.default).toBe("opencode/space-bunny-free");
    } finally {
      await withBridge.close();
    }
  });
});

describe("the model catalog", () => {
  it("without opencode answers empty instead of failing", async () => {
    // The wizard must show "no models" while opencode isn't ready yet, not get
    // an error and leave a blank screen.
    const response = await get("/api/models");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      free: [],
      narrator: [],
      restricted: [],
      default: null,
    });
  });

  it("with opencode brings free models and tells why they fit the narrator", async () => {
    const withBridge = await harness({ withBridge: true });
    try {
      withBridge.fake.connected = ["opencode"];
      withBridge.fake.provider = [FREE_MODEL];

      const response = await withBridge.app.inject({ method: "GET", url: "/api/models" });
      expect(response.statusCode).toBe(200);

      const payload = response.json<{
        free: { ref: string }[];
        narrator: { ref: string }[];
        restricted: { ref: string }[];
        default: string | null;
        problem: string | null;
      }>();
      expect(payload.free.map((m) => m.ref)).toEqual([
        "opencode/muse-spark-1.3-contributor-free",
        "opencode/space-bunny-free",
      ]);
      // The prompt-training model isn't among self-choosable ones: separation is
      // the route's point, not a list detail.
      expect(payload.narrator.map((m) => m.ref)).toEqual(["opencode/space-bunny-free"]);
      expect(payload.restricted.map((m) => m.ref)).toEqual([
        "opencode/muse-spark-1.3-contributor-free",
      ]);
      expect(payload.default).toBe("opencode/space-bunny-free");
      expect(payload.problem).toBeNull();
    } finally {
      await withBridge.close();
    }
  });

  it("models are asked to the main server, not a world's", async () => {
    // Models belong to the machine, not a campaign: asking the world server
    // would give a catalog depending on which world is open, and UI would show
    // different models per tab.
    const withBridge = await harness({ withBridge: true });
    try {
      withBridge.fake.connected = ["opencode"];
      withBridge.fake.provider = [FREE_MODEL];

      await withBridge.app.inject({ method: "GET", url: "/api/models" });
      expect(withBridge.fake.requested).toEqual([withBridge.data]);
    } finally {
      await withBridge.close();
    }
  });

  it("without connected providers tells what to do, instead of an empty list", async () => {
    // An empty list without reason suggests no free models. The reason here is
    // precise and fixable, so it comes back.
    const withBridge = await harness({ withBridge: true });
    try {
      withBridge.fake.connected = [];
      withBridge.fake.provider = [FREE_MODEL];

      const payload = (await withBridge.app.inject({ method: "GET", url: "/api/models" })).json<{
        free: unknown[];
        problem: string | null;
      }>();
      expect(payload.free).toEqual([]);
      expect(payload.problem).toContain("opencode auth login");
    } finally {
      await withBridge.close();
    }
  });

  it("a model from an unconnected provider isn't proposed", async () => {
    // The provider is in opencode config but not authenticated on this
    // machine: using it would fail at first turn, with a mid-game auth error.
    const withBridge = await harness({ withBridge: true });
    try {
      withBridge.fake.connected = [];
      withBridge.fake.provider = [FREE_MODEL];

      const payload = (await withBridge.app.inject({ method: "GET", url: "/api/models" })).json<{
        free: unknown[];
      }>();
      expect(payload.free).toEqual([]);
    } finally {
      await withBridge.close();
    }
  });
});
