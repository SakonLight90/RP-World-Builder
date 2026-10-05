import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_LOCALES } from "../src/i18n/index";
import { ApiError, api, explainError } from "../src/lib/api";

/**
 * What the interface does with an error the API reported.
 *
 * The server sends a code so this file can translate it, and that translation is
 * the whole reason the code exists: a `problem` sentence arriving in English is
 * a sentence an Italian, Spanish, French or German reader cannot use. These
 * tests stand where a reader stands — a fetch that fails, a body that arrives,
 * a language chosen — because every layer between them is a place the code could
 * be dropped without anything failing to compile.
 */

/** Answers every request with one canned response, and records what was asked. */
function respondWith(status: number, body: unknown): { asked: string[] } {
  const asked: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    asked.push(String(input));
    return Promise.resolve(
      new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { asked };
}

/** Fails the way a dead server does: the promise rejects, not the response. */
function failTheNetwork(message: string): void {
  vi.stubGlobal("fetch", () => Promise.reject(new TypeError(message)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * What goes on the wire.
 *
 * Regression: `request` set `content-type: application/json` on every call,
 * including the ones with no body. Fastify answers that with
 * `FST_ERR_CTP_EMPTY_JSON_BODY`, so every bodiless DELETE — deleting a world, a
 * chapter, an arc, a canon entry — failed with a bare 400 before its route was
 * ever reached. The message the user saw was "Request failed with status 400",
 * which says nothing, so this stayed broken through several unrelated fixes.
 */
describe("the request it puts on the wire", () => {
  /** Records the init of the last call, so the headers can be inspected. */
  function capture(): { init?: RequestInit } {
    const seen: { init?: RequestInit } = {};
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.init = init;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    return seen;
  }

  it("sends no content-type when there is no body", async () => {
    const seen = capture();

    await api.deleteWorld("w1").catch(() => undefined);

    expect(seen.init?.method).toBe("DELETE");
    expect(seen.init?.body).toBeUndefined();
    const headers = (seen.init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBeUndefined();
  });

  it("sends content-type when there is a body", async () => {
    const seen = capture();

    await api.updateWorld("w1", { name: "Altra" }).catch(() => undefined);

    expect(seen.init?.body).not.toBeUndefined();
    const headers = (seen.init?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });

  it("keeps sending no-store, so a read is never cached", async () => {
    const seen = capture();

    await api.worlds().catch(() => undefined);

    expect(seen.init?.cache).toBe("no-store");
  });
});

describe("an error the API reported", () => {
  it("keeps the code, the sentence and the values", async () => {
    respondWith(404, { code: "world.notFound", problem: "World not found" });

    const error = await api.settings().catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ApiError);
    const problem = error as ApiError;
    expect(problem.code).toBe("world.notFound");
    expect(problem.status).toBe(404);
    expect(problem.message).toBe("World not found");
  });

  it("is translated, not shown in the server's English", async () => {
    respondWith(404, { code: "world.notFound", problem: "World not found" });
    const error = await api.settings().catch((failure: unknown) => failure);

    const sentences = UI_LOCALES.map((locale) => explainError(error, locale));
    const english = "World not found";

    // Four of the five must not be the English sentence. The fifth may be:
    // English is the fallback language, so one catalog legitimately repeats it.
    const nonEnglish = sentences.filter((sentence) => sentence !== english);
    expect(nonEnglish.length).toBeGreaterThanOrEqual(4);
    // And they must be four different languages, not one string repeated.
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("fills the placeholders the server sent", async () => {
    respondWith(409, {
      code: "arc.hasChapters",
      problem: "The arc contains 12 chapters: the chapters would be left without an arc.",
      params: { count: 12 },
    });
    const error = await api.settings().catch((failure: unknown) => failure);

    for (const locale of UI_LOCALES) {
      expect(explainError(error, locale)).toContain("12");
    }
  });

  it("a code it does not know falls back to the server's sentence", async () => {
    // A newer server, an older interface. The code cannot be translated because
    // no sentence exists for it, but the English one it sent is still better
    // than nothing, and the point of keeping `problem` is exactly this.
    respondWith(409, { code: "arc.somethingNew", problem: "Something the client predates." });
    const error = await api.settings().catch((failure: unknown) => failure);

    expect((error as ApiError).code).toBeUndefined();
    expect(explainError(error, "de")).toBe("Something the client predates.");
  });

  it("a sentence with no code is passed through", async () => {
    respondWith(409, { problem: "A route that still answers in prose." });
    const error = await api.settings().catch((failure: unknown) => failure);

    expect((error as ApiError).code).toBeUndefined();
    expect(explainError(error, "fr")).toBe("A route that still answers in prose.");
  });
});

describe("an error that did not come from this API", () => {
  it("a 503 with no code still gets the sentence about the narrator", async () => {
    // Something between the browser and the server answered: a proxy, a port
    // forward. There is no code to translate, so the status is what is left.
    respondWith(503, undefined);
    const error = await api.settings().catch((failure: unknown) => failure);

    expect((error as ApiError).code).toBeUndefined();
    expect(explainError(error, "it")).not.toBe("");
    expect(explainError(error, "it")).toContain("opencode");
  });

  it("a dead server becomes a sentence that says what to try", async () => {
    failTheNetwork("Failed to fetch");
    const error = await api.settings().catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);

    for (const locale of UI_LOCALES) {
      const sentence = explainError(error, locale);
      expect(sentence).not.toContain("{{");
      // The cause travels with it, or the sentence would not say what failed.
      expect(sentence).toContain("Failed to fetch");
    }
  });

  it("an empty body with an error status names the status", async () => {
    respondWith(500, undefined);
    const error = await api.settings().catch((failure: unknown) => failure);

    expect((error as ApiError).code).toBeUndefined();
    for (const locale of UI_LOCALES) {
      expect(explainError(error, locale)).toContain("500");
    }
  });
});

describe("an error that is not an error", () => {
  it("a thrown string is still readable", () => {
    // Not an ApiError, so nothing is translated and nothing is lost: the rule
    // is that an unknown failure shows what it is, not that it shows English.
    expect(explainError("something odd", "it")).toBe("something odd");
  });

  it("a plain Error keeps its own message", () => {
    expect(explainError(new Error("boom"), "de")).toBe("boom");
  });
});
