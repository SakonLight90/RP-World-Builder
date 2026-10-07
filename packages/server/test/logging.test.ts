import { afterEach, describe, expect, it, vi } from "vitest";
import { configureLogLevel, errorDetail, log } from "../src/logging.js";

/**
 * The log itself.
 *
 * A logger that cannot be tested is a logger nobody trusts, and the thing worth
 * testing here is not the formatting but the two decisions that make the log
 * readable later: what gets written when, and what a value becomes when it is put on
 * a line.
 *
 * The level is the first. `warn` is the default and `info` is silent under it, so a
 * test that forgets to set the level tests nothing. Every test sets it explicitly
 * and restores it after, because a level left at `debug` by one test would make the
 * next one write to a terminal that is not looking.
 *
 * The second is the truncation. A value longer than the limit is cut, and a value
 * that cannot be stringified at all becomes a sentence instead of throwing: a
 * logger that throws while describing a failure removes the only record of that
 * failure.
 */

const LEVELS = ["debug", "info", "warn", "error"] as const;

function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
  const original = process.env["RPWB_LOG_LEVEL"];
  return {
    lines,
    restore: () => {
      stdout.mockRestore();
      stderr.mockRestore();
      if (original === undefined) delete process.env["RPWB_LOG_LEVEL"];
      else process.env["RPWB_LOG_LEVEL"] = original;
      configureLogLevel();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the log level", () => {
  it("defaults to warn", () => {
    delete process.env["RPWB_LOG_LEVEL"];
    expect(configureLogLevel()).toBe("warn");
  });

  it("reads the level from the environment", () => {
    process.env["RPWB_LOG_LEVEL"] = "debug";
    expect(configureLogLevel()).toBe("debug");
  });

  it("an unknown level falls back to warn rather than throwing", () => {
    // A typo in a variable must not stop the application from starting, and the
    // default is the quiet one: the consequence of the typo is no extra output
    // rather than a flood.
    process.env["RPWB_LOG_LEVEL"] = "verbose";
    expect(configureLogLevel()).toBe("warn");
  });

  it("an empty level falls back to warn", () => {
    process.env["RPWB_LOG_LEVEL"] = "   ";
    expect(configureLogLevel()).toBe("warn");
  });

  it("the level is case-insensitive", () => {
    process.env["RPWB_LOG_LEVEL"] = "INFO";
    expect(configureLogLevel()).toBe("info");
  });
});

