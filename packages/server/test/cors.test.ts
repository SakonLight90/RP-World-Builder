import { describe, expect, it } from "vitest";
import { corsHeaders, isLocalOrigin, localOrigins } from "../src/http/cors.js";

/**
 * CORS: which page may ask the API, and with which methods.
 *
 * The method list is the part that hid a bug for a long time. A `PATCH` carrying
 * `content-type: application/json` makes the browser send a preflight, and a preflight
 * is refused when the method is not in `Access-Control-Allow-Methods`. What the browser
 * then reports to the page is a **network error** — the same message it gives when the
 * server is not running — and the server logs nothing, because the real request was
 * never sent.
 *
 * So saving the narrator model and saving the context window both failed with "cannot
 * reach the API", on a server that was up, answering every read without trouble: reads
 * are `GET`, and a `GET` never makes a preflight.
 *
 * These tests are here because that failure has no other symptom to catch it. Nothing
 * in the application was wrong; a header was missing.
 */

const ALLOWED = new Set(["localhost", "127.0.0.1"]);

function headersFor(origin = "http://localhost:3000") {
  return corsHeaders(origin, false, ALLOWED);
}

describe("who may ask", () => {
  it("accepts an origin on this machine", () => {
    expect(isLocalOrigin("http://localhost:3000", ALLOWED)).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:3311", ALLOWED)).toBe(true);
  });

  it("refuses an origin on another machine", () => {
    expect(isLocalOrigin("https://evil.example", ALLOWED)).toBe(false);
  });

  it("refuses an origin that is not an origin", () => {
    expect(isLocalOrigin("not a url", ALLOWED)).toBe(false);
    expect(isLocalOrigin("", ALLOWED)).toBe(false);
  });

  it("writes nothing when there is no origin", () => {
    // A request with no `Origin` is not a browser's cross-origin call, and answering
    // it with headers naming a host would be inventing one.
    expect(corsHeaders(undefined, false, ALLOWED)).toBeNull();
  });

  it("writes nothing for an origin that is not allowed", () => {
    expect(headersFor("https://evil.example")).toBeNull();
  });

  it("echoes the origin rather than answering with a wildcard", () => {
    // `*` would let any page open in the browser read the campaign.
    expect(headersFor()?.["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("varies on the origin, because the answer depends on it", () => {
    // A cache that mixed two origins would serve one origin's allowance to another.
    expect(headersFor()?.vary).toBe("Origin");
  });

  it("reads the machine's addresses instead of a hand-written list", () => {
    // Loopback is the normal case and not the only one: the interface opened from the
    // network address is something done without noticing.
    const hosts = localOrigins();
    expect(hosts.has("localhost")).toBe(true);
    expect(hosts.has("127.0.0.1")).toBe(true);
  });
});

describe("which methods", () => {
  /**
   * Every method the API has a route for.
   *
   * The list and not just `PATCH`: a method added to the API and forgotten here fails
   * exactly the way `PATCH` did — silently, as a network error, on a running server.
   */
  const used = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

  it.each(used)("allows %s", (method) => {
    const allowed = headersFor()?.["access-control-allow-methods"] ?? "";
    expect(allowed.split(",").map((entry) => entry.trim())).toContain(method);
  });

  it("allows the content type the API actually sends", () => {
    // `json()` in the client sets `content-type: application/json` on every body, and
    // that header is itself preflighted. A request with a body and an unlisted header
    // fails the same way a missing method does.
    const headers = headersFor()?.["access-control-allow-headers"] ?? "";
    expect(headers.toLowerCase()).toContain("content-type");
  });

  it("remembers the preflight, so it is not repeated for every save", () => {
    // Without a max-age the browser sends a preflight before every single call, which
    // doubles the requests on a page that saves a setting repeatedly.
    expect(Number(headersFor()?.["access-control-max-age"] ?? 0)).toBeGreaterThan(0);
  });
});

describe("the private network", () => {
  /**
   * Chrome's extra question when the page and the API are on different addresses of
   * the same machine — which is the normal case here, the interface on `localhost`
   * and the API on `127.0.0.1`.
   *
   * It is here because the failure it causes is identical to a server that is not
   * running, and it leaves nothing in the logs.
   */
  it("grants it when the browser asks", () => {
    expect(
      corsHeaders("http://localhost:3000", true, ALLOWED)?.["access-control-allow-private-network"],
    ).toBe("true");
  });

  it("says nothing about it when the browser does not ask", () => {
    expect(headersFor()?.["access-control-allow-private-network"]).toBeUndefined();
  });
});
