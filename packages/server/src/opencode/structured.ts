/*
 * Tolerant JSON extraction.
 *
 * Structured output is not requested: it ties the project to an SDK version and to a
 * capability the models do not have. JSON is asked for in a code block and parsed
 * tolerantly: bare JSON, the block with or without a language tag, and any surrounding
 * prose.
 */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function extractJson(raw: string): ParseResult<unknown> {
  const text = raw.trim();
  if (text === "") return { ok: false, error: "empty response" };

  const candidates = [stripFence(text), text];
  for (const candidate of candidates) {
    const balanced = firstBalanced(candidate);
    if (balanced === null) continue;
    try {
      return { ok: true, value: JSON.parse(balanced) };
    } catch {
      // try the next candidate
    }
  }

  return { ok: false, error: "no valid JSON found in the response" };
}

function stripFence(text: string): string {
  const match = /```(?:json|jsonc)?\s*([\s\S]*?)```/i.exec(text);
  return match?.[1]?.trim() ?? text;
}

/** The first balanced JSON value, ignoring braces inside strings. */
export function firstBalanced(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const open = text[start];
  if (open === undefined) return null;
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === undefined) continue;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/** Builds the request for a JSON, with the schema spelled out in the clear. */
export function jsonInstruction(schema: Record<string, unknown>, locales: string[]): string {
  return [
    "Answer with a single JSON object, with no text around it.",
    "Put it in a ```json code block.",
    `Allowed languages for the texts: ${locales.join(", ")}.`,
    "Expected schema:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

/** Coercion: free models send numbers as strings and lists as CSV. */
export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof value === "string") {
    return value
      .split(/[;\n]/)
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }
  return [];
}

export function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}
