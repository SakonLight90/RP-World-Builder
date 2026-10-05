import { describe, expect, it } from "vitest";
import { askJson } from "../src/opencode/ask.js";
import type {
  EventSubscription,
  Narrator,
  NarratorPrompt,
  StoredMessage,
} from "../src/opencode/narrator.js";

/**
 * A narrator recording what it's asked and returning a fixed response. Proves
 * `askJson` doesn't need opencode: if it did, this file couldn't exist.
 */
class FakeNarrator implements Narrator {
  readonly opened: string[] = [];
  readonly closed: string[] = [];
  readonly requested: NarratorPrompt[] = [];
  #next = 1;

  constructor(
    private readonly response: string,
    private readonly behavior:
      | "ok"
      | "throw-on-prompt"
      | "throw-on-create"
      | "fail-on-close" = "ok",
  ) {}

  async contextLimit(): Promise<number | null> {
    return null;
  }

  async createSession(_title: string): Promise<string> {
    if (this.behavior === "throw-on-create") throw new Error("non posso creare la sessione");
    const id = `sessione-${this.#next++}`;
    this.opened.push(id);
    return id;
  }

  async sessionExists(): Promise<boolean> {
    return true;
  }

  async prompt(_sessionId: string, request: NarratorPrompt): Promise<string> {
    this.requested.push(request);
    if (this.behavior === "throw-on-prompt") throw new Error("prompt fallito");
    return this.response;
  }

  async messages(): Promise<StoredMessage[]> {
    return [];
  }

  async events(): Promise<EventSubscription> {
    return {
      events: (async function* () {
        // Empty feed: `askJson` doesn't read events, and a generator yielding
        // nothing ends immediately without blocking the test.
      })(),
      close: () => undefined,
    };
  }

  async abort(): Promise<void> {}

  async truncateTo(): Promise<void> {}

  async closeSession(sessionId: string): Promise<void> {
    if (this.behavior === "fail-on-close") throw new Error("chiusura fallita");
    this.closed.push(sessionId);
  }
}

describe("askJson", () => {
  it("closes the session even when the response has no JSON", async () => {
    // This case comes first because it's the defect this helper
    // eliminates: a session left open after a format error stays in
    // `config.json` and shows up in memory at next boot as garbage.
    const fake = new FakeNarrator("Mi dispiace, non sono riuscito a rispondere in JSON.");

    const outcome = await askJson(fake, {
      sessionTitle: "prova",
      modelRef: "provider/modello",
      text: "rispondi",
    });

    expect(outcome).toBeNull();
    expect(fake.closed).toEqual(fake.opened);
  });

  it("closes the session even when the prompt fails", async () => {
    const fake = new FakeNarrator("", "throw-on-prompt");

    const outcome = await askJson(fake, {
      sessionTitle: "prova",
      modelRef: "provider/modello",
      text: "rispondi",
    });

    expect(outcome).toBeNull();
    expect(fake.closed).toEqual(fake.opened);
  });

  it("closes the session even when creation fails", async () => {
    const fake = new FakeNarrator("{}", "throw-on-create");

    const outcome = await askJson(fake, {
      sessionTitle: "prova",
      modelRef: "provider/modello",
      text: "rispondi",
    });

    expect(outcome).toBeNull();
    // Nothing to close: the session never existed.
    expect(fake.opened).toEqual([]);
    expect(fake.closed).toEqual([]);
  });

  it("extracts the object from a code block with prose around it", async () => {
    const fake = new FakeNarrator(
      'Ecco il risultato:\n```json\n{"title":"Morganthown","spine":"x"}\n```\nfine.',
    );

    const outcome = await askJson(fake, {
      sessionTitle: "prova",
      modelRef: "provider/modello",
      text: "rispondi",
    });

    expect(outcome).toEqual({ title: "Morganthown", spine: "x" });
    expect(fake.closed).toEqual(fake.opened);
  });

  it("rejects JSON that is not an object", async () => {
    // A schema like ArcSpineSchema expects fields: receiving a list or a
    // number would produce an object with empty fields, which would sometimes
    // pass validation and become a half-hour spine.
    for (const response of ['["a","b"]', "42", '"testo"', "null"]) {
      const fake = new FakeNarrator(response);
      const outcome = await askJson(fake, {
        sessionTitle: "prova",
        modelRef: "provider/modello",
        text: "rispondi",
      });
      expect(outcome, `risposta: ${response}`).toBeNull();
      expect(fake.closed).toEqual(fake.opened);
    }
  });

  it("a close error doesn't replace the result already obtained", async () => {
    // Close is cleanup, not outcome: if it fails it must stay silent, otherwise
    // a network error on delete would turn a valid response into a
    // "no JSON" and the chapter would be lost.
    const fake = new FakeNarrator('{"title":"ok"}', "fail-on-close");

    const outcome = await askJson(fake, {
      sessionTitle: "prova",
      modelRef: "provider/modello",
      text: "rispondi",
    });

    expect(outcome).toEqual({ title: "ok" });
  });

  it("passes the received model and text to the narrator", async () => {
    const fake = new FakeNarrator('{"a":1}');

    await askJson(fake, {
      sessionTitle: "spina arco 3",
      modelRef: "provider/modello-locale",
      text: "comprimi questi capitoli",
    });

    expect(fake.requested).toHaveLength(1);
    expect(fake.requested[0]?.modelRef).toBe("provider/modello-locale");
    expect(fake.requested[0]?.text).toBe("comprimi questi capitoli");
  });
});
