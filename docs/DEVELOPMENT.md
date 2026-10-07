# Development

For working on the code. The rules the code is shaped by are in
[ARCHITECTURE.md](ARCHITECTURE.md); this is how to move around it.

## Layout

```
packages/shared    types, the error contract, the settings, the token maths
packages/server    Fastify API, SQLite, the narrator bridge, the canon engine
packages/web       Next.js interface
lore/              the libraries, read-only, shared by every campaign
corpus/            campaign templates
docs/              this documentation
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
| `npm run typecheck` | the server, the tests and the web |
| `npm run build:web` | builds shared, then `next build` |
| `npm run lint` | formatting and unused imports, with `biome` |
| `npm run verify` | `build`, `typecheck`, `lint`, `build:web`, `test` |
| `npm test` | the tests that do not call a model |
| `npm run test:live` | the `.live.test.ts` files, which generate real text |
| `npm run doctor` | prints the opencode path and version it found |
| `npm run corpus:validate` | checks the library hashes against the campaigns that require them |

`npm run verify` is the check to run before committing. It is the same chain CI runs, so
a green verify means the same thing locally and on the runner.

`npm run dev` starts three processes (npm, a shell, the watcher), so closing the wrong
window leaves the others holding their ports. `scripts/dev.mjs` kills the whole tree and
brings the other half down if one stops.

`npm run test:live` is not in the verify chain: it opens a server, generates real text,
takes seconds to minutes per test and costs model calls.

## Tests

736 tests across 50 files, with `vitest`. The suite is split: `npm test` runs the tests
that do not call a model, `npm run test:live` the ones that do. Files named
`*.live.test.ts` are excluded from the first.

The tests use a fake narrator, so they need neither opencode nor a provider. The fake
implements the `Narrator` contract — `contextLimit`, `prompt`, `closeSession`,
`sessionExists`, `messages`, `events`, `abort`, `truncateTo`, `models` — and when the
contract changes the fake changes with it.

While developing, run the tests that cover what you changed. Run the full suite once,
before committing: it is what catches the cascading breakage that targeted tests do not
see, such as a missing i18n key or a type error in a file far from the change.

## Conventions

**English.** Code, comments, identifiers and strings. The exception is the localization
layer in `packages/web/src/i18n/fragments/`, which holds the translations by design.

**The error contract.** Every error the server sends has a code, and every code has a
translation in all five languages. Add the code to `packages/shared/src/errors.ts`, the
translations to `packages/web/src/i18n/fragments/errors.ts`, and use `apiProblem(code,
params)` in the route. Never send a raw message.

**Migrations move forward.** A new migration is a new file, never an edit to an old one.
See rule 20 in [ARCHITECTURE.md](ARCHITECTURE.md).

**No hand-written absolute paths.** Paths come from `packages/server/src/config/paths.ts`,
which reads `RPWB_DATA_DIR`, `RPWB_LORE_DIR`, `RPWB_CORPUS_ROOT`, `RPWB_PROMPTS_DIR` and
`RPWB_REPO_ROOT`. A path written anywhere else is a bug, and a test walks the server
source checking that no module calls `process.cwd()`.

**The narrator's SDK lives behind a contract.** `packages/server/src/opencode/narrator.ts`
declares it, `narrator-adapter.ts` implements it, the tests use a fake.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `RPWB_DATA_DIR` | platform-specific | where campaigns, the database and settings live |
| `RPWB_LORE_DIR` | `lore/` in the repo | the libraries |
| `RPWB_CORPUS_ROOT` | `corpus/` in the repo | campaign templates |
| `RPWB_PROMPTS_DIR` | `packages/server/prompts/` | the narrator prompt |
| `RPWB_REPO_ROOT` | auto-detected | for a checkout whose server package sits outside the workspace |
| `RPWB_API` | `http://127.0.0.1:3311` | where the interface finds the API |
| `RPWB_LOG_LEVEL` | `warn` | the log level, shared by the server and Fastify |
| `RPWB_MODEL` | — | the default narrator model |
| `RPWB_SMALL_MODEL` | — | the default model for background work |
| `RPWB_REASONING` | — | the default reasoning effort |
| `RPWB_DEBUG_OPENCODE` | — | `1` pipes the narrator's output through |
| `OPENCODE_BINARY` | auto-detected | the opencode executable |
| `OPENCODE_BASE_URL` | — | attach to this server instead of starting one |
| `OPENCODE_SERVER_USERNAME` | — | credentials for an authenticated server |
| `OPENCODE_SERVER_PASSWORD` | — | credentials for an authenticated server |

## Adding to the canon

See [CANON.md](CANON.md) for the mechanism and [LIBRARY-FALLOUT.md](LIBRARY-FALLOUT.md) for
the library that ships. In short: add a file under `lore/<library>/entries/<game>/<kind>/`,
rebuild the index, and update the hash in the campaign's `world.yaml` with the value
`npm run corpus:validate` prints.