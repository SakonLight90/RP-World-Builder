/*
 * The project's log, as one object the whole server uses.
 *
 * A local application has one user who cannot send a log file anywhere, so the log has to
 * say **what happened**, not only that something did.
 *
 * - One line per event, and a sentence where a stack trace would do: frames describe the
 *   code, "opencode did not answer in 30s for world Fallout" says what to do.
 * - The world id is in the line whenever there is one: a bug report without a campaign
 *   attached is the least useful shape.
 * - Timestamps are ISO and UTC, so a log read across a daylight-saving change keeps its
 *   order.
 *
 * The level comes from the environment and defaults to `warn`. `RPWB_LOG_LEVEL=info` is how
 * somebody reads what the narrator is doing.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/** Above this, in one field. A log line has to stay a line. */
const MAX_VALUE = 400;

function truncate(value: unknown): string {
  const text = typeof value === "string" ? value : safeStringify(value);
  // Newlines are replaced, not only cut: a value containing one turns a single event into two
  // lines for every reader that assumes one event per line.
  const flat = text.replace(/\r?\n/g, "\\n");
  return flat.length > MAX_VALUE ? `${flat.slice(0, MAX_VALUE)}…` : flat;
}

/**
 * A value rendered as JSON, or as its own text when it cannot be.
 *
 * `JSON.stringify` throws on a circular structure and a `BigInt`, and a logger that throws
 * while describing a failure removes the only record of it.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unprintable]";
    }
  }
}

/** `extra` as a `key=value` tail, sorted so two identical events read identically. */
function fields(extra: Record<string, unknown> | undefined): string {
  if (extra === undefined) return "";
  const entries = Object.entries(extra)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${truncate(value)}`);
  return entries.length === 0 ? "" : ` ${entries.join(" ")}`;
}

export interface LogFields {
  /** The campaign an event belongs to. Present on most lines. */
  worldId?: string;
  /** The turn an event belongs to, when there is one. */
  turnId?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, event: string, extra?: LogFields): void {
  if (!isEnabled(level)) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${event}${fields(extra)}`;
  // Warnings and errors on stderr, the rest on stdout: a script reading normal output should
  // not find a failure in the middle of it.
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

let threshold: LogLevel = "warn";

function isEnabled(level: LogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(threshold);
}

/**
 * Reads the level once, from the environment.
 *
 * An unknown value falls back to `warn` rather than throwing: a typo must not stop the
 * application from starting, and the quiet default makes the consequence no extra output.
 */
export function configureLogLevel(
  value: string | undefined = process.env["RPWB_LOG_LEVEL"],
): LogLevel {
  const raw = (value ?? "").trim().toLowerCase();
  const found = LEVELS.find((level) => level === raw);
  threshold = found ?? "warn";
  return threshold;
}

export const log = {
  debug: (event: string, extra?: LogFields) => emit("debug", event, extra),
  info: (event: string, extra?: LogFields) => emit("info", event, extra),
  warn: (event: string, extra?: LogFields) => emit("warn", event, extra),
  error: (event: string, extra?: LogFields) => emit("error", event, extra),
};

/**
 * A value worth putting in the log, or `undefined`.
 *
 * For the error a route is about to answer with: the client gets the sentence, the log gets
 * the cause. `"unknown"` is deliberately not used — an error with no message differs from
 * one with an empty message, and the log says which.
 */
export function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message === "" ? error.name : `${error.name}: ${error.message}`;
  }
  if (typeof error === "string") return error === "" ? "empty string" : error;
  if (error === null || error === undefined) return undefined;
  return truncate(error);
}
