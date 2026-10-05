# Guide

For playing and running campaigns. Nothing here needs a terminal beyond the first
`start.bat`.

## The first minute

`start.bat` on Windows, `./start.sh` on Linux. It installs the dependencies the first
time, starts the API and the interface, and opens on
<http://127.0.0.1:3310>.

Go to **Setup**. Two decisions there, both saved on this machine:

- **the narrator model.** The page lists what opencode offers, marks the one it
  recommends, and separates the models whose provider declares that it keeps prompts
  from the ones that do not. That choice is yours to make and it is shown before you
  make it.
- **the interface language.** English, Italiano, Español, Français, Deutsch. It is a
  setting, not a guess from your browser: one installation speaks one language,
  everywhere, including screens you have not opened yet.

The narrator's language is separate, and is per campaign. An Italian interface can
narrate an English campaign; that is a legitimate combination and not a mistake.

## Making a campaign

Create one from the home page, or from a template. The template that ships is
**Appalachia 2287**: the Fallout 76 timeline, with 118 canon entries of its own, the
eras already laid out, and a Bible written in English that you are meant to replace.

A campaign is made of things you can change at any time, and nothing you change is
lost:

| | What it is for |
| --- | --- |
| **Bible** | Premise, rules, conventions, tone. This goes into the narrator's agent verbatim. |
| **Eras** | The stretches of time the campaign covers, with a start and an end year. |
| **Arcs** | A run of chapters with a spine. A closed arc is compressed to one line. |
| **Characters** | Who is in the campaign. A name the narrator mentioned can be promoted to canon. |
| **Places** | Where things are, and whether they are safe. |
| **Relationships** | Who knows whom, and why. |
| **Canon** | The entries the narrator must respect. |

### The Bible is the part that matters

Everything else is reference. The Bible is what the narrator *is*. It is written into
the generated agent at `.opencode/agents/gm.md` when the campaign starts, and the
server rewrites and restarts that agent whenever the Bible changes, because opencode
reads its configuration at startup and a restart is the honest way to say "reread".

Premise and rules are not decoration: on a campaign whose Bible is empty, the platform
falls back to your description so that the opening of the story still exists. A reset
conversation no longer leaves an empty screen.

## Playing

Write what your character does. The narrator answers with what happens next.

The transcript is the campaign's history and it is re-read from the opencode session
that played it, so what you see and what the narrator knows cannot drift apart. It is
not stored in the platform's database, which is why an export of the campaign is a
portable copy of the campaign and not a copy of the session.

Two controls sit next to the composer when the narrator has stopped:

- **Retry** re-sends the last thing you wrote to the same model.
- **Continue** asks the narrator to carry on without you acting.

Neither is shown as if you had written it, because they are engine traffic, not your
lines.

## The context window

A long campaign eventually reaches the model's ceiling, and past it the quality falls:
the narrator contradicts itself, forgets who is who. The platform watches the session
and closes the chapter before that happens, then compacts and goes on.

The window is per campaign, in the campaign settings, in thousands of tokens:

- **empty** — automatic: the server asks opencode what the model accepts.
- **a number** — the server uses it and stops asking.

Set it when you know your model and your plan better than the provider declares. Free
models and paid ones on the same account can differ by an order of magnitude, and a
provider that does not declare a window leaves the campaign on a fallback that is a
guess.

Two things keep you out of trouble. The number has **its own save button**, so typing
in it cannot be committed by a press meant for the name or the sliders beside it. And
if the number is above what the current model can actually hold, the page says so, with
both numbers, and tells you that chapters would close against a limit the model cannot
reach.

Next to it: **close a chapter at** (a percentage) and the **canon budget**, which
decides how much of the window the canon may occupy.

## Deleting a campaign

From the campaign page. The folder goes first, then the row.

That order is not a detail. Delete the row first and the folder survives: the campaign
disappears from the list, and every later attempt answers "world not found" forever,
with the files still on disk and no way back through the interface. So the server stops
the narrator, removes the folder, and only then forgets the campaign. If the folder is
held open by something on Windows, nothing is deleted and you are told which path
blocked it, and the campaign stays in the list so you can try again.

## Backup

`Export`, on the campaign page, writes one JSON file: the campaign and its settings, the
Bible, the eras, the arcs, the chapters, the characters, the places, the relationships,
the whole canon including disputed and fan material, and the record of hand-made
corrections.

It does not contain the conversation, deliberately: the transcript lives with
opencode on this machine, and the export is meant to be the portable part.

Import reads the same sections it writes. A file from an older version still imports,
because missing fields are treated as absent.

## Where the files are

`RPWB_DATA_DIR` chooses the folder, and has a working default everywhere:

| Platform | Data folder |
| --- | --- |
| Windows | `%APPDATA%\rp-world-builder` |
| macOS | `~/Library/Application Support/rp-world-builder` |
| Linux | `$XDG_DATA_HOME/rp-world-builder`, else `~/.local/share/rp-world-builder` |

| Thing | Path |
| --- | --- |
| Campaign folder | `<dataDir>/worlds/<slug>` — the campaign's opencode project, with the generated agent at `.opencode/agents/gm.md` |
| Database | `<dataDir>/rpwb.db` |
| Settings | `<dataDir>/world-builder.config.json` |
| Lore library | `lore/` in the repository |
| Templates | `corpus/` in the repository |

The database is migrated forward every time the server opens it. Nothing to run by hand.

## If something does not work

**The narrator says it is not listening.** opencode is not running or not on `PATH`.
`npm run doctor` prints the path and the version it found. The rest of the platform
works without it: campaign management, the canon and the export do not need a model.

**The interface loads but the campaigns do not.** The API is not on 3311. It binds
`127.0.0.1` only, and the interface reads its address from `RPWB_API`.

**The first run is quiet.** `RPWB_LOG_LEVEL` defaults to `warn` and the "listening on"
line is `info`. The launchers set it for you; a bare `npm run dev:server` does not.

**A campaign says the lore changed.** `npm run corpus:validate` explains it. Either the
library changed under a campaign that requires it, or you edited a template. The
message names the hash it expected and the one it found.