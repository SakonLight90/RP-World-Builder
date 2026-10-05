import { isRecord } from "./bridge.js";

/**
 * The v1 SDK does not throw: every call resolves with `{ data, error, request, response }`
 * and with `throwOnError` at `false` an error arrives as a return value.
 *
 * The docs describe a default `responseStyle: "fields"`, but the generated types
 * say the opposite, and on disagreement the runtime wins: that is why `data` is
 * unwrapped explicitly here and `error` is checked.
 */
export function unwrapData(result: unknown): unknown {
  if (!isRecord(result)) return undefined;
  if ("data" in result) return result["data"];
  return result;
}

export function unwrapError(result: unknown): string | null {
  if (!isRecord(result)) return null;
  const error = result["error"];
  if (error === undefined || error === null) return null;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    const message = error["message"];
    if (typeof message === "string") return message;
    try {
      return JSON.stringify(error);
    } catch {
      return "non-serializable error";
    }
  }
  return String(error);
}

/**
 * Unwraps the result of an SDK call: returns the data or throws with the
 * server's message, so the rest of the code does not have to repeat the double
 * check.
 */
export async function call<T>(run: () => Promise<unknown>): Promise<T> {
  const result = await run();
  const error = unwrapError(result);
  if (error !== null) throw new Error(describeOpencodeError(error));
  return unwrapData(result) as T;
}

/**
 * Makes an opencode error readable.
 *
 * opencode replies with `{"name":"...","data":{"message":"...","ref":"err_..."}}`.
 * Showing that string as it is is useless: the only part that says anything is
 * inside `data.message`, and the `ref` is the only way to find the exact line in
 * opencode's log. An error that cannot be diagnosed, in a project that claims to
 * be verifiable, is an error to fix.
 */
export function describeOpencodeError(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  if (!isRecord(parsed)) return raw;

  const data = parsed["data"];
  const name = typeof parsed["name"] === "string" ? (parsed["name"] as string) : "Error";

  if (!isRecord(data)) return `${name}: ${raw}`;

  const message = typeof data["message"] === "string" ? (data["message"] as string) : name;
  const ref = typeof data["ref"] === "string" ? (data["ref"] as string) : null;

  // opencode's generic messages say nothing on their own: the error name
  // already says something, so both are kept.
  const generic = /unexpected server error|internal server error/i.test(message);
  const text = generic ? `${name}: ${message}` : message;

  return ref === null ? text : `${text} (ref. ${ref}, look it up in the opencode log)`;
}
