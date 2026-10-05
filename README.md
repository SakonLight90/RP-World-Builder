# RP World Builder

A local roleplay platform with an AI narrator. The canon and the campaign stay on
your machine.

The platform is not tied to one setting. A campaign declares the lore it needs by
name, version and hash, and any library that follows the format can be required.
Fallout is the example that ships: 7,069 verified entries across nine games, and a
template campaign for Appalachia 2287. Another setting means another library, and the
rest of the platform does not change.

## What it is

You make a campaign: a world, its Bible, its eras, its arcs, its characters, its
places, its relationships. You write what your character does. The narrator answers
with what happens next, in prose, in the language you set for that campaign.

What makes it different from a chat window with a model attached is the **canon**. The
narrator does not remember Appalachia, and a model asked about Morganthown will
invent a street. So the canon is not in the prompt: it is a **library of verified
entries** that the server opens read-only and hands to the narrator as reference, the
way you would hand a historian a shelf.

| | |
| --- | --- |
| Verified canon entries | **7,069** |
| Games covered | 9 — Fallout, 2, 3, 4, 76, Tactics, Shelter, Brotherhood of Steel, New Vegas |
| Campaign template | Appalachia 2287, with 118 canon entries of its own |
| Interface languages | 5 — English, Italiano, Español, Français, Deutsch |
| Tests | 645, run by `npm run verify` |

Every one of those 7,069 entries was checked against the Fallout Wiki, title by
title, and the ones that turned out to belong to the television series, to a novel or
to a tabletop game were removed. What is left is canon that came out of a game.

## The three things it does that a chat window does not

**The narrator cannot drift out of canon, because it does not improvise canon.** The
canon is injected as a reference, not as instructions, and the agent is told to use a
name only if the name is in the library or in the campaign's own Bible. When the
narrator cites something, `npm run corpus:validate` and the campaign's own health
check can tell you whether it was in the canon at all.

**Chapters close before the context is full, not after.** A long campaign would
degrade: the narrator starts contradicting itself, forgetting who is who. So the
session is watched, and when it passes a fraction of the context window the chapter is
written, summarised and compacted, and play goes on. You get a campaign that can run
for a year instead of one that dies at the token ceiling.

**The canon is pinned by hash.** A campaign does not contain the lore, it requires it,
by name and version and fingerprint. Change the library and the project says so instead
of quietly narrating a different Appalachia.

## It runs on your machine

The canon, the campaigns, the chapters and the settings never leave the computer. The
only thing that does is the prompt, to whichever provider serves the model you chose.

That list is not a promise in a readme: `packages/server/src/principles.ts` declares
the allowed dependencies and the words that must not appear in the source, and a test
fails the build if something contradicts it. A telemetry package or a payment SDK
cannot get in without breaking the suite.

## Quick start

**Node.js 22.12 or newer**, and [`opencode`](https://opencode.ai) installed and on
`PATH`. The narrator is a model the platform does not contain: the server finds the
`opencode` binary, starts `opencode serve` and talks to it.

| | |
| --- | --- |
| Windows | `start.bat` |
| Ubuntu, Linux | `chmod +x start.sh` once, then `./start.sh` |

Both install the dependencies on the first run, start the API and the interface
together, say which half is speaking, and stop both on one Ctrl+C. Then open
<http://127.0.0.1:3310>.

Everything else is in the guides:

| Guide | For |
| --- | --- |
| **[docs/GUIDE.md](docs/GUIDE.md)** | playing and running campaigns: the narrator, the campaign page, the context window, backup |
| **[docs/CANON.md](docs/CANON.md)** | the verified lore library: what is in it, how a campaign requires it, how to extend it |
| **[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)** | working on the code: layout, scripts, tests, conventions |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | the twenty rules the code is shaped by, and why each one exists |

## How it is put together

Three workspaces and a database, no framework in the middle:

```
packages/shared    types, the error contract, the settings, the token maths
packages/server    Fastify API, SQLite, the narrator bridge, the lore engine
packages/web       Next.js interface
lore/fallout       the verified library, read-only, shared by every campaign
corpus/            campaign templates; appalachia-2287 is the one that ships
```

The narrator is a separate program. The server starts `opencode serve` once per
campaign folder, writes a generated agent into `.opencode/agents/gm.md` with that
campaign's Bible inlined, and streams turns to it. The interface is a separate Next.js
process on `3310`; the API is on `3311`.

Nothing in the repository is a licence, and nothing points anywhere: no attribution
file, no source links, no telemetry. The lore is plain text in `lore/`, readable and
editable by hand.

## What it will not do

- No account, and nothing mandatory to sign up for
- No telemetry, no analytics, no error reporting to a third party
- No advertising, no banners, no affiliate links
- No store, and nothing that can be bought
- No in-app purchase mechanism of any kind

## Licence

None. The project carries no licence, by decision: see the note in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#licence).
