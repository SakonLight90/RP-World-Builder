# Architecture

Project rules. They are here because they have been broken more than once, and each
time it cost a debugging session.

## How you check that these rules hold

Don't read the code to work out whether it is all right: run these four commands.
They are the check, and each one has already found a real defect.

| Command | What it guarantees |
| --- | --- |
| `npm test` | 641 non-live tests in 45 files; the 3 `.live.test.ts` files are excluded and run with `npm run test:live` |
| `npm run typecheck` | No cast hiding a `null`, no `any` bouncing back |
| `npm run lint` | Formatting and unused imports |
| `npm run corpus:validate` | The corpus files parse, every era they use exists, and the required libraries match what is on disk |

A fifth check is not automatic, and it is the one that found the most serious
defects: **start the server and call the routes**. Two examples, neither of them
visible from the tests:

- `export` and `import` both answered 200 and copied five sections out of
  fourteen. The canon, the eras and the required libraries were lost, and an
  incomplete backup is worse than no file.
- `POST /relationships` wrote `worldId` from the URL without checking that the two
  characters belonged to that world: a relationship between characters from another
  campaign ended up in this cast, and for the narrator reading it was true.

## Current operating map

Fastify backend plus SQLite, Next plus React frontend, bridge to opencode:

- development backend: `npm run dev`, by default on `http://127.0.0.1:3311`;
- development frontend: `npm run dev -w @rpwb/web`, by default on port `3310`;
- API address read by the frontend: `RPWB_API`, by default `http://127.0.0.1:3311`;
- full local check: `npm run verify`, which chains build, typecheck, lint and test;
- tests with a real model: `npm run test:live`;
- corpus health: `npm run corpus:validate`;
- database migrations: versions `1`–`8`, with `008_english_columns` as the last one.

The application's data lives in the local database. The browser keeps only the
failed prompts that did not become turns, and the interface's transient state.
The model provider can be remote through opencode: local are canon, campaign and
state, not necessarily inference.

The turn is created right away with a `turnId`; the text is written in the
background and read back from the database. The stream is only a preview. The
reset opens a new session, zeroes the message bookmark and deletes the world's
cast; it leaves canon, eras, Bible, arcs and chapters alone.

Routes use `{ problem: string }` for predictable errors, `404` for a world that
does not exist and `503` when opencode is unavailable. The frontend tells these
cases apart because an intact campaign without a narrator must not look like a
lost campaign.

## 1. Paths come from one place only

The project root is resolved **once**, at startup, and travels from there
explicitly. `process.cwd()` is never used to work out where the repository is: it
is the cheapest and quietest way to be wrong. If the server starts from another
folder, `process.cwd()` points somewhere else and the project finds neither corpus
nor libraries, without saying that the problem is the path.

Rule: **every module receives the root, it does not investigate it.** If you need
a path, it is passed to you; if it was not passed to you, that is a bug in the
dependency graph, not a reason to call `process.cwd()`.

Environment variables are the only legitimate override, and every override has a
default that works: see `packages/server/src/config/paths.ts`.

### How the repository root is found

`process.cwd()` is the folder someone typed the command in, not the folder the
project is in: the two coincide only if the command was typed inside the
repository. The root is therefore looked for **from where the code was loaded**,
which does not depend on who started the process, and it is recognised by a
sentinel declared inside the file and not by a distance:

| Root | Sentinel | Override |
| --- | --- | --- |
| server package | `package.json` with `name: "@rpwb/server"` | none: it is where the code is |
| repository | `package.json` with `workspaces` | `RPWB_REPO_ROOT` |
| corpus | `corpus/` in the root | `RPWB_CORPUS_ROOT` |
| libraries | `lore/` in the root | `RPWB_LORE_DIR` |
| prompt | `prompts/` in the package | `RPWB_PROMPTS_DIR` |
| data and worlds | system data folder | `RPWB_DATA_DIR` |

The count does not count levels, so it does not break when the package moves,
when the repository is renamed, or when starting from another machine. If the
sentinels are not there, `paths.ts` says so and names `RPWB_REPO_ROOT`, instead
of returning an invented path: an invented path later shows up as "the library is
missing", which is the wrong diagnosis.

