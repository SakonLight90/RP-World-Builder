import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BinaryKind = "native" | "exe" | "shim";

export interface OpencodeBinary {
  path: string;
  kind: BinaryKind;
  /**
   * The shims npm generates on Windows (`.cmd`, `.ps1`) are not executable with
   * `spawn` without a shell. Where possible we prefer the real `.exe`.
   */
  needsShell: boolean;
}

const WINDOWS_EXT = new Set([".cmd", ".bat", ".ps1"]);

function classify(path: string): OpencodeBinary {
  const lower = path.toLowerCase();
  if (lower.endsWith(".exe")) return { path, kind: "exe", needsShell: false };
  const dot = lower.lastIndexOf(".");
  if (dot !== -1 && WINDOWS_EXT.has(lower.slice(dot))) {
    return { path, kind: "shim", needsShell: true };
  }
  return { path, kind: "native", needsShell: false };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Paths where global npm ends up on Windows, to find the real executable. */
function npmGlobalBinCandidates(): string[] {
  const candidates: string[] = [];
  const appData = process.env.APPDATA;
  if (appData) {
    candidates.push(join(appData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(
      join(localAppData, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"),
    );
  }
  return candidates;
}

async function whichAll(name: string): Promise<string[]> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, [name], {
      timeout: 10_000,
      windowsHide: true,
    });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
  } catch {
    return [];
  }
}

/**
 * Preference order, from most reliable to least.
 *
 * On Windows npm generates three shims: `opencode` (an extension-less POSIX
 * script), `opencode.cmd` and `opencode.ps1`. The extension-less one looks like a
 * binary but is not: `where` returns it first and without this ranking it would
 * be launched without a shell and fail immediately. The npm package also
 * contains the real `opencode-ai/bin/opencode.exe`, which is the one we want.
 */
function rank(candidate: OpencodeBinary): number {
  if (candidate.kind === "exe") return 0;
  if (process.platform === "win32") return candidate.kind === "shim" ? 2 : 3;
  return candidate.kind === "native" ? 1 : 4;
}

export async function resolveOpencodeBinary(): Promise<OpencodeBinary | null> {
  const override = process.env.OPENCODE_BINARY;
  if (override && override.trim() !== "" && (await exists(override.trim()))) {
    return classify(override.trim());
  }

  const found = await whichAll("opencode");
  const candidates = found.map((path) => classify(path));
  for (const known of npmGlobalBinCandidates()) {
    if (await exists(known)) candidates.push(classify(known));
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => rank(a) - rank(b));

  // The ranking says what *should* work; the probe decides. A candidate that
  // does not answer `--version` is discarded and the next one is tried.
  for (const candidate of candidates) {
    const version = await probeOpencodeVersion(candidate);
    if (version !== null) return candidate;
  }

  return null;
}

function quote(path: string): string {
  return /[\s"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path;
}

/**
 * Arguments built as a string when the shell is needed, because with
 * `shell: true` Node concatenates the arguments without quoting them.
 */
export function buildCommand(
  binary: OpencodeBinary,
  args: string[],
): { file: string; args: string[] } {
  if (!binary.needsShell) return { file: binary.path, args };
  return { file: quote(binary.path), args };
}

export async function probeOpencodeVersion(binary: OpencodeBinary): Promise<string | null> {
  try {
    const { file, args } = buildCommand(binary, ["--version"]);
    const { stdout } = await execFileAsync(file, args, {
      timeout: 20_000,
      windowsHide: true,
    });
    const version = stdout.trim().split(/\r?\n/)[0]?.trim() ?? "";
    return version === "" ? null : version;
  } catch {
    return null;
  }
}
