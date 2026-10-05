# The canon

The canon is the reason this platform is not a chat window. It is a library of
verified Fallout entries that the narrator reads instead of inventing.

## Why a library and not a longer prompt

A model asked about Appalachia produces Appalachia. It will produce a street, a
faction, a quest that never existed, and it will produce them in the same tone as the
ones that did. A longer prompt does not fix this: it makes the invention more
confident.

So the canon is not written into the prompt. It is a **library** that the server opens
read-only and passes to the narrator as reference material, the way you would hand a
historian a shelf and say *look it up*. The agent is told the reference is in English,
that it is not to be recycled as style, and that a proper name is used exactly as the
library gives it.

What that buys you:

- The narrator has real names for real places, and no names for the ones that do not exist.
- You can ask what is canon. `npm run corpus:validate` and the campaign's health check answer it from the library, not from the model.
- When the narrator cites something, you can look up whether it was there.

## How a campaign requires it

A campaign does not contain the lore. It declares it:

```yaml
libraries:
  - id: fallout
    version: "1.0.0"
    hash: "sha256:..."
```

The server resolves the requirement, opens the declared folders **read-only**, and
passes the narrator the index. The narrator then looks for the name you wrote and opens
the file that contains it.

Cloning a campaign clones the *requirements*, not the contents. Two campaigns that
require the same library share one copy of it on disk, and neither can write to it.

### The hash is the point

The hash is a fingerprint of the library at the moment the campaign declared it. Change
the library and the campaign is describing a different version of its content, so
`npm run corpus:validate` says so, naming both hashes:

```
library "fallout" changed after the world required it:
  expected sha256:37d2e0c1…
  found    sha256:91d55bd0…
```

Update the requirement only when the change was intended. That is the whole mechanism:
the failure is the feature.

## Extending it

Add a file under `lore/fallout/entries/<game>/<kind>/`, quote the wiki lead, then
rebuild the index and the hash:

```sh
npm run build
npm run corpus:validate      # read the "found sha256:" value
                              # put it in the campaign's world.yaml
npm run corpus:validate      # clean
```

The index in `lore/fallout/locations/` and `lore/fallout/factions/` is generated from
the entries and must stay in step with them, or the engine reads records whose file it
cannot find and drops them silently.

Two rules when you write an entry:

- **Never invent.** If the wiki is silent, the entry says so rather than guessing.
- **Never change a quoted body to make it read better.** It is a quotation. Corrections go in the categories, not in the prose.

## Campaign canon on top of the library

The library is Fallout. Your campaign adds its own canon on top: the Appalachia 2287
template ships 118 entries of its own — premises, rules, factions of the timeline, the
places that matter to it.

A name the narrator used that is not in the canon can be promoted from the campaign
page. It becomes an entry, with a status, and a correction you make by hand leaves a
record: who changed it, from what, to what, and why. `strict` mode excludes `disputed`
and fan material; the status is the player's decision and the engine respects it.