`packages/server/test/project-roots.test.ts` covers the decision: it resolves the
roots with the process started from a folder holding a doctored `corpus/`, a
`lore/` and a `package.json`, and checks that no server module calls
`process.cwd()`.

## 2. The core does not know what a library is

The server holds no knowledge of any library: no section names, no formats, no
slugs, no word lists. A library **describes itself** in the manifest and an
adapter reads that description.

If making a library work meant naming something in the code that belongs to that
library, you wrote it in the wrong place.

## 3. No hand-written absolute path

Permissions and paths that end up in a generated file must be derived, never
typed. An absolute path written into a source file works on the machine of
whoever wrote it and nowhere else.

## 4. Canon is not deduced

Every lore fact comes from the source or is declared unverified. The proper nouns
of the canon are never translated and never localised, not even in a comment, not
even in a test. The database and the library must say the same thing: if they
contradict each other, that is a defect.

## 5. A DB change leaves no half-states

If a function can produce an empty result, the empty result is an explicit case:
not "good enough". A `completed` row with no text is a failed turn: the player
cannot tell "the narrator went quiet" from "something went wrong".

## 6. Things shown to the user have a single owner

A datum has a single source. If two screens show it, both must read from the same
place, and if one of the two is the right one, the other calls the first. Three
copies of the same component are three versions that diverge, and they diverge.

This holds for the pickers too: `ModelPicker` and `ReasoningPicker` are components
shared by the world page and the chat. `LocalePicker` is shared as a component,
but at the moment it is mounted only in the chat; the creation page still uses
separate controls for model and reasoning power. A hand-duplicated picker is not
a local variant: it is a second implementation bound to diverge.

**And it holds for errors.** A failed load that shows nothing leaves an empty
page, which is indistinguishable from a campaign that was just created and is
still empty. `ApiError` existed and knew how to tell 404 from 503, and it was
imported by no page: an opencode 503 not listening and a deleted world were the
same line on screen. The pages that load data have a failure state separate from
"that turn failed", because they are two different things and one erases the
other.

## 7. A component must not depend on another's format

A module that does not know a file's format must not read it with regexes. Either
the format is declared and validated by whoever produces it, or it is read by
whoever knows it.

This holds for the database too. A test that writes `INSERT INTO canon_entries`
instead of using `CanonRepository` is a second schema to keep aligned, and it is
wrong before it notices that it is wrong.

## 8. The narrator's SDK lives behind a contract

`OpencodeClient` is the type of the opencode SDK and must not appear as a
parameter outside `opencode/`. Whoever needs to talk to the narrator depends on
`Narrator` (`opencode/narrator.ts`), not on the client.

The reason is practical: the SDK's types had arrived in twelve modules, and a
version change to the SDK touched twelve files with a compile error far from the
cause. With the contract, the SDK stays in `narrator-adapter.ts` and in
`bridge.ts`, and there is a test that implements `Narrator` in twenty lines
without a line of SDK: if that test keeps passing, the substitution is real and
not declared.

`RouteDeps.bridge` stays in terms of `OpencodeClient` and is the right choice: it
is the composition root, it has to describe the real bridge, and `bridge: null`
must keep answering 503 without having to build a narrator.

## 9. Asking the model is one function

The "open a session, ask, read the JSON, close" skeleton is in
`opencode/ask.ts`. Not because it is hard, but because it was written by hand in
four places under `canon/` and in two of them it was identical line for line:
four copies mean that a fix — for example closing the session even when parsing
fails — is applied to one copy only and the others keep losing it.

`askJson` returns `null` for every failure instead of telling the causes apart,
because **all four callers have the same fallback behaviour**. If one day it
becomes necessary to tell "the model did not answer" from "it answered nonsense",
the return changes and it changes here, not in four places.

## 10. A correction is not a fact: every correction leaves a trace

Two tables, two purposes:

- `canon_audit` are the **reviewer's verdicts** on a claim from a chapter.
- `canon_edits` are the **hand-made corrections**, with before value, after value
  and reason.

They must not be mixed. Asking how many facts were verified by the model and how
many were changed by a person are two numbers with a very different weight, and in
a single table the question has no answer.

And they must not be confused with the `turns` table: a turn's state is the truth
about how the work went, not an audit of who wrote it.

