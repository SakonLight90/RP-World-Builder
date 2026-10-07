import type { OpencodeClient } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { CatalogCache } from "../src/opencode/catalog-cache.js";

/**
 * One catalogue read, shared.
 *
 * The point of this module is not speed. It is that opening a campaign asks opencode for
 * the world, the health and the cast at once, and two of those read the same model
 * catalogue. Each read is a request to a provider process, and the cost appears as a
 * page that is slow for reasons that have nothing to do with what it asked for.
 *
 * What is worth testing is the **shape** of the sharing, and there is one way it can
 * silently not work: caching the resolved value instead of the promise. Then two
 * requests arriving together still make two calls, the second waiting behind the first,
 * and the page is exactly as slow as it was before the cache existed. So the concurrent
 * case is the one that matters, and it is counted in calls to `config.providers()` —
 * one per catalogue read, which is the number this module exists to keep at one.
 *
 * A fresh cache per test, rather than a reset: the cache belongs to the bridge, and two
 * tests with two fakes are two bridges. That is also why the cache is not a module
 * variable — as a global it made every test after the first see the first one's answer.
 */

interface Harness {
  client: OpencodeClient;
  /** How many times `config.providers()` was really called. */
  calls: () => number;
  /** Makes the next read fail, the way a restarting opencode does. */
  failNext: () => void;
}

function harness(): Harness {
  let calls = 0;
  let failing = false;
  const providers = async (): Promise<unknown> => {
    calls++;
    if (failing) {
      failing = false;
      throw new Error("opencode is not up");
    }
    return {
      providers: [
        {
          id: "opencode",
          models: {
            "test-model": {
              name: "Test",
              cost: { input: 0, output: 0 },
              limit: { context: 32_000 },
            },
          },
        },
      ],
    };
  };
  const client = {
    provider: { list: async () => ({ connected: ["opencode"] }) },
    config: { providers },
  } as unknown as OpencodeClient;
  return { client, calls: () => calls, failNext: () => (failing = true) };
}

describe("the catalogue cache", () => {
  it("answers with the catalogue", async () => {
    const { client } = harness();
    const catalog = await new CatalogCache(() => client).get();
    expect(catalog.all[0]?.ref).toBe("opencode/test-model");
    expect(catalog.all[0]?.contextLimit).toBe(32_000);
  });

  it("two readers in a row cost one read", async () => {
    const { client, calls } = harness();
    const cache = new CatalogCache(() => client);

    await cache.get();
    await cache.get();

    expect(calls(), "the second reader should have reused the first's answer").toBe(1);
  });

  it("two readers arriving together cost one read", async () => {
    /*
     * The case that decides how the cache is written.
     *
     * Both callers start before either has an answer. Caching the resolved value would
     * find nothing stored yet and start a second call, so the page would pay twice
     * while the cache appeared to be working. Storing the promise is what collapses
     * them, and this is the test that would fail without it.
     */
    const { client, calls } = harness();
    const cache = new CatalogCache(() => client);

    await Promise.all([cache.get(), cache.get()]);

    expect(calls(), "concurrent readers must share one call").toBe(1);
  });

  it("three concurrent readers still cost one read", async () => {
    // The real page load is closer to this: world, health and cast at once.
    const { client, calls } = harness();
    const cache = new CatalogCache(() => client);

    await Promise.all([cache.get(), cache.get(), cache.get()]);

    expect(calls()).toBe(1);
  });

  it("reads again once the entry is old", async () => {
    // The clock is passed in so the five seconds are not waited for, and so the test is
    // about the expiry rather than about how long somebody was willing to wait.
    const { client, calls } = harness();
    const cache = new CatalogCache(() => client);
    let clock = 1_000_000;
    const now = (): number => clock;

    await cache.get(now);
    clock += 1_000;
    await cache.get(now);
    expect(calls(), "still inside the lifetime").toBe(1);

    clock += 60_000;
    await cache.get(now);
    expect(calls(), "past the lifetime").toBe(2);
  });

  it("does not remember a failed read", async () => {
    /*
     * opencode is down, or restarting. Holding that answer for the lifetime keeps the
     * interface saying "no models" after the provider came back — which is exactly when
     * somebody is watching the page for it to work.
     *
     * The failure arrives as a `problem` field on an empty catalogue and not as an
     * exception, so this only passes because the cache checks the answer it got.
     */
    const { client, calls, failNext } = harness();
    const cache = new CatalogCache(() => client);

    failNext();
    await cache.get();
    await cache.get();

    expect(calls(), "a failure must not be cached").toBe(2);
  });

  it("forgets on demand", async () => {
    const { client, calls } = harness();
    const cache = new CatalogCache(() => client);

    await cache.get();
    cache.invalidate();
    await cache.get();

    expect(calls()).toBe(2);
  });

  it("two caches do not see each other", async () => {
    // What a module-level variable would have got wrong, stated as a test: the second
    // harness has its own bridge, so it must ask its own bridge.
    const first = harness();
    const second = harness();

    await new CatalogCache(() => first.client).get();
    const catalog = await new CatalogCache(() => second.client).get();

    expect(second.calls(), "the second bridge was never asked").toBe(1);
    expect(catalog.all[0]?.ref).toBe("opencode/test-model");
  });
});
