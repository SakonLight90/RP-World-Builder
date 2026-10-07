import type { OpencodeClient } from "@opencode-ai/sdk";
import type { ModelCatalog } from "./models.js";
import { readModelCatalog } from "./models.js";

/**
 * One catalogue read, shared by whoever asks.
 *
 * The model catalogue comes from opencode with `config.providers()`, and it was read
 * once per request. That is a cost here and not only a latency one: opening a campaign
 * asks for the world, the health and the cast, and both the health report and
 * `/api/models` read the same catalogue. Each of those is a request to a provider
 * process, and a provider that is slow or rate-limited makes the page slow for reasons
 * that have nothing to do with what the page asked.
 *
 * **An instance and not a module-level variable**, and that is the decision worth
 * explaining. There is one bridge in production, so a global would do — and a global
 * is exactly what made the tests order-dependent: one harness's answer was still in
 * place when the next harness, with its own fake bridge, asked, and every test after
 * the first saw the wrong provider's models. Owning the cache per bridge means a second
 * bridge gets a second cache, which is right in production too if a second one ever
 * exists.
 *
 * What is kept is the **promise**, not the value. Two requests arriving together must
 * produce one call; storing the value would let the second find nothing stored yet and
 * make its own, which is the page being exactly as slow as it was before the cache.
 */

/** How long an answer is reused. Short enough that a new provider is seen quickly. */
const LIFETIME_MS = 5_000;

export class CatalogCache {
  readonly #clientFor: () => OpencodeClient;
  readonly #lifetimeMs: number;
  #entry: { promise: Promise<ModelCatalog>; at: number } | null = null;

  constructor(clientFor: () => OpencodeClient, lifetimeMs: number = LIFETIME_MS) {
    this.#clientFor = clientFor;
    this.#lifetimeMs = lifetimeMs;
  }

  async get(now: () => number = Date.now): Promise<ModelCatalog> {
    const current = this.#entry;
    if (current !== null && now() - current.at < this.#lifetimeMs) return current.promise;

    const promise = readModelCatalog(this.#clientFor());
    this.#entry = { promise, at: now() };

    /*
     * A read that did not succeed is not remembered, and "did not succeed" is a field
     * and not an exception.
     *
     * `readModelCatalog` swallows the provider's failure and answers with an empty
     * catalogue carrying a `problem`, so a `catch` on the promise never fires. Caching
     * on the promise alone would keep "opencode is down" for the whole lifetime — the
     * wrong way round, because the moments when the provider is starting and coming
     * back are exactly the moments somebody is watching the page for it to work.
     */
    const forget = (): void => {
      if (this.#entry !== null && this.#entry.promise === promise) this.#entry = null;
    };
    promise.then(
      (catalog) => {
        if (catalog.problem !== null) forget();
      },
      () => forget(),
    );

    return promise;
  }

  /** Forgets the answer, so the next reader asks opencode again. */
  invalidate(): void {
    this.#entry = null;
  }
}