## 11. A backup must be complete, or it is not a backup

Export and import must list the same sections. They were separated for months: the
first wrote nine, the second read five, and the missing sections were canon, eras,
required libraries and world settings. It answered 200, so it looked like it
worked.

Two rules come from there:

- a file exported by an earlier version imports the same way: missing fields are
  treated as absent;
- a reference that cannot be reconstructed does not fail the import of the rest.
  The file is already partly unreadable: making it fail entirely means an orphan
  relationship also loses the three eras.

## 12. An id is the identity, not the content

`CanonRepository.upsertMany` conflicts on `(world, subject, era)`, that is on what
identifies an entry **by content**. It is fine for loading a corpus.

It is not fine for correcting one. The subject is the first field a user corrects,
and correcting it found no conflict: the route tried to insert a new row with the
same id and the database refused it. The field that gets corrected first was not
correctable.

So `update(worldId, id, entry)` writes by **id**, which is the identity, and
returns `false` if the entry does not exist, so the route tells "there is none"
from "updated". They are different answers.

The same rule holds in `import`: a copy does not reuse the original's ids, or a
correction made on one of the two would touch the other with nothing saying so.

## 13. A limit that is not written is a limit that does not exist

`Number("")` is `0`, not `NaN`. A route that did
`Number.isFinite(Number(query)) ? limit(Number(query)) : did_not_limit` with an
empty string became "limit to zero", `Math.max` raised it to one, and the list
returned **always a single row**. It looked like a whole list and it was not: that
is the worst way a list can lie.

Rule: a parameter that comes from outside and is optional must be tested on its
**shape** before its value. `query !== "" && Number.isFinite(...)`, not only
`Number.isFinite(...)`.

## 14. Save where someone reads it back

`PUT /api/settings` accepted any key and wrote it as a string into a table nobody
read: the server reads port, host and models from the configuration file at
startup. Saving "port" in the database changed nobody's port, but it answered 200
as if it had.

Now the list is closed (`uiLocale`, `preferredModel`, `preferredSmallModel`,
`setupCompleted`), the schema is strict instead of permissive, and the save goes
into the real file. A key silently ignored would make you believe you had saved
something that was not saved, which is the same defect in different clothes.

## 15. The routes live in their domain, not in a single file

`routes.ts` used to hold every route and every helper: to touch turns you also had
to go through canon. Now each domain registers its own routes and receives a
shared scope (`http/scope.ts`):

| Module | Domain |
| --- | --- |
| `http/worlds.ts` | worlds, Bible, eras, export, import, corpus |
| `http/story.ts` | arcs and chapters |
| `http/cast.ts` | characters, locations, relationships, promotions |
| `http/canon.ts` | canon, search, corrections, history |
| `http/turns.ts` | turns, timeline, context, verification, reset |
| `http/system.ts` | models and settings |

`routes.ts` stays the composition root: it creates the scope, mounts the check for
a world that does not exist and calls the six modules. No behaviour changed in the
split, and the tests are the proof: none of them was touched to make it pass.

## 16. The interface language is a setting, not a guess

The interface ships five languages — `en`, `it`, `es`, `fr`, `de` — each with its
own catalog file under `packages/web/src/i18n/`, and the one in force comes from
the site's `uiLocale` setting, read **once** in `I18nProvider`. Never from the
browser, never from a component default. English is both the reference catalog and
the runtime fallback.

The reason is that the language is a choice the user made once, in `/setup`, and it
has to hold on every screen, including the ones they have never opened. A browser
header would make one installation speak five different languages on five
machines; a component default would leave every screen nobody had visited speaking
the wrong language until it was visited, and the components are exactly where
nobody looks for the reason. Reading the setting once, in one provider, is what
makes "every screen" true rather than "every screen that remembered to ask".

English is the reference catalog because it is the one that defines the key set
(section 17), and the fallback because the code is English: a half-translated page
is worse than one that shows English in the gaps, and only a catalog without holes
is a fallback that can be relied on.

The first paint happens before the settings arrive, so it uses the fallback. That
is a deliberate short flash and not a `suppressHydrationWarning` trick on
`<html lang>`: the server cannot know the language, so it states the one it can
guarantee, and the real one replaces it as soon as the fetch lands. From there
`document.documentElement.lang` follows the resolved locale, and it is not
decoration: it drives the browser's own hyphenation, spellcheck and screen-reader
pronunciation.

