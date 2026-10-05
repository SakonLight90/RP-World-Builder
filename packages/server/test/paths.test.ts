import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dbPath, defaultDataDir, slugify, worldDir, worldsDir } from "../src/config/paths.js";

describe("slugify", () => {
  it("normalizes a name with accents and spaces", () => {
    expect(slugify("Città della Luce")).toBe("citta-della-luce");
  });

  it("strips characters that can't live in a path", () => {
    expect(slugify("Vault 12: Il Risveglio / Pt.1")).toBe("vault-12-il-risveglio-pt-1");
  });

  it("never produces an empty string", () => {
    expect(slugify("!!!")).toBe("world");
    expect(slugify("   ")).toBe("world");
  });

  it("limits length", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("paths", () => {
  // `join` normalizes with the platform separator: on Windows it makes
  // backslashes, so expectations must be built with `join`, not by hand.
  it("the database lives in the data root", () => {
    expect(dbPath("/dati")).toBe(join("/dati", "rpwb.db"));
  });

  it("each world has its own directory", () => {
    expect(worldsDir("/dati")).toBe(join("/dati", "worlds"));
    expect(worldDir("/dati", "morgan")).toBe(join("/dati", "worlds", "morgan"));
  });

  it("RPWB_DATA_DIR wins", () => {
    const previous = process.env.RPWB_DATA_DIR;
    process.env.RPWB_DATA_DIR = "/tmp/custom";
    try {
      expect(defaultDataDir()).toBe("/tmp/custom");
    } finally {
      if (previous === undefined) delete process.env.RPWB_DATA_DIR;
      else process.env.RPWB_DATA_DIR = previous;
    }
  });
});
