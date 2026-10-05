import type { OpencodeClient, SessionPromptData } from "@opencode-ai/sdk";
import { isRecord } from "./bridge.js";
import { call } from "./client.js";
import { splitRef } from "./context.js";
import type { EventSubscription, Narrator, NarratorPrompt, StoredMessage } from "./narrator.js";
import {
  createSession,
  deleteSession,
  joinTextParts,
  readMessages,
  subscribeEvents,
} from "./session.js";

/**
 * The real narrator: the opencode client dressed up as a `Narrator`.
 *
 * It is the **only** place in the server where the shape of an opencode request
 * appears inside the narrator's surface. Everything below it — the session, the
 * context, the chapters — calls this object and does not know what is behind
 * it, so an SDK version bump stops here instead of arriving as a compile error
 * far from the cause.
 *
 * The helpers that were there before (`createSession`, `readMessages`,
 * `subscribeEvents`) stay where they were and are delegated to: this file does
 * not rewrite the way the provider is talked to, it puts a contract in front of
 * it.
 */
export class OpencodeNarrator implements Narrator {
  readonly #client: OpencodeClient;

  constructor(client: OpencodeClient) {
    this.#client = client;
  }

  async contextLimit(modelRef: string): Promise<number | null> {
    const result = await call<unknown>(() => this.#client.config.providers());
    if (!isRecord(result) || !Array.isArray(result["providers"])) return null;

    for (const provider of result["providers"]) {
      if (!isRecord(provider)) continue;
      const providerId = provider["id"];
      if (typeof providerId !== "string") continue;
      const models = provider["models"];
      if (!isRecord(models)) continue;

      const { modelId } = splitRef(modelRef);
      const model = models[modelId];
      if (!isRecord(model)) continue;

      const limit = model["limit"];
      if (!isRecord(limit)) continue;
      const context = limit["context"];
      if (typeof context === "number" && context > 0) return context;
    }

    return null;
  }

  createSession(title: string): Promise<string> {
    return createSession(this.#client, title);
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    try {
      const result = await call<unknown>(() =>
        this.#client.session.get({ path: { id: sessionId } }),
      );
      return result !== null && result !== undefined;
    } catch {
      return false;
    }
  }

  async prompt(sessionId: string, request: NarratorPrompt): Promise<string> {
    const body = this.#body(request);

    if (request.delivery === "fire-and-forget") {
      await call(() => this.#client.session.promptAsync({ path: { id: sessionId }, body }));
      return "";
    }

    const result = await call<{ parts?: unknown } | undefined>(() =>
      this.#client.session.prompt({ path: { id: sessionId }, body }),
    );
    if (request.delivery === "no-reply") return "";
    return joinTextParts(result?.parts);
  }

  messages(sessionId: string): Promise<StoredMessage[]> {
    return readMessages(this.#client, sessionId);
  }

  events(): Promise<EventSubscription> {
    return subscribeEvents(this.#client);
  }

  abort(sessionId: string): Promise<void> {
    return call(() => this.#client.session.abort({ path: { id: sessionId } }));
  }

  truncateTo(sessionId: string, messageId: string): Promise<void> {
    return call(() =>
      this.#client.session.revert({ path: { id: sessionId }, body: { messageID: messageId } }),
    );
  }

  closeSession(sessionId: string): Promise<void> {
    return deleteSession(this.#client, sessionId);
  }

  /**
   * The request body, built only with the fields the caller asked for: a prompt
   * without a model uses the session's one, and a prompt without an agent does
   * not pick one.
   */
  #body(request: NarratorPrompt): SessionPromptData["body"] {
    const model = request.modelRef === undefined ? undefined : splitRef(request.modelRef);
    return {
      ...(request.agent === undefined ? {} : { agent: request.agent }),
      ...(model === undefined
        ? {}
        : { model: { providerID: model.providerId, modelID: model.modelId } }),
      ...(request.delivery === "no-reply" ? { noReply: true } : {}),
      parts: [{ type: "text", text: request.text }],
    };
  }
}

/**
 * The narrator for an opencode client.
 *
 * Call it where you have a client and need a narrator. It is a function and not
 * a `new` for callers that do not need to hold the reference: the adapter is
 * stateless, and creating it twice costs nothing.
 */
export function narratorFor(client: OpencodeClient): Narrator {
  return new OpencodeNarrator(client);
}
