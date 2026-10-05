import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeOpencodeError } from "../src/opencode/client.js";
import { agentSignature } from "../src/opencode/world-server.js";

/**
 * Here the two points where an error reaches the player and must reach them in
 * useful form are covered.
 */

function world(agent: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "rpwb-world-"));
  if (agent !== null) {
    const dir = join(root, ".opencode", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "gm.md"), agent);
  }
  return root;
}

describe("agent fingerprint", () => {
  it("without agent says so, and doesn't lie", () => {
    expect(agentSignature(world(null))).toBe("none");
  });

  it("the same agent gives the same fingerprint", () => {
    const content = "---\ndescription: narrator\n---\nYou are the narrator.";

    expect(agentSignature(world(content))).toBe(agentSignature(world(content)));
  });

  it("a changed agent gives another fingerprint: that's what restarts the server", () => {
    const before = agentSignature(world("---\ndescription: narrator\n---\nOld rules."));
    const after = agentSignature(world("---\ndescription: narrator\n---\nNew rules."));

    expect(before).not.toBe(after);
  });

  it("a longer Bible changes the fingerprint even if the start is identical", () => {
    const short = agentSignature(world("premessa\n"));
    const long = agentSignature(world(`premessa\n${"x".repeat(500)}`));

    expect(short).not.toBe(long);
  });
});

describe("opencode errors", () => {
  it("an error with ref tells what happened and where to look", () => {
    const raw = JSON.stringify({
      name: "UnknownError",
      data: {
        message: "Unexpected server error. Check server logs for details.",
        ref: "err_95cbf589",
      },
    });

    const text = describeOpencodeError(raw);

    // no longer incomprehensible JSON
    expect(text).not.toContain("{");
    expect(text).not.toContain('"data"');

    // tells the error type, not just "something went wrong"
    expect(text).toContain("UnknownError");

    // and carries the reference, the only way to find the log line
    expect(text).toContain("err_95cbf589");
  });

  it("an already useful message is kept as is", () => {
    const raw = JSON.stringify({
      name: "ProviderAuthError",
      data: { message: "Missing credentials for the provider", ref: "err_1" },
    });

    expect(describeOpencodeError(raw)).toBe(
      "Missing credentials for the provider (ref. err_1, look it up in the opencode log)",
    );
  });

  it("an error without ref isn't invented", () => {
    const raw = JSON.stringify({ name: "BadRequest", data: { message: "modello assente" } });

    expect(describeOpencodeError(raw)).toBe("modello assente");
  });

  it("a non-JSON error passes through", () => {
    expect(describeOpencodeError("ECONNREFUSED")).toBe("ECONNREFUSED");
  });

  it("JSON that isn't an opencode error passes through", () => {
    expect(describeOpencodeError('{"ok":true}')).toContain("ok");
  });
});
