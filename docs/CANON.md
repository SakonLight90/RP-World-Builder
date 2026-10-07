# The canon

The canon is the reason this platform is not a chat window. It is a set of verified
entries the narrator reads instead of inventing.

## Why a library and not a longer prompt

A model asked about a setting it half knows produces that setting. It will produce a
street, a faction, a quest that never existed, and it will produce them in the same tone
as the ones that did. A longer prompt does not fix this: it makes the invention more
confident.

So the canon is not written into the prompt. It is a **library** that the server opens
read-only and passes to the narrator as reference material, the way you would hand a
historian a shelf and say *look it up*. The agent is told the reference is in English,
that it is not to be recycled as style, and that a proper name is used exactly as the
library gives it.

What that buys you:

- The narrator has real names for real things, and no names for the ones that do not exist.
- You can ask what is canon. `npm run corpus:validate` and the campaign's health check
  answer it from the library, not from the model.
- When the narrator cites something, you can look up whether it was there.

## How a campaign requires it

A campaign does not contain the lore. It declares it:

```yaml
libraries:
  - id: my-library
    version: "1.0.0"
    hash: "sha256:..."
```

The server resolves the requirement, opens the declared folders **read-only**, and passes
the narrator the index. The narrator then looks for the name you wrote and opens the file
that contains it.

Cloning a campaign clones the *requirements*, not the contents. Two campaigns that
require the same library share one copy of it on disk, and neither can write to it.

### The hash is the point

The hash is a fingerprint of the library at the moment the campaign declared it. Change
the library and the campaign is describing a different version of its content, so
`npm run corpus:validate` says so, naming both hashes:

```
library "my-library" changed after the world required it:
  expected sha256:37d2e0c1…
  found    sha256:91d55bd0…
```

Update the requirement only when the change was intended. That is the whole mechanism:
the failure is the feature.

The hash covers the path and the bytes of every file, ordered by code point and with line
endings folded to LF. Both matter: an order that depends on the machine's locale and bytes
that depend on the checkout would give one library two fingerprints, and a requirement
would pass on one computer and fail on another.

## Writing a library

A library is a folder with a manifest and one file per entry:

```
lore/my-library/
  library.yaml        # id, version, layout, how the index is organised
  entries/<game>/<kind>/<slug>-<tag>.md
```

The manifest declares everything the engine needs to read it: the index format, the fields
in the records, how an entry's file name is derived from the record that lists it, which
words in a name carry no information. The engine reads the manifest and holds no knowledge
of any particular library, which is what lets a second setting be added without touching
the code.

Index files are generated from the entries and must stay in step with them, or the engine
reads records whose file it cannot find and drops them silently.

Two rules when you write an entry:

- **Never invent.** If the source is silent, the entry says so rather than guessing.
- **Never change a quoted body to make it read better.** It is a quotation. Corrections go
  in the categories, not in the prose.

## Campaign canon on top of the library

A campaign adds its own canon on top: a premise, rules, the factions of its timeline, the
places that matter to it.

A name the narrator used that is not in the canon can be promoted from the campaign page.
It becomes an entry, with a status, and a correction you make by hand leaves a record: who
changed it, from what, to what, and why. `strict` mode excludes `disputed` and fan material;
the status is the player's decision and the engine respects it.

## The library that ships

The repository ships one library and the campaign template that requires it. What is in
that library and where it came from is in
[LIBRARY-FALLOUT.md](LIBRARY-FALLOUT.md).