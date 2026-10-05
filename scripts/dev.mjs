#!/usr/bin/env node
/**
 * One command for the whole project: the API and the interface, together.
 *
 * It exists because "two terminals" is how it was started before, and two
 * terminals is how a process gets left behind: close the wrong window, or close
 * neither, and a server is still listening on its port hours later with nothing
 * owning it. One command, one Ctrl+C, nothing left over.
 *
 * Three behaviours worth stating, because they are the reason this is a script
 * and not `npm-run-all`:
 *
 * - **The whole tree dies, not just the wrapper.** `npm run dev` is three
 *   processes (npm, a shell, tsx). Killing the one you spawned leaves the other
 *   two holding the port. On Windows that means `taskkill /T`, because there is
 *   no process group to signal.
 * - **If one side dies, the other goes too.** Half a project — an interface
 *   whose API is gone — looks like a bug in the interface.
 * - **Output is prefixed, not interleaved.** Two unlabelled streams in one
 *   terminal produce a stack trace that belongs to the other process.
 */

import { spawn } from "node:child_process";
import process from "node:process";

/**
 * Two modes, because they are not the same thing with a different log level.
 *
 * In development `next dev` recompiles a page on every request: measured on this
 * project, `/` took 3121 ms that way and 17 ms built. Anything measured in
 * development is therefore a measurement of the compiler, not of the product.
 * Production runs the compiled server and `next start`.
 */
const PRODUCTION = process.argv.includes("--production") || process.argv.includes("-p");

/** The two halves, each with the label its output will carry. */
const TARGETS = PRODUCTION
  ? [
      {
        name: "api",
        colour: "[36m",
        command: "node",
        args: ["packages/server/dist/index.js"],
      },
      {
        name: "web",
        colour: "[35m",
        command: "npm",
        args: ["run", "start", "-w", "@rpwb/web"],
      },
    ]
  : [
      {
        name: "api",
        colour: "[36m",
        command: "npx",
        args: ["tsx", "watch", "--clear-screen=false", "packages/server/src/index.ts"],
      },
      {
        name: "web",
        colour: "[35m",
        command: "npm",
        args: ["run", "dev", "-w", "@rpwb/web"],
      },
    ];

const RESET = "[0m";
const DIM = "[2m";

const children = [];
let shuttingDown = false;
let exitCode = 0;

/** Windows needs `taskkill /T`; elsewhere a detached group can be signalled. */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    // Negative pid: the whole group, which is why the children are detached.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\n${DIM}${reason}${RESET}\n`);
  for (const child of children) killTree(child);
}

function label(target, stream, chunk) {
  const text = chunk.toString();
  // A chunk can end mid-line, and half a line would be printed without its
  // label while the rest gets one. The remainder waits for its own newline.
  target[stream] += text;
  const lines = target[stream].split("\n");
  target[stream] = lines.pop() ?? "";
  for (const line of lines) {
    process.stdout.write(`${target.colour}${target.name}${RESET} ${line}\n`);
  }
}

for (const target of TARGETS) {
  target.stdout = "";
  target.stderr = "";

  const child = spawn(target.command, target.args, {
    // `shell` so that `npm`/`npx` resolve on Windows, where they are `.cmd`
    // shims and not executables.
    shell: process.platform === "win32",
    // A process group of its own, so the kill above reaches the grandchildren.
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      // The server defaults to `warn` and says nothing when it starts, which in
      // a terminal shared with the interface reads as "the api half is broken".
      // Only set when the caller has not already chosen a level.
      RPWB_LOG_LEVEL: process.env.RPWB_LOG_LEVEL ?? "info",
    },
  });

  child.stdout.on("data", (chunk) => label(target, "stdout", chunk));
  child.stderr.on("data", (chunk) => label(target, "stderr", chunk));

  child.on("error", (error) => {
    process.stdout.write(
      `${target.colour}${target.name}${RESET} could not start: ${error.message}\n`,
    );
    exitCode = 1;
    shutdown("stopping the other side too");
  });

  child.on("exit", (code, signal) => {
    // Flush whatever was written without a trailing newline.
    if (target.stdout !== "") {
      process.stdout.write(`${target.colour}${target.name}${RESET} ${target.stdout}\n`);
    }
    if (shuttingDown) return;

    if (code !== 0 && code !== null) {
      exitCode = code;
      process.stdout.write(
        `${target.colour}${target.name}${RESET} exited with code ${code}${signal ? ` (${signal})` : ""}\n`,
      );
      shutdown("one side stopped, so the other is stopping too");
    }
  });

  children.push(child);
}

process.stdout.write(
  [
    "",
    PRODUCTION
      ? `${DIM}Production build. Pages are served as compiled, not recompiled per request.${RESET}`
      : `${DIM}Development build. Pages are compiled on request: anything slow here is the compiler.${RESET}`,
    `${DIM}api  ${RESET}http://127.0.0.1:3311   ${DIM}(override with RPWB_DATA / config)${RESET}`,
    `${DIM}web  ${RESET}http://127.0.0.1:3310`,
    "",
    `${DIM}Ctrl+C stops both.${RESET}`,
    "",
  ].join("\n"),
);

// `SIGINT` is what Ctrl+C delivers; `SIGTERM` is what a supervisor sends. Both
// have to end the same way or a `kill` leaves the port held.
process.on("SIGINT", () => {
  shutdown("interrupted");
});
process.on("SIGTERM", () => {
  shutdown("terminated");
});

// Nothing to keep the loop alive on its own: the children's pipes do that.
setTimeout(() => undefined, 2 ** 30 - 1);

process.on("exit", () => {
  for (const child of children) killTree(child);
  process.exit(exitCode);
});