Do not confuse it with the narrator's language, which is a per-world setting: a
campaign can be written in German from an interface in another language. The two
are unrelated, and `I18nProvider` says so where it reads the value.

## 17. A key added to English and forgotten elsewhere is a build failure

`en.ts` defines the key set, and `it`, `es`, `fr`, `de` are typed
`Record<MessageKey, string>`, so a missing translation does not compile.
`packages/web/test/i18n.test.ts` adds the runtime guarantees: every language
carries every key, no value is blank, and the `{{placeholder}}` set of every key
matches English in every language.

The reason for the type is that a key added to English and forgotten in another
language otherwise reaches a screen as a hole, and a hole is invisible until
somebody with that language reads the page. The reason for the test is that the
type cannot see what actually goes wrong in a catalog: a value left in English, a
value that is empty, a leftover key nobody asks for any more, and a translator
who dropped a `{{count}}` because that sentence had one more number in it than the
one above. All of those compile, and all of them reach a screen. The placeholder
check is the one that catches the last, and the defect it catches is asymmetric:
an Italian sentence that lost `{{count}}` still typechecks, still renders, and
quietly says "3 chapters" as "chapters". Word order belongs to the translator; the
set of names does not.

The suite never reads the source, only what the catalogs say about each other, so
it also catches a hand-edited fragment that a merge left half translated.

## 18. One definition for the markers

`CANONE_HEADING`, `SILENT_PREFIX`, `CONTINUE_REQUEST` and `RETRY_REQUEST` live in
`packages/shared/src/markers.ts`, because there are two writers: the server builds
the context block and decides what counts as silent, while the interface sends the
Continue and Retry requests.

They were once duplicated, and they diverged. What actually happened is the part
worth keeping: the server had already been translated and the interface copy had
not, so the narrator was being asked to continue in one language and being marked
as silent in another. The symptom was **not a wrong word**. The marker stopped
matching, and "Continue" came back in the transcript looking like something the
player had written — which reads as a memory bug and is not one. That is why these
constants are one definition and not two: a duplicated marker is a string
comparison that can fail on a translation nobody was looking at.

`packages/server/src/opencode/markers.ts` re-exports them, so the server keeps one
import site and the suite keeps testing what the rest of the server actually uses.
Re-exporting is not duplication; it is the same single definition seen from two
angles.

## 19. An error the client invents carries a key, not a sentence

`ApiError` carries an optional `messageKey` plus the values it needs, and
`explainError` applies the language at display time. A `problem` written by the
server passes through untranslated, on purpose.

The reason is where the two ends up. `fetchOrExplain` and the `request` fallback
sit below the component tree, in a module with no provider above it, so they have
no language to write in. Carrying a key and its values is what lets the sentence be
assembled where the language is actually known, by the caller that has it, which is
also why `explainError` takes the locale as a parameter instead of reading it from
context.

`problem` passes through because the server already wrote it in English, for a
person to read, and it names a server-side fact: re-inventing it in the interface
would trade a real explanation for a generic one. `error.message` keeps the
English rendering so that anything reading it directly is never left with a bare
"Failed to fetch". And 503 and 404 each earn their own sentence because they are
the two statuses that mean something actionable: the narrator is not listening, or
the campaign is gone. The whole thing exists because the copy had spread to twenty
spots, each reporting only `error.message` — a 503 that said "opencode
unavailable" without saying the campaign was intact and starting it was enough.

## 20. A migration moves a database forward, it does not rewrite history

Migrations `001`–`007` keep their original SQL, Italian column names included, and
`008_english_columns.ts` is what moves a live database forward: it rebuilds
`turns` and `canon_edits` to replace `stato`, `testo`, `errore`, `creato_il`,
`finito_il`, `campo`, `valore_prima`, `valore_dopo` with English ones, and renames
the index `turns_mondo` to `turns_world`.

Why the split: a migration file is the record of what the schema was on a given
day. `006` really did create a table carrying a `CHECK (stato IN (...))`
constraint. Editing it to say `state` produces a file that never ran anywhere, and
a fresh database created from it and an existing one migrated up to it then have
different histories — which is the exact confusion the `_migrations` ledger exists
to prevent. History is a ledger, not a draft, and the value of keeping the old
column names is precisely that somebody can still read what the schema was on the
day it was written.