describe("what gets written", () => {
  it("warn and error go to stderr", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "warn";
      configureLogLevel();
      log.warn("something.warned");
      log.error("something.failed");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("WARN");
      expect(lines[1]).toContain("ERROR");
    } finally {
      restore();
    }
  });

  it("info and debug go to stdout", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "debug";
      configureLogLevel();
      log.info("something.happened");
      log.debug("something.small");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain("INFO");
      expect(lines[1]).toContain("DEBUG");
    } finally {
      restore();
    }
  });

  it("a level below the threshold writes nothing", () => {
    // The whole point of a threshold. At `warn` the process is quiet except for what
    // went wrong, and there is no server farm here to watch.
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "warn";
      configureLogLevel();
      log.info("quiet");
      log.debug("quieter");
      expect(lines).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("a level at the threshold is written", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "warn";
      configureLogLevel();
      log.warn("loud enough");
      expect(lines).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("every level is reachable from the default", () => {
    // The four levels are a ladder and not a switch: `warn` must not silence `error`.
    for (const level of LEVELS) {
      const { lines, restore } = capture();
      try {
        process.env["RPWB_LOG_LEVEL"] = level;
        configureLogLevel();
        log.error("always");
        expect(lines, `level=${level}`).toHaveLength(1);
      } finally {
        restore();
      }
    }
  });
});

describe("the shape of a line", () => {
  it("starts with an ISO timestamp", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("server.listening");
      // ISO 8601 and UTC. A log read across a daylight-saving change with local times
      // is a log whose order is not its order.
      expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /);
    } finally {
      restore();
    }
  });

  it("carries the event name", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("turn.started");
      expect(lines[0]).toContain(" turn.started");
    } finally {
      restore();
    }
  });

  it("appends the fields as key=value", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("turn.finished", { worldId: "w1", state: "completed" });
      expect(lines[0]).toContain("worldId=w1");
      expect(lines[0]).toContain("state=completed");
    } finally {
      restore();
    }
  });

  it("sorts the fields so two identical events read identically", () => {
    // A log is diffed by eye. `b=2 a=1` and `a=1 b=2` are the same event and look
    // like two different ones.
    // The timestamp is stripped before comparing: two calls in the same test can land
    // on different milliseconds, and the point is the field order, not the clock.
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("same", { b: 2, a: 1 });
      log.info("same", { a: 1, b: 2 });
      const strip = (line: string) => line.replace(/^\S+ /, "");
      expect(lines[0] && strip(lines[0])).toBe(lines[1] && strip(lines[1]));
    } finally {
      restore();
    }
  });

  it("omits a field whose value is undefined", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("partial", { worldId: "w1", turnId: undefined });
      expect(lines[0]).toContain("worldId=w1");
      expect(lines[0]).not.toContain("turnId");
    } finally {
      restore();
    }
  });

  it("writes no fields tail when there are none", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("bare");
      // No `key=value` tail: the line is timestamp, level, event, and nothing else.
      // A trailing space would mean an empty field was written.
      expect(lines[0]).toBeDefined();
      expect(lines[0]).not.toMatch(/ \w+=/);
    } finally {
      restore();
    }
  });

  it("a line stays one line", () => {
    // A value with a newline in it would break every reader that assumes one event
    // per line, and a log is read that way far more often than it is read as JSON.
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("multiline", { reason: "line one\nline two" });
      expect(lines).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("values on a line", () => {
  it("a long value is cut, not dropped", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("long", { reason: "x".repeat(1000) });
      expect(lines[0]?.length ?? 0).toBeLessThan(600);
      expect(lines[0]).toContain("xxx");
    } finally {
      restore();
    }
  });

  it("an object becomes JSON", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("object", { detail: { a: 1 } });
      expect(lines[0]).toContain('detail={"a":1}');
    } finally {
      restore();
    }
  });

  it("a circular value does not throw", () => {
    /*
     * The case that matters most, because it is the one that would remove the record
     * of a failure: an error carrying a reference to itself, or to the request that
     * produced it. `JSON.stringify` throws on those, and this runs inside the
     * logger.
     */
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "error";
      configureLogLevel();
      const circular: Record<string, unknown> = { name: "loop" };
      circular["self"] = circular;
      expect(() => log.error("circular", { detail: circular })).not.toThrow();
      expect(lines).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("a BigInt does not throw", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "error";
      configureLogLevel();
      expect(() => log.error("bigint", { value: 10n })).not.toThrow();
      expect(lines).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it("null and undefined are written as what they are", () => {
    const { lines, restore } = capture();
    try {
      process.env["RPWB_LOG_LEVEL"] = "info";
      configureLogLevel();
      log.info("nothing", { a: null });
      expect(lines[0]).toContain("a=null");
    } finally {
      restore();
    }
  });
});

describe("errorDetail", () => {
  it("an Error becomes its name and message", () => {
    expect(errorDetail(new Error("it broke"))).toBe("Error: it broke");
  });

  it("an Error with no message keeps its name", () => {
    // `"unknown"` is deliberately not used: an error with no message is a different
    // thing from an error whose message is empty, and the log says which.
    expect(errorDetail(new Error(""))).toBe("Error");
  });

  it("a TypeError says it was a TypeError", () => {
    expect(errorDetail(new TypeError("not a function"))).toBe("TypeError: not a function");
  });

  it("a string is used as it is", () => {
    expect(errorDetail("opencode did not answer")).toBe("opencode did not answer");
  });

  it("an empty string is not an empty detail", () => {
    expect(errorDetail("")).toBe("empty string");
  });

  it("null and undefined have no detail", () => {
    expect(errorDetail(null)).toBeUndefined();
    expect(errorDetail(undefined)).toBeUndefined();
  });

  it("an object becomes JSON", () => {
    expect(errorDetail({ code: 42 })).toBe('{"code":42}');
  });

  it("a circular object does not throw", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => errorDetail(circular)).not.toThrow();
  });
});
