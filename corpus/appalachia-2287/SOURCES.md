# Sources of the `appalachia-2287` corpus

## Reliability scope

`010-factions.yaml` and `020-locations.yaml` were built from two index listings
(Factions, Locations). From those listings only the **canonical names and the
statuses** are verified. Descriptions, headings, slogans and the links between
places are reconstructions: they hold until they are checked line by line.

Every detail that has not been verified carries the wording
`unverified: do not invent`, because the narrator must be able to tell canon
from reconstruction. If one of those entries is corrected in the future, the
wording goes away together with the fact.

Notes on the two listings:

- on the Factions listing, `People's Liberation Army` has no status: the entry
  declares it instead of deducing it;
- from the Locations listing about 55 main locations out of ~700 were taken: the
  others exist but are not in the corpus and must not be cited.

## How to treat these entries

The reference listings change, and sometimes significantly. Before using an
entry as authoritative in a campaign, verify it.

The corpus is deliberately **small**: it is a starting point to make the machine
work, not an encyclopedia. Most secondary characters, minor factions and items
are missing on purpose.

To measure how much of a canon is still open to doubt:

- at load time, `npm run corpus:validate` flags the entries that carry neither a
  summary nor facts;
- at runtime, the canon health endpoint counts the entries in the `disputed` and
  `retconned` states.

An entry you are not sure you know well must be declared `disputed`: in `strict`
mode it does not enter the narrator's context, which is the right behaviour when
we do not know whether a fact is true.

## Extending the corpus

Add YAML files in `entries/`, two hundred lines each. Every entry needs
`subject` and `kind`; everything else has a sensible default.

```yaml
entries:
  - subject: "Name of the subject"
    kind: character        # rule|era|character|location|faction|event|item|creature|technology|terminology
    era: "2287"            # a key defined in world.yaml, or "any"
    status: active         # active|retconned|disputed|non_canon
    aliases: ["variant"]
    summary: >-
      One paragraph: this is what ends up in the narrator's context.
    facts:
      - "Atomic facts: these are the ones full-text search indexes."
    priority: 10           # higher, injected first within the same tier
```
