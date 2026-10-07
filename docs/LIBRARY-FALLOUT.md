# The library that ships

The Fallout library included in the repository: what is in it, where it came from and how
to verify it. For how libraries work in general — how a campaign declares one, what the
hash means, how to write a second one — see [CANON.md](CANON.md).

## What it is

A corpus of verified entries across the Fallout games: characters, locations, factions and
events, each checked against the Fallout Wiki title by title. Entries belonging to the
television series, to a novel or to a tabletop game were removed, so what is left came out
of a game.

It lives in `lore/fallout/`, read-only, and is shared. A campaign requires it rather than
containing it.

## Verifying it

```sh
npm run corpus:validate
```

Clean output means every world in `corpus/` is well-formed and every library requirement
matches the content on disk. A hash mismatch is not a crash: it means the requirement is
older than the library, and [CANON.md](CANON.md) says what to do about it.

## Adding an entry

Add a file under `lore/fallout/entries/<game>/<kind>/`, quote the wiki lead, then rebuild
the index and the hash as [CANON.md](CANON.md) describes.

Two rules for the entry itself: never invent when the source is silent, and never rewrite a
quoted body to read better — corrections go in the categories.