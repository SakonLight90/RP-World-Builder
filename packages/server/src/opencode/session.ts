import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TokenUsage } from "@rpwb/shared";
import { emptyTokenUsage } from "@rpwb/shared";
import { basicAuthHeader, readServerCredentials } from "./auth.js";
import { isRecord } from "./bridge.js";
import { call } from "./client.js";
import type { EventSubscription, StoredMessage } from "./narrator.js";

/**
 * The type describing **what** is read from the narrator lives in the contract, not
 * here: this module talks to opencode, and a type describing a history
 * has no reason to know where it comes from.
 *
 * It is re-exported for the single reason that `currentContextUsage`
 * mentions it and readers look for it right here. If the path
 * changes, it changes in one place without touching the types.
 */
export type { StoredMessage } from "./narrator.js";

export async function createSession(client: OpencodeClient, title: string): Promise<string> {
  const result = await call<unknown>(() => client.session.create({ body: { title } }));
  if (!isRecord(result) || typeof result["id"] !== "string") {
    throw new Error("opencode did not return a session id");
  }
  return result["id"];
}

/**
 * Headers the event stream must present for authentication.
 *
 * They copy the ones `makeFetch` adds to every other request, but
 * placed here for one precise, verified reason: **the SDK `createSseClient` does not
 * use the `fetch` handed to the client**, it calls the global one directly
 * (`node_modules/@opencode-ai/sdk/dist/gen/core/serverSentEvents.gen.js`, line
 * `const response = await fetch(url, ...)`). So the header `makeFetch`
 * adds never reaches `/event`, and on a server with
 * `OPENCODE_SERVER_PASSWORD` the answer is `401`.
 *
 * And a `401` on the stream is the worst possible defect, because it is invisible:
 * `createSseClient` does `if (!response.ok) throw`, the `catch` backs off and
 * **retries forever**. No event and no error arrive: the
 * generator looks alive and yields nothing. The header must be passed by hand.
 */
function streamAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const credentials = readServerCredentials(env);
  return credentials === null ? {} : { authorization: basicAuthHeader(credentials) };
}

/**
 * Subscription to opencode events that closes when asked.
 *
 * The point here is not receiving events, which the SDK can do, it is **being able
 * to stop**. The SDK generator, when the connection fails, spends its
 * life between `await sleep(backoff)` and another failing `fetch`: a loop
 * with no `yield`, and on an async generator `return()` does not apply
 * until a suspension point that is a `yield` arrives. Asking
 * `iterator.return()` of a generator in that loop means waiting
 * forever: measured, `return()` did not settle after 20 seconds.
 *
 * Below sits an `AbortController` owned by the caller, so
 * closing does not go through `return()` but through an explicit abort, which closes the
 * connection and ends the generator at once. Measured: 2 ms.
 */
export async function subscribeEvents(client: OpencodeClient): Promise<EventSubscription> {
  const controller = new AbortController();
  const headers = streamAuthHeaders();
  const url = clientBaseUrl(client);

  const response = await fetch(`${url}/event`, {
    headers,
    signal: controller.signal,
  });

  if (!response.ok) {
    // Here failure is said out loud instead of retried quietly:
    // a stream that never starts is a reason a turn cannot
    // end, and a reason the player must be able to read.
    throw new Error(
      `opencode did not open the event stream (HTTP ${response.status}). ` +
        "The narrator stays in the dark and the turn will be closed as failed.",
    );
  }

  if (response.body === null) {
    throw new Error("opencode opened the event stream without a body");
  }

  const source = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  async function* events(): AsyncGenerator<unknown> {
    try {
      for (;;) {
        const { done, value } = await source.read();
        if (done) return;
        buffer += value;

        // opencode sends SSE events: one `data:` block per event, split by
        // an empty line. A block without `data:` is a keep-alive to ignore.
        const blocchi = buffer.split("\n\n");
        buffer = blocchi.pop() ?? "";
        for (const blocco of blocchi) {
          const evento = eventoDaBlocco(blocco);
          if (evento !== null) yield evento;
        }
      }
    } finally {
      await source.cancel().catch(() => undefined);
    }
  }

  return {
    events: events(),
    close: () => {
      controller.abort();
      void source.cancel().catch(() => undefined);
    },
  };
}

