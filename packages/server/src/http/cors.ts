import { networkInterfaces } from "node:os";

/**
 * Who may talk to the API, and how.
 *
 * The UI runs on one port and the API on another, so they are different origins
 * and without CORS headers the browser blocks every call. The easy fix would be
 * `Access-Control-Allow-Origin: *`, but it does not work here: it would mean any
 * page open in the browser could read the campaign.
 *
 * The rule is: an origin is accepted if and only if its host is an address **of
 * this machine**. Loopback is the normal case, but not the only one — opening
 * the UI from the network address is something done without noticing, and
 * addresses are read from the machine instead of being hand-written.
 *
 * Either way the API only listens on `127.0.0.1`, so another machine never
 * reaches it: CORS is not what stops that. CORS exists to stop a malicious page open
 * *on this* machine.
 */

/** Allowed hosts, built every time: addresses may change. */
export function localOrigins(): Set<string> {
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" && address.family !== "IPv6") continue;
      hosts.add(address.address);
    }
  }
  return hosts;
}

export function isLocalOrigin(origin: string, allowed: Set<string> = localOrigins()): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return allowed.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * CORS headers for a response, or `null` when the origin is not allowed.
 *
 * They live in a function because **two** responses must carry them: the normal one,
 * going through Fastify, and the turn one, writing headers by hand to
 * keep the stream open. When both paths pick headers on their own,
 * the hand-writing one forgets them: preflight passes, the response arrives
 * without headers and the browser blocks it anyway, with a message about
 * origins and not about code.
 */
export function corsHeaders(
  origin: string | undefined,
  wantsPrivateNetwork = false,
  allowed: Set<string> = localOrigins(),
): Record<string, string> | null {
  if (origin === undefined || !isLocalOrigin(origin, allowed)) return null;

  const headers: Record<string, string> = {
    "access-control-allow-origin": origin,
    // `Vary` because the response changes with the origin: a cache mixing
    // both would be a door left open.
    vary: "Origin",
    /*
     * Every method the API uses.
     *
     * `PATCH` was missing from this list and every save failed: a `PATCH` with a JSON body
     * makes the browser send a preflight, the preflight was refused, and the page reported a
     * network error on a server that was up. Reads were `GET` and never made a preflight,
     * which is why only saving was broken.
     */
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
  };

  // Chrome asks for `Access-Control-Request-Private-Network` when page and API
  // sit on different addresses of the same machine, which is our case:
  // the UI on `localhost`, the API on `127.0.0.1`. Without granting this,
  // Chrome blocks the request before it reaches the server, with no trace in the
  // logs: it looks like the API never answers.
  if (wantsPrivateNetwork) headers["access-control-allow-private-network"] = "true";

  return headers;
}

/** The browser asks for the private network with this header in preflight. */
export function wantsPrivateNetwork(headers: Record<string, unknown>): boolean {
  return headers["access-control-request-private-network"] === "true";
}
