import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { basicAuthHeader, readServerCredentials } from "./auth.js";
import { buildCommand, type OpencodeBinary } from "./binary.js";

/**
 * One opencode server per **world directory**.
 *
 * The reason is precise, and I learned it by getting it wrong: opencode does
 * not load agents from a directory given per request. It reads them from the
 * *project* directory, that is the one the server was started from, and nothing
 * else. A `?directory=` or a header changes nothing: it has been tried, the agent
 * list stays the same.
 *
 * So, if a world's narrator agent lives inside that world's folder — which is
 * the right place, because its Bible is in there too — the only way for opencode
 * to see it is for a server to have been started from there. That is why there is
 * one server per world here and not a single one: it is the price of isolation,
 * and it is proportionate, because a local machine handles few campaigns.
 *
 * When a world's agent changes (the Bible was edited), that world's server is
 * restarted: opencode reads the configuration at startup, so restarting is the
 * honest way of telling it "reread".
 */

const HEALTH_POLL_INTERVAL_MS = 250;
const MAX_START_ATTEMPTS = 5;

export interface WorldServerOptions {
  binary: OpencodeBinary;
  host: string;
  startupTimeoutMs: number;
}

interface Running {
  child: ChildProcess;
  port: number;
  baseUrl: string;
  /** Signature of the agent at startup time, to tell whether it must be restarted. */
  agentSignature: string;
}

export interface WorldServerStatus {
  directory: string;
  baseUrl: string;
  pid: number | null;
  /** The server started and answered. */
  healthy: boolean;
  error: string | null;
}

/** Fingerprint of the narrator agent present in a directory. */
export function agentSignature(directory: string): string {
  const file = join(directory, ".opencode", "agents", "gm.md");
  try {
    const content = readFileSync(file, "utf8");
    // The length and the first characters are enough: if the file changed in a
    // meaningful way the fingerprint changes, and restarting twice costs more
    // than an unlikely collision.
    return `${content.length}:${content.slice(0, 256)}`;
  } catch {
    return "none";
  }
}

/** A free port, closed right away: only a number nobody is using is needed. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => reject(new Error("port not available")));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

export class WorldServers {
  readonly #options: WorldServerOptions;
  readonly #running = new Map<string, Running>();
  readonly #starting = new Map<string, Promise<void>>();
  #closing = false;

  constructor(options: WorldServerOptions) {
    this.#options = options;
  }

  /** Directories that already have a server. */
  directories(): string[] {
    return [...this.#running.keys()];
  }

  status(directory: string): WorldServerStatus {
    const entry = this.#running.get(directory);
    if (!entry) {
      return { directory, baseUrl: "", pid: null, healthy: false, error: "not started" };
    }
    return {
      directory,
      baseUrl: entry.baseUrl,
      pid: entry.child.pid ?? null,
      healthy: entry.child.exitCode === null,
      error: null,
    };
  }

  /**
   * Starts (or restarts) a directory's server and waits for it to answer.
   *
   * It restarts on its own when the narrator agent has changed: opencode does
   * not reread the configuration while hot, so editing the Bible without a
   * restart means a narrator with the old rules, which is the kind of bug you
   * discover three chapters later.
   */
  async ensure(directory: string): Promise<void> {
    if (this.#closing) return;

    const signature = agentSignature(directory);
    const existing = this.#running.get(directory);
    if (existing && existing.agentSignature === signature && existing.child.exitCode === null) {
      return;
    }

    // Two concurrent requests for the same world must not start two servers: the
    // second waits for the first.
    const inFlight = this.#starting.get(directory);
    if (inFlight) {
      await inFlight;
      const after = this.#running.get(directory);
      if (after && after.agentSignature === signature) return;
    }

    const promise = this.#start(directory, signature);
    this.#starting.set(directory, promise);
    try {
      await promise;
    } finally {
      this.#starting.delete(directory);
    }
  }

  async #start(directory: string, signature: string): Promise<void> {
    let lastError = "not started";

    for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
      if (this.#closing) return;

      // The world's folder is also the root of the opencode project, and it does
      // not exist yet: it is created when the narrator agent is written, and that
      // happens **after** this server has started. Without this, the process
      // exits immediately with a non-existent-directory error and the campaign
      // does not open, with a message that talks about opencode and not the real
      // cause.
      try {
        mkdirSync(directory, { recursive: true });
      } catch (error) {
        lastError = `world folder not usable: ${error instanceof Error ? error.message : String(error)}`;
        continue;
      }

      const port = await freePort();
      const baseUrl = `http://${this.#options.host}:${port}`;
      const { file, args } = buildCommand(this.#options.binary, [
        "serve",
        "--port",
        String(port),
        "--hostname",
        this.#options.host,
      ]);

      let child: ChildProcess;
      try {
        child = spawn(file, args, {
          // The world's directory is the root of the opencode project: from there
          // the narrator agent with its Bible becomes visible.
          cwd: directory,
          shell: this.#options.binary.needsShell,
          windowsHide: true,
          // No pipe: a pipe left open on a child keeps the parent's event loop
          // alive, and then the parent never exits. In development this happens
          // on every save — `tsx watch` restarts, the old process stays hanging
          // and after a timeout it is killed, killing the request that was in
          // flight. The browser sees a dropped connection. opencode's output
          // stays in its logs, which are already on disk.
          stdio: "ignore",
        });
      } catch (error) {
        lastError = `cannot start opencode: ${error instanceof Error ? error.message : String(error)}`;
        continue;
      }

      // If the parent exits, the child must not stop it: it is detached from the
      // event loop and closed explicitly in `stopAll`.
      child.unref();

      let spawnError: string | null = null;
      child.on("error", (error) => {
        spawnError = error instanceof Error ? error.message : String(error);
      });

      const health = await this.#waitForHealth(baseUrl, child);
      if (health.healthy && spawnError === null) {
        this.#running.set(directory, { child, port, baseUrl, agentSignature: signature });
        return;
      }

      lastError = health.error ?? spawnError ?? "health check failed";
      child.kill();
    }

    throw new Error(`Could not start opencode for ${directory}: ${lastError}`);
  }

  async #waitForHealth(
    baseUrl: string,
    child: ChildProcess,
  ): Promise<{ healthy: boolean; error: string | null }> {
    const deadline = Date.now() + this.#options.startupTimeoutMs;
    let last = "not started yet";

    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        return { healthy: false, error: `the process exited with code ${child.exitCode}` };
      }

      const credentials = readServerCredentials();
      const headers: Record<string, string> = {};
      if (credentials) headers["authorization"] = basicAuthHeader(credentials);

      try {
        const response = await fetch(`${baseUrl}/global/health`, {
          signal: AbortSignal.timeout(3_000),
          headers,
        });
        if (response.status === 401) {
          return {
            healthy: false,
            error:
              "The opencode server asks for authentication: set OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD.",
          };
        }
        if (response.ok) {
          const body: unknown = await response.json();
          if (
            typeof body === "object" &&
            body !== null &&
            (body as { healthy?: unknown }).healthy === true
          ) {
            return { healthy: true, error: null };
          }
          last = "unrecognized response";
        } else {
          last = `HTTP ${response.status}`;
        }
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
    }

    return { healthy: false, error: last };
  }

  async stop(directory: string): Promise<void> {
    const entry = this.#running.get(directory);
    if (!entry) return;
    this.#running.delete(directory);
    await kill(entry.child);
  }

  async stopAll(): Promise<void> {
    this.#closing = true;
    const entries = [...this.#running.values()];
    this.#running.clear();
    for (const entry of entries) await kill(entry.child);
  }
}

async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
