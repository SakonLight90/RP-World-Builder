# Architecture

How the platform is put together, and the rules its code follows.

For how to run it, see [README.md](../README.md) and [GUIDE.md](GUIDE.md). For working
on the code, see [DEVELOPMENT.md](DEVELOPMENT.md).

## What it is made of

Three workspaces and no framework in the middle:

| Workspace | What it holds |
| --- | --- |
| `packages/shared` | types, the error contract, the settings, the token maths |
| `packages/server` | Fastify API, SQLite, the narrator bridge, the canon engine |
| `packages/web` | the Next.js interface |

The narrator is a separate program. The server starts `opencode serve` once per campaign
folder, writes a generated agent into `<campaign>/.opencode/agents/gm.md` with that
campaign's Bible inlined, and streams turns to it.

The primary server handles models, health and settings. Each campaign gets its own,
because opencode reads agents from the directory the server was started from and there is
no per-request way to change that; a campaign's narrator agent lives in that campaign's
folder, together with its Bible.

## The turn

A turn is created in the database before narration starts, so the interface can say the
narrator is writing and the tab can be reopened without losing the work. The text is
written in the background and read back from the database; the event stream is a preview,
not the truth.

A turn moves through: close the overdue chapters, inject canon and state, send the
player's action and stream the answer. Chapters close first so a full context is written
before the turn that would overflow it.

The outcome is one of `completed`, `failed`, or `running`. A `running` older than five
minutes is read as `stale`: a turn nobody is carrying forward must not be shown as one
that is still writing.

The context window is watched, and a chapter is written and the session compacted before
the model's ceiling is reached. When truncation does not reduce the history, a new
session is opened and the campaign's memory is carried into it.

## Rules

### 1. Paths come from one place

The project root is resolved once, at startup, and travels explicitly from there.
`process.cwd()` is never used to find the repository: it is the folder someone typed the
command in, not the folder the project is in, and a wrong one does not report itself as a
path problem.

Every module receives the roots; none investigates them. If a path was not passed to you,
that is a hole in the dependency graph, not a reason to look for it.

The root is found from where the module was loaded, which does not depend on who started
the process, recognised by a sentinel declared in the file rather than by a distance. It
does not count levels, so it survives a moved package, a renamed repository and a
different machine. When the sentinel is missing, the resolution says so and names the
environment variable, instead of returning a path that later shows up as a missing file.

### 2. The core does not know what a library is

The server holds no knowledge of any library: no section names, no formats, no slugs, no
word lists. A library describes itself in its manifest and an adapter reads that
description. Adding a second setting must not require naming anything in the code.

### 3. No hand-written path

Paths that end up in a generated file are derived, never typed. An absolute path written
into a source works on one machine and nowhere else.

### 4. Canon is not deduced

Every lore fact comes from the source or is declared unverified. A proper noun of the
canon is never translated and never localised. The database and the library must say the
same thing.

### 5. A change leaves no half-states

An empty result is an explicit case. A completed turn with no text is a failed turn: the
player cannot tell "the narrator went quiet" from "something went wrong".

### 6. A datum has a single owner

If two screens show it, both read from the same place, and one of them calls the other.
Three copies of a component are three versions that diverge.

This holds for errors too. `ApiError` distinguishes 404 from 503, so an absent narrator
and a deleted campaign are not the same line on screen. The pages that load data have a
failure state separate from "that turn failed".

### 7. A module does not read a format it does not know

A file's format is declared and validated by whoever produces it, or read by whoever knows
it. This holds for the database as well: a test that writes raw SQL instead of going
through the repository is a second schema to keep aligned.

### 8. The narrator's SDK lives behind a contract

`Narrator` in `opencode/narrator.ts` is the interface. The implementation is
`narrator-adapter.ts`. The tests use a fake written without a line of SDK. When the
contract changes, the fake and the adapter change with it.

The composition root keeps `OpencodeClient`, because it has to describe the real bridge
and an absent one must keep answering 503 without building a narrator.

### 9. Asking the model is one function

Opening a session, asking, reading the JSON and closing it is `askJson` in
`opencode/ask.ts`. It returns `null` for every failure, because every caller falls back the
same way.

### 10. A correction leaves a trace

`canon_audit` holds the reviewer's verdicts on a chapter's claims. `canon_edits` holds the
hand-made corrections, with the before value, the after value and a reason. They must not
be mixed: how many facts a model verified and how many a person changed are two numbers
with a very different weight.

### 11. A backup is complete or it is nothing

Export and import list the same sections. A file exported by an earlier version imports the
same way: missing fields are absent, not fatal. A reference that cannot be reconstructed
does not fail the rest of the import.

### 12. An id is the identity, not the content

`update` writes by id. Upserts may conflict on content, because that is what identifies an
entry when loading a corpus, but a correction must find the row it is correcting. An
imported copy gets new ids, so a correction on one does not touch the other.

### 13. A limit is tested on its shape

`Number("")` is `0`, not `NaN`. An optional parameter coming from outside is tested on its
shape before its value.

### 14. Save where something reads it back

The list of saved settings is closed, the schema is strict, and the save goes into the
place the server actually reads. A key silently ignored makes the user believe something
was saved that was not.

### 15. Routes live in their domain

