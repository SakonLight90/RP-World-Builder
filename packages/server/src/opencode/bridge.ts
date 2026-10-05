import { type ChildProcess, spawn } from "node:child_process";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { BridgeStatus } from "@rpwb/shared";
import { basicAuthHeader, makeFetch, readServerCredentials } from "./auth.js";
import { buildCommand, type OpencodeBinary } from "./binary.js";
import { type WorldServerStatus, WorldServers } from "./world-server.js";

export interface BridgeOptions {
  host: string;
  port: number;
  /** If set, we attach to this instance instead of starting one. */
  baseUrl: string | null;
  startupTimeoutMs: number;
  binary: OpencodeBinary;
  /**
   * Directory of the primary server. It is the one `opencode serve` was started
   * from, and it is the only one in which an agent is visible without starting a
   * dedicated server.
   *
   * If there is none, the bridge **does not guess it**. There used to be
   * `process.cwd()` as a fallback, that is "the folder the process was started
   * from": the primary server ended up somewhere that depends on whoever ran the
   * command and the clients for that directory came back wrong with nothing
   * saying so. Whoever knows their directory passes it, and whoever does not has
   * no primary server to attach to: every client goes through `ensureServer`,
   * which is the explicit behaviour.
   */
  primaryDirectory?: string;
}

export interface HealthResult {
  healthy: boolean;
  version: string | null;
  error: string | null;
}

const HEALTH_POLL_INTERVAL_MS = 250;

/**
 * The bridge to opencode.
 *
 * Two things, and they have to be kept apart.
 *
 * The **primary server** handles health, models and settings: agent lists,
 * providers, configuration. It sits on the directory it was started from, and
 * that is all.
 *
 * **One server per world.** opencode does not load agents from a directory given
 * per request: it reads them from the *project* directory, that is the one the
 * server was started from, and there is no way of telling it another one via
 * `directory` or a header (it has been tried: the agent list does not change).
 * Since a world's narrator agent lives in that world's folder, together with its
 * Bible, the only way for opencode to read it is for a server to have been
 * started from there.
 *
 * One server per world, then. It is the price of isolation, and it is
 * proportionate: a local machine handles few campaigns.
 *
 * Note: the v1 SDK does not expose `global.health`, so the health check has to be
 * done with a direct fetch against `GET /global/health`.
 */
export class OpencodeBridge {
  readonly #options: BridgeOptions;
  /**
   * Server of the primary directory: models, health, agent list.
   *
   * `null` means there is no attachable one, not "let's go looking": every client
   * then goes through `WorldServers`, which starts a server for the requested
   * directory.
   */
  readonly #primaryDirectory: string | null;
  /** One server per world, with its directory as root. */
  readonly #worlds: WorldServers;
  #child: ChildProcess | null = null;
  #status: BridgeStatus;
  #clients = new Map<string, OpencodeClient>();
  #closing = false;

