# NOTAM

**Notes On Team Agreements & Methods**

Your team already agreed on how to write code here. The agreements are just
scattered across a few hundred pull request reviews — "please add a regression
test with the fix", "don't call the payments client from a request handler",
"this needs a feature flag" — repeated by different reviewers, in different
threads, over years.

NOTAM collects them. It syncs your merged pull requests, uses the
[`claude` CLI](https://claude.com/claude-code) to extract the Dos and Don'ts
buried in the review conversations, and promotes the ones you endorse into
`<repo>/.claude/rules/` through a pull request your team reviews — so the
agreements become rules your coding agents actually read.

It runs entirely on your machine: one binary, a SQLite file in `~/.notam/`, a
web UI on `127.0.0.1`. There is no server to deploy, no account to make, and no
data leaves your machine except the API calls to GitHub and to `claude`.

```
merged PRs ──sync──▶ entries ──analyse──▶ rules ──promote──▶ pull request
                                            │                     │
                                            └──── verified ◀──────┘
```

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | sh
```

The installer detects your platform, downloads the matching binary **and**
`SHA256SUMS`, verifies the checksum, and installs to `~/.local/bin/notam`. It
tells you if that directory is not on your `PATH`, and if you are upgrading, it
tells you which version it is replacing.

```sh
# install somewhere else
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | sh -s -- --dir /usr/local/bin

# install a specific release, named by any tag on the releases page
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | NOTAM_VERSION=vX.Y.Z sh
```

Supported platforms: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

Prefer to check the download yourself:

```sh
curl -fsSLO https://github.com/luojiahai/notam/releases/latest/download/notam-darwin-arm64
curl -fsSLO https://github.com/luojiahai/notam/releases/latest/download/SHA256SUMS
shasum -a 256 --ignore-missing -c SHA256SUMS
chmod +x notam-darwin-arm64 && mv notam-darwin-arm64 ~/.local/bin/notam
```

### You will also need

- **The `claude` CLI**, on your `PATH`. NOTAM shells out to it for analysis.
  Without it, sync and promotion still work; analysis fails.
  Install it from [claude.com/claude-code](https://claude.com/claude-code).
- **A GitHub token** with access to the repositories you are syncing. Reading
  needs pull request read access; promotion creates a branch and opens a pull
  request, so it needs write access too. A classic token wants the `repo`
  scope; a fine-grained one wants **Contents: read and write**, **Pull
  requests: read and write**, and **Metadata: read**.

  The token is never written to disk by NOTAM. Your config names the
  *environment variable* that holds it, and nothing else.

## Quick start

```sh
notam init                     # writes a commented ~/.notam/config.yaml
$EDITOR ~/.notam/config.yaml   # add your hosts and the repositories you own
export NOTAM_GITHUB_TOKEN=...  # the variable your config names
notam run                      # serves http://127.0.0.1:4317 and opens a browser
```

Then, in the browser:

1. Pick a repository in the sidebar and press **Sync**. NOTAM pulls the merged
   pull requests from the last 180 days that touch your paths.
2. On the **Entries** tab, filter to *Unanalysed*, select some rows, and press
   **Analyse selected**. Progress streams back live; a few entries at a time run
   in parallel.
3. On the **Rules** tab, read the drafts. Each one links back to the review
   comments it came from, and shows the exact `.claude/rules/<slug>.md` that
   would be committed.
4. Select the ones you want and press **Create rules PR**. NOTAM opens a pull
   request in that repository adding one Markdown file per rule, with a body
   linking each rule to its source PR.
5. When your team merges it, mark those rules **verified**. If they close it
   unmerged, the rules return to draft, ready to be re-proposed.

Nothing is automatic. Analysis is asked for, promotion is asked for, and
verification is a judgement you make.

## Commands

| Command | What it does |
| --- | --- |
| `notam run` | Migrate the database, serve the UI on `127.0.0.1:4317`, open a browser |
| `notam sync` | Sync every configured repository, print a summary, exit |
| `notam init` | Write `~/.notam/config.yaml` and check for the `claude` CLI |
| `notam version` | Print the version |

| Flag | For | Meaning |
| --- | --- | --- |
| `--port <n>` | `run` | Bind this exact port. Unlike the default, it does not auto-increment — if it is taken, the command fails |
| `--no-open` | `run` | Do not launch a browser |
| `--repo <owner/repo>` | `sync` | Sync only this repository |
| `--concurrency <n>` | `sync` | Repositories to sync at once (default 1) |
| `--force` | `init` | Overwrite an existing config |

`notam sync` is headless and exits non-zero if any repository failed, which
makes it safe to put in `cron`:

```
0 7 * * 1  NOTAM_GITHUB_TOKEN=... /Users/you/.local/bin/notam sync
```

## Configuration

`~/.notam/config.yaml`, created by `notam init` with mode `0600`. It is
validated at startup: an invalid file stops the process and names the offending
path and reason, rather than failing later in the middle of a sync.

```yaml
hosts:
  - id: github
    api_base: https://api.github.com
    graphql: https://api.github.com/graphql
    token_env: NOTAM_GITHUB_TOKEN

  # A GitHub Enterprise Server instance, if you have one:
  - id: ghe
    label: Acme GHE
    api_base: https://ghe.acme.net/api/v3
    graphql: https://ghe.acme.net/api/graphql
    token_env: NOTAM_GHE_TOKEN

repos:
  - host: github
    name: acme/monolith
    # Restrict sync to the folders your team owns. Empty means the whole repo.
    path_globs: ["services/payments/**", "libs/money/**"]
    default_branch: main
    window_days: 180
    prompt_template: ~/.notam/prompts/payments.md

analysis:
  concurrency: 3
  timeout_seconds: 120
  # model: omitted — uses whatever model the claude CLI is configured with

server:
  port: 4317
```

| Key | Default | Meaning |
| --- | --- | --- |
| `hosts[].id` | required | Short name, referenced by `repos[].host` |
| `hosts[].label` | the `id` | Display name in the UI |
| `hosts[].api_base` | required | REST base URL |
| `hosts[].graphql` | required | GraphQL endpoint |
| `hosts[].token_env` | required | Name of the environment variable holding the token |
| `repos[].host` | required | Must match a `hosts[].id` |
| `repos[].name` | required | `owner/repo` |
| `repos[].path_globs` | `[]` | Only sync PRs touching these paths. Empty keeps everything |
| `repos[].default_branch` | `main` | Base branch for promotion pull requests |
| `repos[].window_days` | `180` | How far back the first backfill reaches |
| `repos[].prompt_template` | — | Path to a per-repository analysis template |
| `analysis.concurrency` | `3` | Entries analysed at once (1–16) |
| `analysis.timeout_seconds` | `120` | Per-entry `claude` timeout |
| `analysis.model` | — | Passed through to `claude`; omitted uses its default |
| `server.port` | `4317` | Auto-increments if taken, unless you passed `--port` |

Environment variables NOTAM itself reads:

| Variable | Meaning |
| --- | --- |
| *whatever `token_env` names* | The token for that host. Required |
| `NOTAM_HOME` | Use this directory instead of `$HOME` when locating `.notam/` |
| `NOTAM_WEB_DIST` | Serve the web UI from this directory instead of the copy compiled into the binary |
| `NOTAM_VERSION` | Read by `src/version.ts` as the version string `notam version` prints when running from source (a compiled binary ignores it — its version is baked in at compile time). Also read by `install.sh`, unrelatedly, as the release tag to install — see [Install](#install) |

## How it works

| Term | Meaning |
| --- | --- |
| **Entry** | A synced source artifact — in this version, always a merged pull request |
| **Rule** | One atomic Do or Don't extracted from an entry. One entry yields zero or more |
| **Promotion** | The pull request NOTAM opens to add rule files to a repository |

**Sync** reads over GraphQL — one query per pull request retrieves the whole
conversation and the changed paths together, which matters when the first
backfill covers several hundred PRs against an hourly rate limit. Pull requests
that touch none of your `path_globs` are skipped and never stored. Re-syncing
refreshes an entry's content but never resets its analysis state.

**Analysis** renders the stored conversation into a prompt document, pipes it to
`claude -p` on stdin with the instruction in the argument, and validates the
JSON that comes back against a fixed schema. The subprocess runs with no tools
enabled: it reads text and returns text, and cannot touch your filesystem.
Malformed output gets one repair attempt; a timeout or a crash gets two retries;
after that the entry is marked failed and keeps its error for you to read.

**Promotion** never clones. It reads the base branch's tree through GitHub's Git
Data API, checks whether any rule's filename already exists there, and — with
your confirmation — writes blobs, a tree, a commit, a branch, and a pull
request. If the push fails for any reason, every rule stays a draft, nothing is
half-committed, and GitHub's own error text is shown to you verbatim.

**Rules move through four states**, and only two of the transitions are
automatic:

```
  draft ──── create rules PR ────▶ proposed ──── you confirm ────▶ verified
    ▲                                 │
    └──── promotion PR closed ────────┘
              unmerged

  any state ──── you decide ────▶ abandoned
```

Re-analysing an entry throws away its `draft` rules and replaces them. It leaves
`proposed`, `verified`, and `abandoned` ones alone — those have escaped into a
pull request or into a decision, and a re-run does not get to rewrite them.

Everything lives in two files: `~/.notam/config.yaml` and `~/.notam/notam.db`.
Migrations run at startup, are forward-only, and take a timestamped backup of
the database first.

### Not in this version

Deliberate omissions, so you do not go looking for them: issues as entries; rule
deduplication or clustering (the rules list filters by directive text
instead); editing a rule's text before promotion (re-analyse instead); anything
that is not GitHub; and any form of multi-user access. The server binds
`127.0.0.1` only and has no authentication layer, because it is not built to
have one.

## Development

Requires [Bun](https://bun.sh) 1.3.14 or newer. No other toolchain, no native
modules — `bun install` and you are ready.

```sh
git clone https://github.com/luojiahai/notam.git && cd notam
bun install
bun run test
```

| Script | What it runs |
| --- | --- |
| `bun run test` | Unit, integration, and installer tests |
| `bun run test:web` | React component tests, under happy-dom |
| `bun run test:e2e` | Playwright, end to end against a real server (needs `build:web` first) |
| `bun run test:binary` | Compiles the host binary and drives it over HTTP |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | Biome. `bun run format` writes the fixes |
| `bun run build:web` | Build the SPA into `web/dist` |
| `bun run dev:web` | Vite with hot reload, proxying `/api` to a running `notam run` |
| `bun run start` | Run the CLI from source: `bun run start -- run --no-open` |

### Layout

```
src/
  cli/          run | sync | init | version — parse args, call core, exit
  server/       Hono app: REST routes, SSE progress stream, the SPA assets
  core/
    config/     load and validate config.yaml, resolve tokens from the environment
    github/     one client, GHES-aware base URLs
    sync/       github → normalise → store
    analysis/   prompt template → claude -p → parse and validate → rules
    promotion/  rules → markdown files → tree/commit/branch/PR → status
    rules/      the lifecycle state machine; legal transitions live only here
  store/        schema, migrations, typed queries
  jobs/         queue table and bounded worker pool, resumable across restarts
  shared/       zod schemas and types, imported by both the server and the web app
web/            React + Vite SPA
scripts/        the binary and checksum builds
```

### Three invariants

They are what keep the tests cheap, and they are worth preserving:

1. **`store/` is the only module that writes SQL.** No other file contains a SQL
   string.
2. **`github/` is the only module that touches the network.** No other file calls
   `fetch`.
3. **`analysis/` is the only module in `core/` that spawns a subprocess.**

Everything else receives those as injected dependencies — which is why **no test
touches the network and no test spawns the real `claude`**. The GitHub client is
driven by recorded fixtures, the analyser by a fake `claude` first on `PATH`, and
the Git Data API by a fake that asserts the exact blob → tree → commit → ref → PR
call sequence.

The server holds a fourth rule: it contains no business logic. A route resolves
context, calls one function `core/` already exports, serialises the result, and
returns. Any `if` deciding what should happen to a rule belongs in `core/rules/`.

## Building a binary

```sh
bun run build:web
bun run build:binary --version 0.1.0    # this platform, into dist/
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

Every pull request carries a changeset: a file in `.changeset/` naming the bump
and describing the change in the words a release reader needs.

```sh
bun run changeset          # write one
bun run changeset --empty  # for a change no user could observe
bun run changeset:status   # what CI will say
```

CI fails a pull request that has neither. NOTAM is below 1.0 and stays there
deliberately, so **breaking changes are `minor`, everything else is `patch`**;
`major` is reserved for the day 1.0 is cut on purpose.

Merging a pull request that carries changesets makes `version.yml` open a
"Version Packages" pull request, which folds them into `package.json` and
`CHANGELOG.md`. Merging *that* is what ships: `release.yml` builds the SPA once,
compiles all four targets from it, checks the binary reports the version
`package.json` declares, generates `SHA256SUMS`, and publishes a GitHub release
whose notes are that version's changelog section.

Creating the release is what creates the `v*` tag, so a tag never exists without
the five assets `install.sh` resolves through it. Pushing a `v*` tag by hand
still releases the commit it points at — the escape hatch for re-cutting a
release whose changesets are already spent — and fails loudly if the tag and
`package.json` disagree.

Every pull request runs the full gate first — typecheck, lint, the test suites,
Playwright, the compiled-binary smoke test, and a build of all four targets — so
packaging breakage is caught before a release depends on it.

## Troubleshooting

| Symptom | What is happening |
| --- | --- |
| Startup fails naming an environment variable | A host's `token_env` is not exported in this shell |
| Startup refuses with a path and a reason | `config.yaml` failed validation. The message names the exact key |
| "The claude CLI was not found on PATH" | A warning, not a refusal. Sync and promotion work; analysis will fail until you install it |
| A sync seems to pause | GitHub rate limiting. The job backs off and resumes on its own; it does not fail |
| An entry is `failed` | Open it — the stored error is rendered inline, with an Analyse control. Malformed model output gets one repair attempt, a timeout or crash gets two retries, before it lands here |
| "Create rules PR" failed | Every rule stayed `draft` and nothing was committed. GitHub's own message is shown verbatim — usually no write access, or a protected branch |
| `notam run` came up on a different port | 4317 was taken, so it auto-incremented. Pass `--port` to insist on one |
| A rule's file already exists on the base branch | The confirmation dialog says so before you promote. Proceeding commits a suffixed second file; NOTAM never overwrites |
| The UI says the web app is not built | You are running from a source checkout without `bun run build:web`. Released binaries embed it |
| A promoted PR was closed unmerged | Its rules return to `draft` with the promotion link cleared, ready to propose again |
