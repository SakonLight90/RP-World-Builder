/**
 * The opencode server enables basic auth when `OPENCODE_SERVER_PASSWORD` is set,
 * and the child process inherits the parent's environment: reading the same
 * variable is enough to authenticate, with no secret to keep in the platform
 * configuration.
 *
 * Note on types: the SDK's `Config` does `Omit<RequestInit, "headers">`, so
 * headers cannot be passed to the client. The intended way is a custom `fetch`,
 * and that is what we use here.
 */
export interface ServerCredentials {
  username: string;
  password: string;
}

export function readServerCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ServerCredentials | null {
  const password = env["OPENCODE_SERVER_PASSWORD"];
  if (password === undefined || password === "") return null;
  const username = env["OPENCODE_SERVER_USERNAME"];
  return { username: username === undefined || username === "" ? "opencode" : username, password };
}

export function basicAuthHeader(credentials: ServerCredentials): string {
  const encoded = Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString(
    "base64",
  );
  return `Basic ${encoded}`;
}

/**
 * A `fetch` that adds basic auth to every SDK request.
 * The Request has to be rebuilt: a Request's headers are protected.
 */
export function makeFetch(credentials: ServerCredentials | null): typeof fetch {
  if (!credentials) return globalThis.fetch;
  const header = basicAuthHeader(credentials);

  return (input, init) => {
    const request =
      input instanceof Request
        ? new Request(input, { headers: withAuth(input.headers, header) })
        : new Request(input, { ...init, headers: withAuth(init?.headers, header) });
    return globalThis.fetch(request);
  };
}

type HeadersInitLike = ConstructorParameters<typeof Headers>[0];

function withAuth(headers: HeadersInitLike, authorization: string): Headers {
  const merged = new Headers(headers);
  merged.set("authorization", authorization);
  return merged;
}
