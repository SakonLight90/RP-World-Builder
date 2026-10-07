import type { OpencodeClient } from "@opencode-ai/sdk";
import type { TokenUsage } from "@rpwb/shared";
import { emptyTokenUsage } from "@rpwb/shared";
import { basicAuthHeader, readServerCredentials } from "./auth.js";
import { isRecord } from "./bridge.js";
import { call } from "./client.js";
import type { EventSubscription, StoredMessage } from "./narrator.js";

/*
 * The type describing **what** is read from the narrator lives in the contract, not here.
 * Re-exported only because `currentContextUsage` mentions it and readers look for it here.
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
 * Passed by hand: the SDK's SSE client calls the global `fetch` instead of the one the client
 * was given, so the header never reaches `/event`.
 *
 * A 401 on the stream is invisible: the SDK throws, backs off and retries forever, so no event
 * and no error arrive.
 */
function streamAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const credentials = readServerCredentials(env);
  return credentials === null ? {} : { authorization: basicAuthHeader(credentials) };
}

/**
 * A subscription that closes when asked.
 *
 * The point is being able to **stop**: on a failed connection the SDK generator retries with no
 * `yield`, and `return()` on an async generator takes effect only at a `yield`, so asking it to
 * return there never settles. Closing goes through the `AbortController` instead.
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
    // Said out loud instead of retried quietly: a stream that never starts is a reason a
    // turn cannot end, and the player must be able to read it.
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

        // SSE: one `data:` block per event, split by an empty line. A block without `data:` is a
        // keep-alive to ignore.
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
 * The address of the opencode server.
 *
 * Not exposed by the SDK and read from the client: the event stream bypasses the client's `fetch`
 * and needs the address to open `/event`.
 */
function clientBaseUrl(client: OpencodeClient): string {
  const url = readClientUrl(client);
  if (url === null) {
    throw new Error("I don't know which opencode server this client belongs to");
  }
  return url;
}

/**
 * Looks up `baseUrl` inside the client.
 *
 * `getConfig()` is the live configuration; `_config` is an internal path no narrator is built on.
 * When neither is there the turn fails with a readable reason instead of hanging.
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
 * opencode has no delete-message call and `session.revert` is no eraser: it answers without error
 * and leaves the messages in place. So nothing is faked — the id to keep is returned and the
 * caller decides how much to cut.
 *
 * The rule holds for every caller: a deleted message is gone, never two.
 */
export async function dropLastMessage(
  client: OpencodeClient,
  sessionId: string,
  visible: number,
  kept: number,
): Promise<{ kept: number; removed: number }> {
  if (visible <= 0) return { kept, removed: 0 };

  // A lone message starts the campaign: without it there is nothing to restart from.
  if (visible === 1) {
    throw new Error("This is the first message of the history: it cannot be deleted.");
  }

  const next = kept < 0 ? visible - 1 : Math.min(kept, visible) - 1;
  const finalKept = Math.max(1, next);

  // opencode is told anyway: it may use it to ignore truncation when building the next turn
  // context. It does not delete, so the result does not depend on this call.
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
 * Not a sum: the last assistant message's input already holds the whole piled-up context, so it
 * is the measure of how full the window is.
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
