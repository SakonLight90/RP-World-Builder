import type { TokenUsage } from "@rpwb/shared";

/**
 * The narrator, seen from the outside.
 *
 * It is the **contract** of the orchestration: everything `turns/` and `canon/`
 * can do with the model is here, and nothing more. No SDK type, no endpoint, no
 * request shape: whoever implements this object is not talking to opencode, they
 * are narrating. That is what makes the narrator replaceable: hand a `Narrator`
 * from a twenty-line class and the pipeline runs without knowing who answered,
 * and an SDK version bump stays inside the adapter instead of arriving as a
 * compile error in twelve files.
 *
 * Every method has a caller, and the return types are project types: whoever
 * reads the history receives `StoredMessage`, not the provider's raw message.
 */

/**
 * A message of the session, reduced to what the server actually reads.
 *
 * Joined part text, tokens and id. Nothing else: the rest of the message shape
 * is a provider detail, and having it here would mean whoever reads the history
 * has to know how it is built.
 */
export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  /** Text of the text parts, for the roles that have them. */
  text: string;
  /** `null` if the provider did not declare the tokens for that message. */
  usage: TokenUsage | null;
  createdAt: number;
}

/**
 * The narrator's stream of progress, and the way to close it.
 *
 * `close` is here, and it is not a detail: the point is not receiving the
 * events, which the provider knows how to send, it is **being able to stop**. A
 * subscription that is never closed keeps the connection alive until the
 * provider does it, and every turn would leave a hanging stream.
 */
export interface EventSubscription {
  /** Event feed, already filtered to the sessions that concern us. */
  events: AsyncIterable<unknown>;
  /** Closes the stream. After this call `events` really closes. */
  close: () => void;
}

/**
 * What is expected from a prompt.
 *
 * There are three modes and not one for a precise reason: they are three
 * different timings of the same operation, and confusing them would break the
 * turn. The context and the carryover must be **written and done**, the player's
 * action must **leave without waiting** (the answer arrives through the events),
 * and the chronicler, the spine and the reviewer **wait** for the text in order
 * to read it.
 */
export type PromptDelivery = "reply" | "no-reply" | "fire-and-forget";

/** A prompt to send to the narrator, in the project's terms. */
export interface NarratorPrompt {
  /** The text to send, markers included. */
  text: string;
  /** `provider/model`, as written on the world. If missing, uses the session's one. */
  modelRef?: string;
  /** Agent to use. It is for the narrator, which has no tools. */
  agent?: string;
  /** What is expected from this prompt. If missing, the answer. */
  delivery?: PromptDelivery;
}

export interface Narrator {
  /**
   * The context window the provider declares for that model.
   *
   * `null` when it does not declare one: the window is not written in config
   * because free models come and go, and whoever calls knows what to do with a
   * `null` (see `contextLimitFor`). Do not throw for a missing datum: it is an
   * answer, not an error.
   */
  contextLimit(modelRef: string): Promise<number | null>;

  /** Opens a conversation session and returns its id. */
  createSession(title: string): Promise<string>;

  /** The session still exists, and so it is legitimate to resume it. */
  sessionExists(sessionId: string): Promise<boolean>;

  /**
   * Sends a prompt and reports what happened.
   *
   * With `delivery: "reply"` it waits for the narration and returns the text;
   * with the other two it returns an empty string, because the text is not the
   * result of the call. A provider error is thrown: no caller should have to
   * tell "it did not write" from "it went wrong".
   */
  prompt(sessionId: string, request: NarratorPrompt): Promise<string>;

  /** The session's history, in the order it was written. */
  messages(sessionId: string): Promise<StoredMessage[]>;

  /**
   * Subscribes to the narrator's events.
   *
   * It has to be opened **before** the prompt: subscribed afterwards, the
   * narrator may already be done and the event that closes the turn has passed
   * with nobody listening.
   */
  events(): Promise<EventSubscription>;

  /** Interrupts the work the narrator is doing on that session. */
  abort(sessionId: string): Promise<void>;

  /**
   * Truncates the session to a message.
   *
   * It has to be checked with `messages`: a truncation that does not reduce
   * anything counts as an error, and the caller decides what to do after having
   * measured it.
   */
  truncateTo(sessionId: string, messageId: string): Promise<void>;

  /** Closes the session and takes its data away. */
  closeSession(sessionId: string): Promise<void>;
}
