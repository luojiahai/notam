# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Toolchain

Bun only (`engines.bun >= 1.3.14`), TypeScript 7, ESM. There is no Node in this project and no npm/pnpm/yarn lockfile — always `bun install` and `bun run`, never `npm`/`npx`.

## Commands

Verify changes with `bun run typecheck && bun run lint && bun run test` before calling work done.

Non-obvious ones:

- `bun run test` runs server + web + install suites only. It does **not** include `test:e2e`, `test:binary`, `typecheck`, or `lint`.
- Anything under `tests/web` needs the DOM preload: `bun test --preload ./tests/web/happy-dom.ts tests/web/...`. Plain `bun test tests/web` fails.
- `bun run test:e2e` requires `bun run build:web` first — the server serves `web/dist`.
- Single test: `bun test tests/core/rules/state.test.ts -t "case name"`. Single e2e: `bunx playwright test tests/e2e/promote.spec.ts -g "name"`.
- `bun run build:binary --version 0.1.0` (`--target darwin-arm64|darwin-x64|linux-x64|linux-arm64`, or `build:binaries` for all four).
- `bun run changeset` writes the changeset every pull request needs; `bun run changeset --empty` covers one no user could observe. `bun run changeset:status` is the check CI runs, and it only sees changesets git can see — a brand-new file needs at least `git add -N`.

CI order is `typecheck` → `lint` → `test` → `build:web` → `test:e2e` → `test:binary` → `build:binaries` → `checksums`, with the changeset gate as a separate parallel job.

## Architectural invariants

These are load-bearing. Violating one is a design error, not a style nit.

1. `src/store/` is the only module that writes SQL. No SQL string belongs anywhere else.
2. `src/core/github/` is the only module that touches the network. Nothing else calls `fetch`.
3. `src/core/analysis/` is the only module in `core/` that spawns a subprocess.
4. `src/server/` holds no business logic. A route resolves context, calls one function `core/` already exports, serialises, returns. Any `if` deciding what happens to a rule belongs in `core/rules/`.
5. `config.yaml` is the source of truth for hosts, repos, and the process knobs, and NOTAM owns the file: it is regenerated whole on every write, so a save destroys any comment the writer did not emit. The database is derived from it — `applyConfig` re-seeds at every boot and at every save.

Rule lifecycle is a state machine: `draft → proposed → verified`, `proposed → draft` when a PR closes unmerged, any → `abandoned`. Re-analysis discards only `draft` rules — `proposed`/`verified`/`abandoned` are never rewritten.

Removal is archival, everywhere. A host or repo absent from `config.yaml` is stamped `archived_at`, never deleted, and re-adding it clears the stamp on the same row. `entries`, `rules`, and `promotions` all cascade from `repos`, and `repos.host_id` cascades from `hosts`, so a `DELETE` driven by a text edit could destroy months of verified rules with no dialog and no undo. Permanent deletion is its own explicit action on something already archived.

Identity is the name. A host's id is its primary key; a repository's is `(host_id, name)`. Changing either in the file therefore reads as one thing leaving and an empty one arriving, stranding the sync watermark, the entries, and the rules on an archived row. The rename endpoints exist so the UI path moves the rows instead; the file path cannot, and the docs say so.

## Code style

- Biome is the only formatter and linter. `bun run format` (`biome check --write .`) formats, fixes lint, and organizes imports in one pass.
- Tabs for indentation (width 2), double quotes.
- `verbatimModuleSyntax` and `allowImportingTsExtensions` are on: relative imports carry the `.ts`/`.tsx` extension, and type-only imports must use `import type`.
- `noUncheckedIndexedAccess` is on — indexing an array or record yields `T | undefined`.
- Comments in this codebase explain *why* a decision was made, in prose. Match that density and tone rather than annotating what the code already says.

Comments and docs describe the code as it is, never as it was. No changelog in the source: not what a thing used to be called, not what was tried before, not what was removed to get here, not which release changed it, and not why the change was made. Where the history exists to stop someone reinstating a mistake, state it as the standing rule rather than as the story of when it was tried and what went wrong. The same goes for tests: name what the code does, never the change that produced it. `git log` holds the past, and a reader of a file should never have to carry it.

