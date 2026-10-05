#!/usr/bin/env bash
#
# Starts the platform on Ubuntu and Linux: the API and the interface, together.
#
# Everything this script does before starting is a check, and every check ends
# in a sentence a person can act on. A launcher that fails obscurely is worse
# than one that refuses to start: "it says nothing" is indistinguishable from
# "it is still starting".

set -euo pipefail

# The folder name can contain a space, so the directory is quoted and resolved
# through a symlink: reached as ./start.sh, as an absolute path or through a
# link in ~/bin, it has to land in the same place.
cd "$(dirname "$(readlink -f "$0")")"

echo "Starting RP World Builder..."
echo

# --- 1. Node -----------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  {
    echo
    echo "Node.js was not found on PATH."
    echo "Install Node.js 22.12 or later, for example:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    echo "then run this file again."
  } >&2
  exit 1
fi

# --- 2. The Node version this project asks for --------------------------------
# Read from package.json rather than repeated here, so the two cannot disagree.
# The message comes from the same command that decides, which is why the number
# in it is the real one and not a copy.
if ! node -e '
  const p = require("./package.json");
  const have = Number(process.versions.node.split(".")[0]);
  const want = (p.engines && p.engines.node) || "";
  const need = Number((want.match(/\d+/) || [0])[0]);
  if (have < need) {
    console.error(
      `Node ${process.versions.node} is installed, but this project asks for ${want}.`,
    );
    console.error("Install a newer Node.js, then run this file again.");
    process.exit(1);
  }
'; then
  exit 1
fi

# --- 3. npm ------------------------------------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  {
    echo
    echo "npm was not found on PATH. It normally arrives with Node.js."
    echo "On Debian and Ubuntu it is often a separate package: sudo apt-get install npm"
  } >&2
  exit 1
fi

# --- 4. The ports, before anything tries to bind them -------------------------
# A warning, not a refusal: something else may legitimately hold the port, and
# this script does not own that decision.
for port in 3310 3311; do
  if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"; then
    echo "Warning: something is already listening on port $port."
    echo "The half that wants that port will fail. Close the other program, or change the port."
    echo
  fi
done

# --- 5. Dependencies ---------------------------------------------------------
# The real question is not "does the folder exist": a half-finished install, a
# deleted package, or a dependency added since the last install all leave the
# folder in place. scripts/check-deps.mjs asks whether every declared dependency,
# and every command this project runs, is actually there, and names what is
# missing.
if ! node scripts/check-deps.mjs; then
  echo "Installing dependencies with npm ci. The first run takes a while."
  if ! npm ci; then
    {
      echo
      echo "Installing the dependencies failed. The lines above say why. The usual"
      echo "causes are no network, or package-lock.json out of step with package.json."
    } >&2
    exit 1
  fi
  echo
fi
# --- 6. Build, unless development ---------------------------------------------
# Production serves compiled output, so it cannot be skipped or taken on trust: a
# stale build is a build of code that no longer exists. Rebuilding takes about a
# minute, so it happens only when a source is newer than the build.
if [ "${1:-}" != "--development" ]; then
  if ! node scripts/check-build.mjs; then
    echo "Building. This takes about a minute."
    npm run build
    npm run build:web
    node scripts/stamp-build.mjs
    echo
  fi
fi

# --- 7. Start ----------------------------------------------------------------
echo "Interface: http://127.0.0.1:3310"
echo "API:       http://127.0.0.1:3311"
echo "Ctrl+C stops both."
echo

# `exec`, so this shell is replaced by npm: the terminal's Ctrl+C is delivered
# straight to it, and to the dev script behind it, instead of being swallowed by
# a wrapper that is no longer in the chain. Without it, Ctrl+C would stop this
# script and leave both servers holding their ports.
if [ "${1:-}" = "--development" ]; then
  exec npm run dev
fi
exec npm run serve