Each domain registers its own routes and receives a shared scope. `routes.ts` is the
composition root: it builds the scope and mounts the modules.

| Module | Domain |
| --- | --- |
| `http/worlds.ts` | worlds, Bible, eras, export, import, corpus |
| `http/story.ts` | arcs and chapters |
| `http/cast.ts` | characters, locations, relationships, promotions |
| `http/canon.ts` | canon, search, corrections, history |
| `http/turns.ts` | turns, timeline, context, verification, reset |
| `http/system.ts` | models and settings |

### 16. The interface language is a setting

Five languages, each with its own catalog under `packages/web/src/i18n/`, and the one in
force is read once from the site's setting. Never from the browser, never from a component
default. The language the user chose has to hold on every screen, including the ones they
have never opened. English is the reference catalog and the runtime fallback.

The narrator's language is separate and per campaign. A campaign written in German from an
interface in another language is a legitimate combination.

### 17. A key added to English and forgotten elsewhere is a build failure

`en.ts` defines the key set; the other catalogs are typed against it, so a missing
translation does not compile. `packages/web/test/i18n.test.ts` adds the runtime guarantees:
every language carries every key, no value is blank, and the `{{placeholder}}` set matches
English everywhere. Word order belongs to the translator; the set of names does not.

### 18. One definition for the markers

The heading, silent prefix and the continue and retry requests live in
`packages/shared/src/markers.ts`, because two modules write and match them: the server
builds the context block and decides what is silent, the interface sends the continue and
retry requests. A duplicated marker is a string comparison that can fail on a translation
nobody was looking at.

### 19. An error the client invents carries a key

`ApiError` carries a key and its values, and the sentence is assembled where the language
is known. A `problem` written by the server passes through untranslated: it names a
server-side fact, and re-inventing it in the interface would trade a real explanation for
a generic one.

### 20. A migration moves a database forward

A migration file is the record of what the schema was on a given day, so the earlier ones
keep their original SQL. A new migration is a new file. `008_english_columns` rebuilds the
tables whose constraints and index names carried the old column names, because a rename
only renames the column.

### 21. A derived value does not depend on the machine that computes it

The library fingerprint is one: a requirement must not validate on one computer and fail
on another, and an ordering or a byte sequence that follows the operating system makes it
do exactly that. How the fingerprint is built is in [CANON.md](CANON.md).

### 22. The player is not the protagonist of the world

An opening narration sets up a situation. It does not hand the player a role the setting
already gave to somebody else. The narration says where you are and what is about to
happen; who you are belongs to the player. The prompt states the same rule to the narrator.

### 23. Two voices in the transcript, one presentation

The player's line and the narrator's answer are rendered with the same container and the
same body class. The only difference is who is speaking, stated in the line above. A
filled bubble in another colour and shape makes the player's turn read as something the
interface produced rather than the other half of the exchange.

## Repository rules

- `data/` is user state: deletable and regenerable, not content.
- `lore/` is immutable content, versioned as a requirement with a hash.
- `corpus/` is source, edited by hand.
- `dist/` is build output: never committed, never read as source.

## Where things live

| Thing | Where | Owner |
| --- | --- | --- |
| roots and overrides | `packages/server/src/config/paths.ts` | the server |
| a library's descriptor | `lore/<id>/library.yaml` | the library |
| reading a library | `packages/server/src/lore/` | the server, through the adapter |
| a library's fingerprint | `hashLibrary` in `packages/server/src/lore/registry.ts` | the server |
| source canon | `corpus/<world>/entries/` | the corpus |
| active canon | table `canon_entries`, scoped by `world_id` | `CanonRepository` |
| manual corrections | table `canon_edits`, scoped by `world_id` | `CanonRepository` |
| reviewer's verdicts | table `canon_audit`, scoped by `world_id` | `CanonRepository` |
| narrator prompt | `packages/server/prompts/gm.md` | the server |
| a campaign's starts | `starts` in `corpus/<world>/world.yaml`, column `worlds.starts` | the corpus declares, the player picks |
| opencode agents | `<campaign>/.opencode/agents/` | generated, never hand-written |
| narrator contract | `packages/server/src/opencode/narrator.ts` | the server |
| opencode SDK | `narrator-adapter.ts`, `bridge.ts` | the adapter, and nothing else |
| the model catalogue | `opencode/catalog-cache.ts` | the app context, shared by health and `/api/models` |
| what marks a turn as not the player's | `packages/shared/src/markers.ts` | `shared`, one definition |
| interface catalogs | `packages/web/src/i18n/` | the translators, checked by `packages/web/test/i18n.test.ts` |
| a turn's deadline and outcome | `packages/server/src/http/turn-coordinator.ts` | the server, not HTTP |
| shared scope of the routes | `packages/server/src/http/scope.ts` | the composition |
| error messages | `ApiError` in `packages/web/src/lib/api.ts` | the page that shows them |

## Before writing code

1. Which module owns this datum? If none does, there is a hole.
2. Where does the path come from? If the answer is `process.cwd()`, it is wrong.
3. How will it be checked? A test that fails without the change.
4. What stays out? Dead code and leftovers.
5. Does this code know something it should not? An SDK type, a table name, another
   party's file format.
6. If it corrects something the user believed, where does the trace of before and after
   stay?