# Contributing to NOTAM

## Getting set up

Requires [Bun](https://bun.sh) 1.3.14 or newer. No other toolchain, no native
modules — `bun install` and you are ready.

```sh
git clone https://github.com/luojiahai/notam.git && cd notam
bun install
bun run test
```

To run the CLI from a source checkout, `bun run start -- --no-open`. A
source checkout has no compiled-in web UI, so build it once with
`bun run build:web`, or point `NOTAM_WEB_DIST` at a directory you are serving.

## Scripts

| Script | What it runs |
| --- | --- |
| `bun run test` | The three suites CI gates on, in order: server, web, installer |
| `bun run test:server` | Unit and integration tests — `shared`, `store`, `jobs`, `core`, `server`, `cli`, `scripts`, `integration` |
| `bun run test:web` | React component tests, under happy-dom |
| `bun run test:install` | `install.sh` and `uninstall.sh`, against a stub release server |
| `bun run test:binary` | Compiles the host binary, drives it over HTTP, and watches one replace itself |
| `bun run test:e2e` | Playwright, end to end against a real server (needs `build:web` first) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | Biome. `bun run format` writes the fixes |
| `bun run build:web` | Build the SPA into `web/dist` |
| `bun run build:binary` | Compile this platform into `dist/`; `build:binaries` does all four |
| `bun run checksums` | Write `dist/SHA256SUMS` |
| `bun run release:notes` | Print one version's `CHANGELOG.md` section, for a release body |
| `bun run changeset` | Write the changeset your pull request needs |
| `bun run changeset:status` | What the changeset gate will say |
| `bun run changeset:version` | Fold pending changesets into `package.json` and `CHANGELOG.md` — normally `version.yml`'s job, not yours |
| `bun run dev:web` | Vite with hot reload, proxying `/api` to a running `notam` |
| `bun run start` | Run the CLI from source |

## Verifying your work

```sh
bun run typecheck && bun run lint && bun run test
```

That is the bar before calling anything done. Note what `bun run test` leaves
out: `test:e2e` and `test:binary` are both slow enough to be their own step, and
CI runs them separately. If you touched the server, the SPA, or anything under
`scripts/`, run them too.

CI runs `typecheck` → `lint` → `test` → `build:web` → `test:e2e` →
`test:binary` → `build:binaries` → `checksums`, with the changeset gate as a
separate parallel job.

## Testing

**No test touches the network and no test spawns the real `claude`.** GitHub is
driven by recorded fixtures in `tests/fixtures/`, the analyser by a fake
`claude` placed first on `PATH`, and the Git Data API by a fake asserting the
exact blob → tree → commit → ref → PR sequence. Keep it that way: a test that
reaches the network is a test that fails on someone else's machine, and a test
that spawns the real `claude` bills whoever runs it.

Two ordering hazards, both of which fail confusingly rather than clearly:

- Anything under `tests/web` needs the DOM preload —
  `bun test --preload ./tests/web/happy-dom.ts tests/web/...`. Plain
  `bun test tests/web` fails, because `GlobalRegistrator.register()` has to run
  before React is imported. For the same reason `@testing-library/react` is
  imported dynamically inside the tests, and `afterEach(cleanup)` is wired by
  hand — `bun:test` does not do it for you.
- `bun run test:e2e` needs `bun run build:web` first. The server serves
  `web/dist`, and Playwright drives a real one.

Playwright runs with `workers: 1` deliberately: each test owns a real port, a
real database, and a real child process.

To run one file or one case:

```sh
bun test tests/core/rules/state.test.ts -t "case name"
bunx playwright test tests/e2e/promote.spec.ts -g "name"
```

## Layout

```
src/
  cli/          the server | update | version — parse args, call core, exit
  server/       Hono app: REST routes, SSE progress stream, the SPA assets
  core/
    config/     read, validate, and write config.yaml; resolve tokens from the environment
    github/     one client, GHES-aware base URLs; release lookups for updates
    sync/       github → normalise → store
    analysis/   prompt template → claude -p → parse and validate → rules
    promotion/  rules → markdown files → tree/commit/branch/PR → status
    rules/      the lifecycle state machine; legal transitions live only here
    update/     verify a downloaded release and replace the running binary
  store/        schema, migrations, typed queries
  jobs/         queue table and bounded worker pool, resumable across restarts
  shared/       types shared across boundaries: zod schemas the server and the
                web app both use, and the platform table scripts/ and core/update/
                must agree on
web/            React + Vite SPA
scripts/        the binary and checksum builds, the generated compile entrypoint,
                and changelog extraction for release notes
```

## Three invariants

They are what keep the tests cheap, and they are worth preserving:

1. **`store/` is the only module that writes SQL.** No other file contains a SQL
   string.
2. **`github/` is the only module that touches the network.** No other file calls
   `fetch` — including `core/update/`, which asks `github/releases.ts` for the
   bytes and confines itself to verifying and installing them.
3. **`analysis/` is the only module in `core/` that spawns a subprocess.**

Everything else receives those as injected dependencies — which is why no test
needs the network or the real `claude` to run.

The server holds a fourth rule: it contains no business logic. A route resolves
context, calls one function `core/` already exports, serialises the result, and
returns. Any `if` deciding what should happen to a rule belongs in `core/rules/`.

Violating one of these is a design error rather than a style nit, and a review
will ask you to move the code rather than to justify it.

## Commits and branches

Conventional Commits with a scope: `feat(web):`, `fix(analysis):`,
`test(binary):`, `docs:`, `chore:`, `ci:`. The subject is lowercase and
imperative.

Bodies are long and explanatory — the rationale, the tradeoffs, what was removed
and why. `git log` is where this project keeps its history, which is also why
comments and docs in the source describe the code as it is and never as it was.

Branches are `type/slug` — `feat/repo-level-actions`, `fix/sync-window`.
Integration is a pull request merged with a **merge commit**, not a squash and
not a rebase.

## Changesets

Every pull request carries a changeset, and CI fails one that does not. A
changeset is a file in `.changeset/` naming the version bump and describing the
change in the words a release reader needs — not the words a reviewer needs.

```sh
bun run changeset          # write one
bun run changeset --empty  # for a change no user could observe
bun run changeset:status   # what CI will say
```

`changeset:status` only sees what git sees, so a brand-new file needs at least
`git add -N` before it counts.

NOTAM is below 1.0 and stays there deliberately, so **breaking changes are
`minor`, everything else is `patch`**. Never select `major`: it is reserved for
the day 1.0 is cut on purpose.

## Building a binary

```sh
bun run build:web
bun run build:binary --version 0.1.0    # this platform, into dist/
bun run build:binary --version 0.1.0 --target linux-arm64
bun run build:binaries --version 0.1.0  # all four platforms
bun run checksums                       # writes dist/SHA256SUMS
```

`scripts/build-binary.ts` scans `web/dist`, generates `build/entry.ts` with one
`with { type: "file" }` import per asset, and compiles it with
`bun build --compile`. The web UI therefore lives *inside* the executable — a
released binary needs no `web/dist` beside it. Set `NOTAM_WEB_DIST` to make a
binary serve a directory instead, which is how the development server and the
end-to-end test work.

The version comes from `--version` and is baked in at compile time; a binary
built without one reports `dev`.

## Releasing

Releases are cut by [Changesets](https://github.com/changesets/changesets), and
`package.json` holds the version everything else derives from.

Merging a pull request that carries changesets makes `version.yml` open a
"Version Packages" pull request, which folds them into `package.json` and
`CHANGELOG.md`. Merging *that* is what ships: `release.yml` builds the SPA once,
compiles all four targets from it, checks the binary reports the version
`package.json` declares, generates `SHA256SUMS`, and publishes a GitHub release
whose notes are that version's changelog section.

Creating the release is what creates the `v*` tag, so a tag never exists without
the assets `install.sh` resolves through it. Pushing a `v*` tag by hand still
releases the commit it points at — the escape hatch for re-cutting a release
whose changesets are already spent — and fails loudly if the tag and
`package.json` disagree.

Every pull request runs the full gate first — typecheck, lint, the test suites,
Playwright, the compiled-binary smoke test, and a build of all four targets — so
packaging breakage is caught before a release depends on it.

## Working with coding agents

`CLAUDE.md` carries these same rules in the form an agent reads: the toolchain,
the invariants above, the commit conventions, and the testing hazards. If you
change one of them here, change it there too.

## License

By contributing, you agree that your contributions will be licensed under the
MIT License.
