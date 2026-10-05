# Development

For working on the code. The rules the code is shaped by are in
[ARCHITECTURE.md](ARCHITECTURE.md); this is how to move around it.

## Layout

```
packages/shared    types, the error contract, the settings, the token maths
packages/server    Fastify API, SQLite, the narrator bridge, the lore engine
packages/web       Next.js interface
lore/fallout       the verified library, read-only, shared by every campaign
corpus/            campaign templates; appalachia-2287 is the one that ships
```

Three workspaces, no framework in the middle. The narrator is a separate program: the
server starts `opencode serve` once per campaign folder, writes a generated agent into
`.opencode/agents/gm.md` with that campaign's Bible inlined, and streams turns to it.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | `build:shared`, then `scripts/dev.mjs`: the watcher and `next dev` together |
| `npm run serve` | production: `tsc -b`, then `node packages/server/dist/index.js` |
| `npm run build` | `tsc -b` |
| `npm run build:web` | builds shared, then `next build` |
| `npm run verify` | `build`, `typecheck`, `lint`, `build:web`, `test` |
| `npm run test` | the tests that do not call a model |
| `npm run test:live` | the three `*.live.test.ts` files, which generate real text |
| `npm run doctor` | prints the opencode path and version it found |
| `npm run corpus:validate` | checks the library hash against the campaigns that require it |

`npm run dev` is three processes (npm, a shell, the watcher), so closing the wrong
window leaves the others holding their ports. `scripts/dev.mjs` kills the whole tree
and brings the other half down if one of them stops.

`npm run test:live` is not in the verify chain, on purpose: it opens a server and
generates real text, seconds to minutes per test, and it costs model calls.

## Tests

645 tests across 45 files. Vitest. The suite is split: `npm run test` runs the unit
tests, `npm run test:live` runs the ones that call a model.

The tests use a fake narrator, so they do not need opencode or a provider. The fake
implements the `Narrator` contract: `contextLimit`, `prompt`, `closeSession`,
`sessionExists`. When you change the contract, the fake changes with it.

## Conventions

**English only.** No Italian, no other language, in code, comments, identifiers, or
strings. The exception is the localization layer in `packages/web/src/i18n/fragments/`,
which holds the UI translations by design. A test fails if a non-English word appears
in the source.

**The error contract.** Every error the server sends has a code, and every code has a
translation in all five languages. Add a code to `packages/shared/src/errors.ts`, add
the translations to `packages/web/src/i18n/fragments/errors.ts`, and use
`apiProblem(code, params)` in the route. Never send a raw message.

**Migrations move forward, they do not rewrite history.** Migrations `001`–`007` keep
their original SQL. `008_english_columns` renamed the Italian columns to English.
`009_context_limit` added the per-campaign context window. A new migration is a new
file, never an edit to an old one.

**No hand-written absolute paths.** Paths come from `packages/server/src/config/paths.ts`,
which reads `RPWB_DATA_DIR`, `RPWB_LORE_DIR`, `RPWB_CORPUS_ROOT`, `RPWB_PROMPTS_DIR`,
and `RPWB_REPO_ROOT`. A path written anywhere else is a bug.

**The narrator's SDK lives behind a contract.** `packages/server/src/opencode/narrator.ts`
declares the interface. The real implementation is `narrator-adapter.ts`. Tests use
a fake. When you change the contract, the fake and the adapter change together.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `RPWB_DATA_DIR` | platform-specific | where campaigns, the database and settings live |
| `RPWB_LORE_DIR` | `lore/` in the repo | the lore library |
| `RPWB_CORPUS_ROOT` | `corpus/` in the repo | campaign templates |
| `RPWB_PROMPTS_DIR` | `packages/server/prompts/` | the narrator prompt |
| `RPWB_REPO_ROOT` | auto-detected | for a checkout whose server package sits outside the workspace |
| `RPWB_API` | `http://127.0.0.1:3311` | where the interface finds the API |
| `RPWB_LOG_LEVEL` | `warn` | the API log level |
| `RPWB_MODEL` | — | the default narrator model |
| `RPWB_SMALL_MODEL` | — | the default model for background work |
| `RPWB_REASONING` | — | the default reasoning effort |
| `OPENCODE_BINARY` | auto-detected | the opencode executable |
| `OPENCODE_BASE_URL` | — | the opencode server URL |

## Extending the canon

See [CANON.md](CANON.md). The short version: add a file under
`lore/fallout/entries/<game>/<kind>/`, quote the wiki lead, rebuild the index, update
the hash in the campaign's `world.yaml`.

## Licence

None. The project carries no licence, by decision. There is no attribution file, no
source links, no telemetry. The lore is plain text in `lore/`, readable and editable
by hand.