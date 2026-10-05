# Lore libraries

Content that worlds **require**, read-only, without owning it.

## How it works

A world does not copy the lore and does not modify it. It declares it among its
requirements:

```yaml
libraries:
  - id: fallout
    version: "1.0.0"
    hash: "sha256:..."
```

The server resolves the requirement, opens **read-only** on the declared folders
for the narrator and passes it the index of the files. The narrator then looks for
the name the player said and opens the file that contains it.

The advantage is that a new world does not rewrite the history of any game: it
requires it. Cloning a world clones the *requirements*, not the contents.

## `hash` is not decorative

It is the fingerprint of the content at the moment the world declared the
requirement. If the library on disk changes and the world does not,
`npm run corpus:validate` reports it as an error:

```
library "fallout" changed after the world required it: expected sha256:abc..., found sha256:def...
```

It is the only warning that stops a campaign in progress from citing a version of
the sources different from the one it was written against. With an empty hash the
validation suggests the current one.

## Rules

- **The library is not modified at runtime.** The narrator has `read`, `glob` and
  `grep` on these folders and nothing else: `edit`, `bash`, `webfetch` and
  `websearch` stay denied, even inside the library. If it could write, the
  requirement's hash would stop meaning anything.
- **The generator is not re-run.** `lore/fallout` was produced once from the
  Fallout Wiki categories. Regenerating it is an explicit decision, not a side
  effect: it changes the hash and the worlds that require it have to be told.
- **The index is not verified knowledge.** The rows in `locations/` and `factions/`
  hold canonical names, variants useful for recognition, categories and a summary
  that only declares where the name was found. Standalone descriptive text has to
  be written and verified elsewhere.
- **The library's shape is declared, not presumed.** `library.yaml` says adapter,
  sections, fields, entry path and matching rules. The server must not contain
  section names or formats specific to the library.

## Structure

```text
lore/
  fallout/
    library.yaml      manifest: id, version, counts and layout
    INDEX.md          map of the indexes per game
    factions/         one index per game
    locations/        one index per game
    entries/          one record per entry, when the source has an extract
```

Every entry is `- name:` with `variants:`, `categories:` and a `summary:`. The
`variants` exist because the narrator must recognise the name even when the player
writes it abbreviated: if the entry is `Red Rocket (Flatwoods)`, the variant
`Red Rocket` makes the short form match too. No row carries a source link: the
wiki page it came from is a citation the library does not keep, so nothing here
depends on it being present.