Why the rebuild instead of `ALTER TABLE ... RENAME COLUMN`: the rename would have
been shorter, but a rename only renames the column. `turns` carries a `CHECK`
constraint that names `stato`, and the index `turns_mondo` names the world in
Italian too, and neither of those is a column. Rebuilding the table lets the
constraint, the column names and the index name all change together, which is the
procedure SQLite documents for any schema change a rename cannot express. The copy
is column by column, so nothing is dropped and nothing is invented: a turn that
was running when the process was killed stays running, and the migration itself
never leaves a half-state behind (section 5).

## Where things live

| Thing | Where | Owner |
| --- | --- | --- |
| roots and overrides | `packages/server/src/config/paths.ts` | the server |
| a library's descriptor | `lore/<id>/library.yaml` | the library |
| reading a library | `packages/server/src/lore/` | the server, through the adapter |
| source canon | `corpus/<world>/entries/` | the corpus |
| active canon | table `canon_entries`, scope `world_id` | `CanonRepository` |
| manual corrections | table `canon_edits`, scope `world_id` | `CanonRepository` |
| reviewer's verdicts | table `canon_audit`, scope `world_id` | `CanonRepository` |
| narrator prompt | `packages/server/prompts/gm.md` | the server |
| opencode agents | `<worldDir>/.opencode/agents/` | generated, never hand-written |
| narrator contract | `packages/server/src/opencode/narrator.ts` | the server |
| opencode SDK | `packages/server/src/opencode/narrator-adapter.ts`, `bridge.ts` | the adapter, and nothing else |
| what marks a turn as not the player's | `packages/shared/src/markers.ts` | `shared`, one definition |
| interface catalogs | `packages/web/src/i18n/` | the translators, checked by `packages/web/test/i18n.test.ts` |
| a turn's deadline and outcome | `packages/server/src/http/turn-coordinator.ts` | the server, not HTTP |
| world routes | `packages/server/src/http/worlds.ts` | the server |
| arc and chapter routes | `packages/server/src/http/story.ts` | the server |
| cast routes | `packages/server/src/http/cast.ts` | the server |
| canon routes | `packages/server/src/http/canon.ts` | the server |
| turn routes | `packages/server/src/http/turns.ts` | the server |
| system routes | `packages/server/src/http/system.ts` | the server |
| shared space of the routes | `packages/server/src/http/scope.ts` | the composition |
| history of hand-made corrections | table `canon_edits` | the world |
| world pickers | `packages/web/src/components/` | the page, not the client |
| error messages | `ApiError` in `packages/web/src/lib/api.ts` | the page that shows them, through `explainError` |

The wire keys the interface reads back are English: `reason`, `active`, `removed`,
`written`, `removedCharacters`, `fields`, `beforeValue`, `afterValue`. They are the
names the database columns had before migration `008`, and the database catching up
is the same rule as the code catching up: an interface should not have to know that
a column was once called something else.

## Repository rules

- `data/` is user state: deletable and regenerable, not content.
- `lore/` is immutable content, versioned as a requirement with a hash.
- `corpus/` is source: edited by hand.
- `dist/` is build: never committed, never read as source.

## Before writing code

1. Which module owns this datum? If there is none, there is a hole.
2. Where does the path come from? If the answer is "process.cwd()", it is wrong.
3. How do you check that it works? A test that fails without the change.
4. What stays out? Dead code and left-over lines.
5. Does this code know something it should not? An SDK type, a table name, another
   party's file format: they are all symptoms of the same defect, and they are
   recognised before writing.
6. If it is a hand correction of something the user believed was right, where does
   the trace of before and after stay?

Point 4 is not optional: the duplication of `stream.ts` and the leftovers of `npm`
cost more time than the bugs they were hiding.

## Where to read next

| | |
| --- | --- |
| [README.md](README.md) | what the project is, and how to run it |
| [docs/GUIDE.md](docs/GUIDE.md) | playing and running campaigns |
| [docs/CANON.md](docs/CANON.md) | the verified lore library |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | working on the code |