/** The body of an SSE block, already passed through JSON when it is JSON. */
function eventoDaBlocco(blocco: string): unknown {
  const rows = blocco.split("\n");
  const data: string[] = [];
  for (const row of rows) {
    if (row.startsWith("data:")) data.push(row.replace(/^data:\s*/, ""));
  }
  if (data.length === 0) return null;
  const text = data.join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The address of the opencode server this client talks to.
 *
 * The SDK does not expose it, and it must be read from what the client was built with.
 * Needed for the event stream, which bypasses the client `fetch` and so
 * does not know it: without this address there is no way to open `/event`.
 */
function clientBaseUrl(client: OpencodeClient): string {
  const url = readClientUrl(client);
  if (url === null) {
    throw new Error("I don't know which opencode server this client belongs to");
  }
  return url;
}

/**
 * Looks up `baseUrl` inside the client, the ways the SDK really uses.
 *
 * The working path is `_client.getConfig().baseUrl`, that is the
 * live client configuration. `_config` is tried too, but it is an internal
 * path that may change release to release: no narrator
 * is built on it. When neither is there, say so, and the turn
 * fails with a readable reason instead of hanging.
 */
function readClientUrl(client: OpencodeClient): string | null {
  const daConfig = () => {
    const config = (client as unknown as Record<string, unknown>)["_client"];
    const get = isRecord(config) ? config["getConfig"] : undefined;
    if (typeof get !== "function") return null;
    const result = (get as () => unknown).call(config);
    const url = isRecord(result) ? result["baseUrl"] : undefined;
    return typeof url === "string" ? url : null;
  };

  const url = daConfig() ?? directConfigUrl(client);
  if (url === null || url === "") return null;
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function directConfigUrl(client: OpencodeClient): string | null {
  const config = (client as unknown as Record<string, unknown>)["_config"];
  const url = isRecord(config) ? config["baseUrl"] : undefined;
  return typeof url === "string" ? url : null;
}

/**
 * Deletes **one** message: only the last, and only that.
 *
 * opencode has no "delete message", and `session.revert` is no eraser: it
 * is observed to answer without errors while leaving messages in place. So
 * nothing is faked here: the **start** id of the part to keep is returned,
 * and the caller decides how much to cut and saves it.
 *
 * The reason it lives here and not in the route is that the rule is one and
 * holds for every caller: a deleted message is gone, never two.
 */
export async function dropLastMessage(
  client: OpencodeClient,
  sessionId: string,
  visible: number,
  kept: number,
): Promise<{ kept: number; removed: number }> {
  if (visible <= 0) return { kept, removed: 0 };

  // A lone message is never deleted: it starts the campaign, and without it
  // there is nothing left to restart from.
  if (visible === 1) {
    throw new Error("This is the first message of the history: it cannot be deleted.");
  }

  const next = kept < 0 ? visible - 1 : Math.min(kept, visible) - 1;
  const finalKept = Math.max(1, next);

  // opencode is told anyway: it may use it to ignore truncation when
  // building the next turn context. It does not delete, so
  // the result does not depend on this call.
  const messages = await readMessages(client, sessionId);
  const keep = messages[messages.length - 2];
  if (keep !== undefined) {
    await call(() =>
      client.session.revert({ path: { id: sessionId }, body: { messageID: keep.id } }),
    ).catch(() => undefined);
  }

  return { kept: finalKept, removed: visible - finalKept };
}

export async function deleteSession(client: OpencodeClient, sessionId: string): Promise<void> {
  await call(() => client.session.delete({ path: { id: sessionId } }));
}

export async function readMessages(
  client: OpencodeClient,
  sessionId: string,
): Promise<StoredMessage[]> {
  const result = await call<unknown>(() => client.session.messages({ path: { id: sessionId } }));
  if (!Array.isArray(result)) return [];

  const messages: StoredMessage[] = [];
  for (const entry of result) {
    if (!isRecord(entry)) continue;
    const info = entry["info"];
    const parts = entry["parts"];
    if (!isRecord(info)) continue;

    const role = info["role"];
    if (role !== "user" && role !== "assistant") continue;

    const time = isRecord(info["time"]) ? info["time"] : {};

    messages.push({
      id: typeof info["id"] === "string" ? info["id"] : "",
      role,
      text: joinTextParts(parts),
      usage: readUsage(info),
      createdAt: num(time["created"]),
    });
  }
  return messages;
}

/** The narrator writes in incremental parts, so everything is joined back. */
export function joinTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part["type"] !== "text") continue;
    if (part["ignored"] === true) continue;
    if (typeof part["text"] === "string") chunks.push(part["text"]);
  }
  return chunks.join("");
}

function readUsage(info: Record<string, unknown>): TokenUsage | null {
  const tokens = info["tokens"];
  if (!isRecord(tokens)) return null;
  const cache = isRecord(tokens["cache"]) ? tokens["cache"] : {};
  return {
    input: num(tokens["input"]),
    output: num(tokens["output"]),
    reasoning: num(tokens["reasoning"]),
    cache: { read: num(cache["read"]), write: num(cache["write"]) },
  };
}

/**
 * Current context-window usage.
 *
 * Message tokens are not summed: the last assistant
 * message input already holds all piled-up context, so it is
 * the true measure of how full the window is.
 */
export function currentContextUsage(messages: StoredMessage[]): TokenUsage {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "assistant" && message.usage) return message.usage;
  }
  return emptyTokenUsage();
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