Nor should they have to open something else. Don't cite a spec section, a plan number, a review finding, or any other document to carry the point — state the rule itself, in the comment. A reader of the file has only the file, and a citation that outlives what it points at is worse than no citation at all.

## Testing

- `bun:test` for unit/integration/web/binary/install; Playwright for e2e (`workers: 1` deliberately — each run owns a real port, DB, and child process).
- **No test touches the network and no test spawns the real `claude`.** GitHub is driven by recorded fixtures in `tests/fixtures/`, the analyser by a fake `claude` placed first on `PATH` (`tests/e2e/fake-claude.sh`), the Git Data API by a fake asserting the exact blob → tree → commit → ref → PR sequence. Keep it that way.
- `tests/web/happy-dom.ts` documents three ordering hazards: `GlobalRegistrator.register()` must run before React is imported (hence the preload), `@testing-library/react` must be imported dynamically, and `afterEach(cleanup)` is wired manually because `bun:test` doesn't do it.

## Runtime

- `NOTAM_GITHUB_TOKEN` (or whatever `hosts[].token_env` names) — required. The token is never written to disk; config only names the variable.
- `NOTAM_HOME` overrides `$HOME` when locating `.notam/`. Tests rely on this.
- `NOTAM_WEB_DIST` serves the SPA from a directory instead of the copy embedded in the compiled binary.
- `NOTAM_VERSION` has two unrelated meanings: `src/version.ts` reads it (replaced at compile time via `bun build --define`), and `install.sh` reads it as the release tag to install.
- `NOTAM_REPO`, `NOTAM_API_BASE`, `NOTAM_DOWNLOAD_BASE` point release lookups somewhere other than the public repository. Both `install.sh` and `notam update` read them, with the same meanings — that is how `tests/binary/update.test.ts` watches a real binary replace itself without touching the network.
- `uninstall.sh` removes `$NOTAM_DIR/notam` and, only when told to, the files
  NOTAM writes under `NOTAM_HOME`'s `.notam/`. It asks on `/dev/tty`, never
  stdin, and keeps the data whenever there is no terminal to ask on.
- `notam update` only moves forward, and only on a compiled release binary. The release lookup is always anonymous: the configured token may belong to a GHES host and must never reach github.com.
- The server binds `127.0.0.1` with no auth by design, and rejects foreign `Host` headers. `notam` auto-increments from port 4317 unless `--port` is passed, which then fails hard.
- Mutating the configuration over that unauthenticated API is in scope for the same trust model, deliberately. The `Host` check closes the drive-by-browser vector, which is the only realistic one; anyone who can reach the loopback socket can already read `.notam/` directly, so a handshake token would buy nothing it does not already have. Note this is a weaker footing than the API once had — "no auth" was first justified by its being read-mostly — so a new mutating route is a decision to take on purpose, not a detail.
- `install.sh` is POSIX sh, not bash — Ubuntu's `/bin/sh` is dash, which is what proves it in CI.

## Git

Don't commit, branch, push, or open PRs unless asked. When asked:

- Conventional Commits with a scope: `feat(web):`, `fix(analysis):`, `test(binary):`, `docs:`, `chore:`, `ci:`. Lowercase imperative subject.
- Bodies are long and explanatory — rationale, tradeoffs, what was removed. Match the existing log.
- Branches are `type/slug` (`feat/repo-level-actions`); integration is a GitHub PR merged with a merge commit, not squash or rebase.
- Every pull request carries a changeset, and CI fails one that doesn't. NOTAM is below 1.0 deliberately: **breaking changes are `minor`, everything else is `patch`**. Never select `major` — that is reserved for cutting 1.0 on purpose.
- Releases: `package.json` holds the version. Merging a pull request with changesets makes `version.yml` open a "Version Packages" pull request; merging that runs `release.yml`, which compiles four targets, and publishes them with `SHA256SUMS` and that version's changelog section. `gh release create` mints the `v*` tag, so a tag never exists without its assets. A hand-pushed `v*` tag is the escape hatch and must match `package.json`.
