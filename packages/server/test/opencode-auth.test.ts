import { afterEach, describe, expect, it, vi } from "vitest";
import { basicAuthHeader, makeFetch, readServerCredentials } from "../src/opencode/auth.js";

/**
 * The opencode server authentication.
 *
 * It's the project's most fragile file and had not one test: seventeen modules
 * pass through it transitively, and its defect shows in no screen. The symptom
 * would be a `401` on one machine only, on one install only, and the arriving
 * message talks about a wrong password when the password is right and simply
 * wasn't sent.
 *
 * Here what matters is proven: the header must arrive **and** must not delete
 * anything the request already had. A `fetch` replacing headers instead of
 * adding its own silently fails every call carrying a `content-type` or an
 * identifier, and that failure's reason shows nowhere.
 */

const CREDENTIALS = { username: "opencode", password: "segreto" };

/** The global `fetch`, replaced with one recording what it gets. */
function intercetta(): { requested: Request[] } {
  const requested: Request[] = [];
  const fake = (input: unknown): Promise<Response> => {
    requested.push(input as Request);
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  vi.stubGlobal("fetch", fake as unknown as typeof fetch);
  return { requested };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server credentials", () => {
  it("without password there are none", () => {
    // Missing password means "auth disabled": then no header must be sent,
    // because opencode with a mistakenly set password would reject every
    // request.
    expect(readServerCredentials({})).toBeNull();
    expect(readServerCredentials({ OPENCODE_SERVER_PASSWORD: "" })).toBeNull();
    expect(readServerCredentials({ OPENCODE_SERVER_USERNAME: "solo" })).toBeNull();
  });

  it("with password the default user is opencode", () => {
    // The username is what opencode expects by default: inventing another
    // would send credentials the server doesn't recognize.
    expect(readServerCredentials({ OPENCODE_SERVER_PASSWORD: "segreto" })).toEqual({
      username: "opencode",
      password: "segreto",
    });
    expect(
      readServerCredentials({ OPENCODE_SERVER_PASSWORD: "x", OPENCODE_SERVER_USERNAME: "" }),
    ).toEqual({ username: "opencode", password: "x" });
  });

  it("a declared user is respected", () => {
    expect(
      readServerCredentials({
        OPENCODE_SERVER_PASSWORD: "segreto",
        OPENCODE_SERVER_USERNAME: "amministratore",
      }),
    ).toEqual({ username: "amministratore", password: "segreto" });
  });

  it("reads only the passed environment", () => {
    // The child process inherits the parent env, but a test reading
    // `process.env` would say "auth on" on a machine where the user has the
    // variable and "off" where not: same code, two truths. That's also why
    // this function takes the environment.
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", "segreto-di-chi-esegue");
    expect(readServerCredentials({})).toBeNull();
    expect(readServerCredentials({ OPENCODE_SERVER_PASSWORD: "altro" })).toEqual({
      username: "opencode",
      password: "altro",
    });
    vi.unstubAllEnvs();
  });
});

describe("the auth header", () => {
  it("is basic auth of name and password", () => {
    expect(basicAuthHeader(CREDENTIALS)).toBe(`Basic ${btoa("opencode:segreto")}`);
  });

  it("encodes in utf8, because passwords aren't just letters", () => {
    // An accented password sent in another encoding makes a different header
    // than the server expects, and the following `401` is indistinguishable
    // from a wrong password.
    const accentata = basicAuthHeader({ username: "opencode", password: "perché" });
    const atteso = Buffer.from("opencode:perché", "utf8").toString("base64");
    expect(accentata).toBe(`Basic ${atteso}`);
  });
});

describe("the fetch adding auth", () => {
  it("without credentials it's the same old fetch", () => {
    // The common case: without password no new Request must be built, because
    // rebuilding loses half of `init` options.
    intercetta();
    expect(makeFetch(null)).toBe(globalThis.fetch);
  });

  it("adds the header to a headerless request", async () => {
    const { requested } = intercetta();

    await makeFetch(CREDENTIALS)("http://127.0.0.1:4599/session");

    const request = requested[0];
    expect(request?.url).toBe("http://127.0.0.1:4599/session");
    expect(request?.headers.get("authorization")).toBe(basicAuthHeader(CREDENTIALS));
  });

  it("adds the header without losing existing ones", async () => {
    const { requested } = intercetta();

    await makeFetch(CREDENTIALS)("http://127.0.0.1:4599/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-richiesta": "42" },
      body: "{}",
    });

    const header = requested[0]?.headers;
    expect(header?.get("authorization")).toBe(basicAuthHeader(CREDENTIALS));
    // The two that were there: losing them means the body arrives typeless and
    // the request trace vanishes from the server log.
    expect(header?.get("content-type")).toBe("application/json");
    expect(header?.get("x-richiesta")).toBe("42");
    expect(requested[0]?.method).toBe("POST");
  });

  it("also accepts headers already packed in a Headers object", async () => {
    // Both forms are equivalent for `fetch` and different for a hand-reading
    // implementation: only one must work because the rest of the project uses
    // either indifferently.
    const { requested } = intercetta();
    const header = new Headers();
    header.set("content-type", "application/json");

    await makeFetch(CREDENTIALS)("http://127.0.0.1:4599/session", { headers: header });

    expect(requested[0]?.headers.get("authorization")).toBe(basicAuthHeader(CREDENTIALS));
    expect(requested[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("on an already built Request adds the header without changing it", async () => {
    // A `Request`'s headers are protected: only a new one can be built. Trying
    // to write over them errors "immutable" and nobody would know auth is the
    // reason.
    const { requested } = intercetta();
    const originale = new Request("http://127.0.0.1:4599/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    await makeFetch(CREDENTIALS)(originale);

    expect(requested[0]?.headers.get("authorization")).toBe(basicAuthHeader(CREDENTIALS));
    expect(requested[0]?.headers.get("content-type")).toBe("application/json");
    // The starting Request stays as it was: its owner can keep using it
    // without discovering someone put auth inside.
    expect(originale.headers.get("authorization")).toBeNull();
  });

  it("an already present auth header is replaced, not doubled", async () => {
    // A client already carrying one (e.g. an expired token) must be corrected
    // here, not colliding with the other: two `authorization` headers and a
    // server reading the first wrong one are worth an unexplained `401`.
    const { requested } = intercetta();

    await makeFetch(CREDENTIALS)("http://127.0.0.1:4599/session", {
      headers: { authorization: "Basic vecchio" },
    });

    expect(requested[0]?.headers.get("authorization")).toBe(basicAuthHeader(CREDENTIALS));
    expect([...(requested[0]?.headers ?? new Headers())].length).toBeGreaterThan(0);
  });

  it("the outgoing request is the rebuilt one, not the starting one", async () => {
    // Proof the header really reaches the network: `fetch` gets a `Request`
    // object, and without this check the implementation could just build and
    // throw it away, and the test would still pass.
    const { requested } = intercetta();

    await makeFetch(CREDENTIALS)("http://127.0.0.1:4599/session");

    expect(requested).toHaveLength(1);
    expect(requested[0]).toBeInstanceOf(Request);
  });
});