  constructor(options: BridgeOptions) {
    this.#options = options;
    this.#primaryDirectory = options.primaryDirectory ?? null;
    this.#worlds = new WorldServers({
      binary: options.binary,
      host: options.host,
      startupTimeoutMs: options.startupTimeoutMs,
    });
    this.#status = {
      state: "stopped",
      mode: "attached",
      baseUrl: options.baseUrl ?? `http://${options.host}:${options.port}`,
      version: null,
      pid: null,
      error: null,
    };
  }

  get status(): BridgeStatus {
    return { ...this.#status };
  }

  get baseUrl(): string {
    return this.#status.baseUrl;
  }

  /**
   * Client for a world directory, after that directory's server has been
   * started.
   *
   * It always has to be called after `ensureServer`. It returns the client of
   * *that* directory's server: it is the only one that has read the narrator
   * agent with the world's Bible inside it.
   */
  clientFor(directory: string): OpencodeClient {
    const cached = this.#clients.get(directory);
    if (cached) return cached;

    // The primary directory is the one of the server already started by `start`.
    if (directory === this.#primaryDirectory) {
      const client = this.#makeClient(this.#status.baseUrl, directory);
      this.#clients.set(directory, client);
      return client;
    }

    const running = this.#worlds.status(directory);
    if (running.baseUrl === "") {
      // With no declared primary directory the only server this bridge has
      // started is `start`'s one, and returning it is the explicit answer instead
      // of a guess. This path did not exist before: the primary directory was
      // `process.cwd()`, so the client came back only if the requested folder
      // matched the one the process was started from.
      if (this.#primaryDirectory === null) {
        const client = this.#makeClient(this.#status.baseUrl, directory);
        this.#clients.set(directory, client);
        return client;
      }
      // Better a clear error than a wrong answer: the resulting client would
      // point at the primary directory's server, which does not know this
      // world's agent, and the failure would arrive much later, as an unnamed
      // error from the narrator.
      throw new Error(
        `No opencode server for ${directory}: ensureServer() is missing before clientFor().`,
      );
    }
    const client = this.#makeClient(running.baseUrl, directory);
    this.#clients.set(directory, client);
    return client;
  }

  #makeClient(baseUrl: string, directory: string): OpencodeClient {
    return createOpencodeClient({
      baseUrl,
      directory,
      fetch: makeFetch(readServerCredentials()),
    });
  }

  /**
   * Makes sure an opencode server exists with the project root on that
   * directory, and returns the client. It has to be called before any use of a
   * world's client.
   */
  async ensureServer(directory: string): Promise<OpencodeClient> {
    if (directory === this.#primaryDirectory) {
      const started = this.#status.state === "ready" ? true : await this.start();
      if (!started) {
        throw new Error(this.#status.error ?? "opencode is not reachable");
      }
      return this.clientFor(directory);
    }

    await this.#worlds.ensure(directory);
    return this.clientFor(directory);
  }

  /** Directories that have their own server, with their baseUrl. */
  worldServers(): WorldServerStatus[] {
    return this.#worlds.directories().map((directory) => this.#worlds.status(directory));
  }

  /**
   * Stops a directory's opencode server, if it is up.
   *
   * It is needed when the directory has to be removed: on Windows a process that
   * has files open inside the folder holds them, and deleting it by hand fails
   * with an error that looks like a permissions problem and is instead a file
   * still open.
   */
  async stopServer(directory: string): Promise<void> {
    await this.#worlds.stop(directory);
  }

  async start(): Promise<boolean> {
    if (this.#status.state === "ready") return true;
    this.#status = { ...this.#status, state: "starting", error: null };

    const target = this.#options.baseUrl ?? `http://${this.#options.host}:${this.#options.port}`;
    this.#status.baseUrl = target;

    if (this.#options.baseUrl) {
      const health = await this.probeHealth();
      if (health.healthy) {
        this.#status = {
          ...this.#status,
          state: "ready",
          mode: "attached",
          version: health.version,
        };
        return true;
      }
      this.#fail(
        this.#options.baseUrl
          ? `No opencode reachable at ${target}: ${health.error ?? "health check failed"}`
          : "",
      );
      return false;
    }

    if (this.#spawnServer()) {
      const health = await this.#waitForHealth();
      if (health.healthy) {
        this.#status = {
          ...this.#status,
          state: "ready",
          mode: "spawned",
          version: health.version,
        };
        return true;
      }
      // The real error has to be kept: a generic message here would hide both a
      // 401 and a process that dies at startup.
      const reason = health.error ?? "health check failed";
      await this.stop();
      this.#fail(
        `opencode serve did not answer within ${this.#options.startupTimeoutMs}ms: ${reason}`,
      );
      return false;
    }

    return false;
  }

  async stop(): Promise<void> {
    this.#closing = true;
    this.#clients.clear();
    // The world servers have a different project root: without this they would
    // stay open and keep the campaign in memory.
    await this.#worlds.stopAll();
    const child = this.#child;
    this.#child = null;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      });
      child.kill();
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
    if (this.#status.state !== "error") {
      this.#status = { ...this.#status, state: "stopped", pid: null };
    }
  }

  async health(): Promise<HealthResult> {
    return this.probeHealth();
  }

  #fail(message: string): void {
    this.#status = {
      ...this.#status,
      state: "error",
      error: message === "" ? "opencode is not reachable" : message,
    };
  }

  #spawnServer(): boolean {
    const { file, args } = buildCommand(this.#options.binary, [
      "serve",
      "--port",
      String(this.#options.port),
      "--hostname",
      this.#options.host,
    ]);

    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        // No declared directory means "I don't know", and `opencode` starts from
        // the process's folder: that is the behaviour from before and it does not
        // concern the project roots, which cannot be inferred from here. Where
        // the directory is known, that is the one used.
        cwd: this.#primaryDirectory ?? undefined,
        shell: this.#options.binary.needsShell,
        windowsHide: true,
        // No pipe when it is not needed. A pipe left open on a child keeps the
        // parent's event loop alive: in development, on every save, `tsx watch`
        // restarts and the old process stays hanging until it gets killed,
        // killing the request in flight. The browser reads it as a dropped
        // connection. opencode's output is in its logs anyway, on disk.
        stdio: process.env.RPWB_DEBUG_OPENCODE === "1" ? ["ignore", "pipe", "pipe"] : "ignore",
      });
    } catch (error) {
      this.#fail(`Cannot start opencode: ${errorText(error)}`);
      return false;
    }

    // The child must not stop the parent from exiting: it is detached and closed
    // by hand in `stop`.
    child.unref();

    let spawnError: string | null = null;
    child.on("error", (error) => {
      spawnError = errorText(error);
      if (this.#child === child) {
        this.#fail(`Cannot start opencode: ${spawnError}`);
      }
    });

    // The child process must not inherit our stdout: if it did, any shell reading
    // from us would stay hanging even after the process is done. By default the
    // stream is drained into memory, and it is written only when explicitly
    // asked for.
    const verbose = process.env.RPWB_DEBUG_OPENCODE === "1";
    child.stdout?.on("data", (chunk: Buffer) => {
      if (verbose) process.stdout.write(`[opencode] ${chunk.toString()}`);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (verbose) process.stderr.write(`[opencode] ${chunk.toString()}`);
    });

    child.on("exit", (code, signal) => {
      if (this.#closing || this.#child !== child) return;
      this.#child = null;
      if (this.#status.state === "ready") {
        this.#status = {
          ...this.#status,
          state: "error",
          error: `opencode serve terminated (code ${code ?? "null"}, signal ${signal ?? "null"})`,
        };
      }
    });

    this.#child = child;
    this.#status = { ...this.#status, pid: child.pid ?? null };
    return spawnError === null;
  }

  async #waitForHealth(): Promise<HealthResult> {
    const deadline = Date.now() + this.#options.startupTimeoutMs;
    let last: HealthResult = { healthy: false, version: null, error: "not started yet" };

    while (Date.now() < deadline) {
      if (this.#status.state === "error") {
        return { healthy: false, version: null, error: this.#status.error };
      }
      last = await this.probeHealth();
      if (last.healthy) return last;
      await delay(HEALTH_POLL_INTERVAL_MS);
    }

    return { ...last, error: last.error ?? "timeout" };
  }

  async probeHealth(): Promise<HealthResult> {
    const url = `${this.#status.baseUrl}/global/health`;
    const credentials = readServerCredentials();
    const headers: Record<string, string> = {};
    if (credentials) headers["authorization"] = basicAuthHeader(credentials);

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(3_000),
        headers,
      });
      if (response.status === 401) {
        return {
          healthy: false,
          version: null,
          error:
            "The opencode server asks for authentication: set OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD.",
        };
      }
      if (!response.ok) {
        return { healthy: false, version: null, error: `HTTP ${response.status}` };
      }
      const body: unknown = await response.json();
      if (!isRecord(body)) {
        return { healthy: false, version: null, error: "unrecognized response" };
      }
      return {
        healthy: body["healthy"] === true,
        version: typeof body["version"] === "string" ? body["version"] : null,
        error: null,
      };
    } catch (error) {
      return { healthy: false, version: null, error: errorText(error) };
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
