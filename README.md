# RP World Builder

A local roleplay platform with an AI narrator. The canon and the campaign stay on your
machine.

## What it is

You make a campaign: a world, its Bible, its eras, its arcs, its characters, its places,
its relationships, and the ways into it. You write what your character does. The narrator
answers with what happens next, in prose, in the language you set for that campaign.

What makes it different from a chat window with a model attached is the **canon**. A model
asked about a setting it half knows will invent a street, a faction, a quest that never
existed, and it will invent them in the same tone as the ones that did. So the canon is not
in the prompt: it is a **library of verified entries** the server opens read-only and hands
to the narrator as reference, the way you would hand a historian a shelf.

| | |
| --- | --- |
| Interface languages | 5 — English, Italiano, Español, Français, Deutsch |
| Tests | 736, run by `npm run verify` |

## The three things it does that a chat window does not

**The narrator cannot drift out of canon, because it does not improvise canon.** The canon
is injected as a reference, not as instructions, and the agent is told to use a name only
if the name is in the library or in the campaign's own Bible. When the narrator cites
something, you can look up whether it was there.

**Chapters close before the context is full, not after.** A long campaign would degrade: the
narrator starts contradicting itself, forgetting who is who. So the session is watched, and
when it passes a fraction of the context window the chapter is written, summarised and
compacted, and play goes on.

**The canon is pinned by hash.** A campaign does not contain the lore, it requires it, by
name and version and fingerprint. Change the library and the project says so instead of
quietly narrating something else.

The platform is not tied to one setting. A campaign declares the lore it needs, and any
library that follows the format can be required. One library ships with the project; the
rest of the platform does not change when another one is added.

## It runs on your machine

The canon, the campaigns, the chapters and the settings never leave the computer. The only
thing that does is the prompt, to whichever provider serves the model you chose.

That list is not a promise in a readme: `packages/server/src/principles.ts` declares the
allowed dependencies and the words that must not appear in the source, and a test fails the
build if something contradicts it. A telemetry package or a payment SDK cannot get in
without breaking the suite.

## Quick start

**Node.js 22.12 or newer**, and [`opencode`](https://opencode.ai) installed and on `PATH`.
The narrator is a model the platform does not contain: the server finds the `opencode`
binary, starts `opencode serve` and talks to it.

| | |
| --- | --- |
| Windows | `start.bat` |
| Ubuntu, Linux | `chmod +x start.sh` once, then `./start.sh` |

Both install the dependencies on the first run, start the API and the interface together,
say which half is speaking, and stop both on one Ctrl+C. Then open
<http://127.0.0.1:3310>.

## Documentation

| | For |
| --- | --- |
| **[docs/GUIDE.md](docs/GUIDE.md)** | playing and running campaigns: the narrator, the campaign page, the context window, backup |
| **[docs/CANON.md](docs/CANON.md)** | how the canon works: libraries, requirements, the hash, how to write one |
| **[docs/LIBRARY-FALLOUT.md](docs/LIBRARY-FALLOUT.md)** | the library that ships with the project: what is in it and how to verify it |
| **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** | working on the code: layout, scripts, tests, conventions |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | how it is put together and the rules its code follows |

## How it is put together

Three workspaces and a database, no framework in the middle:

```
packages/shared    types, the error contract, the settings, the token maths
packages/server    Fastify API, SQLite, the narrator bridge, the canon engine
packages/web       Next.js interface
lore/              the libraries, read-only, shared by every campaign
corpus/            campaign templates
```

The narrator is a separate program. The server starts `opencode serve` once per campaign
folder, writes a generated agent into `.opencode/agents/gm.md` with that campaign's Bible
inlined, and streams turns to it. The interface is a separate Next.js process on `3310`; the
API is on `3311`.

The libraries are plain text under `lore/`, readable and editable by hand.

## What it will not do

- No account, and nothing mandatory to sign up for
- No telemetry, no analytics, no error reporting to a third party
- No advertising, no banners, no affiliate links
- No store, and nothing that can be bought
- No in-app purchase mechanism of any kind

## Licence

None, by decision. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#licence).