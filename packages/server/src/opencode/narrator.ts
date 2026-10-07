import type { TokenUsage } from "@rpwb/shared";
import type { ModelCatalog } from "./models.js";

/*
 * The narrator, seen from the outside: the **contract** of the orchestration. Everything
 * `turns/` and `canon/` can do with the model is here, and nothing more — no SDK type, no
 * endpoint, no request shape.
 *
 * That is what makes it replaceable: the pipeline runs without knowing who answered, and an
 * SDK change stays inside the adapter.
 *
 * Every method has a caller and the return types are project types: whoever reads the history
 * receives `StoredMessage`, not the provider's raw message.
 */

/** A message of the session, reduced to what the server reads. */
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
 * `close` is the point: a subscription never closed keeps the connection alive.
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
 * Three timings of the same operation: context and carryover are written and done, the player's
 * action leaves without waiting (the answer arrives through the events), and the short
 * background jobs wait for the text in order to read it.
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
   * The context window the provider declares for a model, or `null` when it declares none.
   * A missing datum is an answer, not an error.
   */
  contextLimit(modelRef: string): Promise<number | null>;

  /**
   * The model catalogue, with its prices.
   *
   * On the narrator so there is one way to ask the provider: a cost computed from a different
   * read than the settings screen shows would disagree with the price list.
   */
  models(): Promise<ModelCatalog>;

  /** Opens a conversation session and returns its id. */
  createSession(title: string): Promise<string>;

  /** The session still exists, and so it is legitimate to resume it. */
  sessionExists(sessionId: string): Promise<boolean>;

  /**
   * Sends a prompt and reports what happened.
   *
   * With `delivery: "reply"` it waits and returns the text; with the other two it returns an
   * empty string, because the text is not the result of the call. A provider error is thrown:
   * no caller should have to tell "it did not write" from "it went wrong".
   */
  prompt(sessionId: string, request: NarratorPrompt): Promise<string>;

  /** The session's history, in the order it was written. */
  messages(sessionId: string): Promise<StoredMessage[]>;

  /**
   * Subscribes to the narrator's events.
   *
   * Must be opened **before** the prompt: subscribed afterwards, the event closing the turn may
   * have passed unheard.
   */
  events(): Promise<EventSubscription>;

  /** Interrupts the work the narrator is doing on that session. */
  abort(sessionId: string): Promise<void>;

  /**
   * Truncates the session to a message.
   *
   * To be checked with `messages`: a truncation that reduces nothing is an error, and the caller
   * decides what to do after measuring it.
   */
  truncateTo(sessionId: string, messageId: string): Promise<void>;

  /** Closes the session and takes its data away. */
  closeSession(sessionId: string): Promise<void>;
}
