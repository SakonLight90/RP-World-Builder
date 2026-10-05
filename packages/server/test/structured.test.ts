import { describe, expect, it } from "vitest";
import { isFreeModel } from "../src/opencode/models.js";
import {
  asString,
  asStringArray,
  extractJson,
  firstBalanced,
  jsonInstruction,
} from "../src/opencode/structured.js";

describe("firstBalanced", () => {
  it("extracts a simple object", () => {
    expect(firstBalanced('prosa {"a":1} altra prosa')).toBe('{"a":1}');
  });

  it("ignores braces inside strings", () => {
    expect(firstBalanced('{"nota":"con { e } dentro","n":2}')).toBe(
      '{"nota":"con { e } dentro","n":2}',
    );
  });

  it("respects escapes", () => {
    expect(firstBalanced('{"a":"virgoletta \\" e }"}')).toBe('{"a":"virgoletta \\" e }"}');
  });

  it("returns null if nothing balanced", () => {
    expect(firstBalanced("nessun json qui")).toBeNull();
    expect(firstBalanced('{"a": 1')).toBeNull();
  });
});

describe("extractJson", () => {
  it("accepts bare JSON", () => {
    const result = extractJson('{"titolo":"ciao"}');
    expect(result.ok).toBe(true);
  });

  it("accepts a code block with language", () => {
    const result = extractJson('Ecco il risultato:\n```json\n{"titolo":"ciao","n":3}\n```\nfine');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ titolo: "ciao", n: 3 });
  });

  it("recovers JSON dirtied by surrounding prose", () => {
    const result = extractJson('Certamente! {"titolo":"ciao"} Spero sia utile.');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ titolo: "ciao" });
  });

  it("reports an empty answer", () => {
    const result = extractJson("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("empty response");
  });

  it("reports missing JSON", () => {
    const result = extractJson("narrativa lunga senza dati strutturati");
    expect(result.ok).toBe(false);
  });
});

describe("free-model coercion", () => {
  it("models send lists as CSV", () => {
    expect(asStringArray("uno; due\ntre")).toEqual(["uno", "due", "tre"]);
  });

  it("a real list stays handy", () => {
    expect(asStringArray(["a", "", 3, "b"])).toEqual(["a", "b"]);
  });

  it("coerces numbers and booleans to strings", () => {
    expect(asString(3)).toBe("3");
    expect(asString(true)).toBe("true");
    expect(asString(null, "fallback")).toBe("fallback");
  });
});

describe("isFreeModel", () => {
  it("free only if both directions cost zero", () => {
    expect(isFreeModel(0, 0)).toBe(true);
  });

  it("free input with paid output isn't free", () => {
    expect(isFreeModel(0, 1.5)).toBe(false);
  });

  it("a paid model isn't free", () => {
    expect(isFreeModel(3, 15)).toBe(false);
  });
});

describe("jsonInstruction", () => {
  it("includes the schema and allowed languages", () => {
    const text = jsonInstruction({ type: "object" }, ["it", "en"]);
    expect(text).toContain("it, en");
    expect(text).toContain('"type": "object"');
    expect(text).toContain("```json");
  });
});
