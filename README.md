# NOTAM

**Notes On Team Agreements & Methods**

Your team already agreed on how to write code here. The agreements are just
scattered across a few hundred pull request reviews — "please add a regression
test with the fix", "don't call the payments client from a request handler",
"this needs a feature flag" — repeated by different reviewers, in different
threads, over years.

NOTAM collects them. It syncs your merged pull requests, uses the
[`claude` CLI](https://claude.com/claude-code) to extract the agreements
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
names the version it is replacing — except when running as root, where it will
not execute a file it found already in place, and so reports `unknown version`.

```sh
# install somewhere else
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | sh -s -- --dir /usr/local/bin

# install a specific release, named by any tag on the releases page
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | NOTAM_VERSION=vX.Y.Z sh
```

`NOTAM_VERSION` takes the tag with or without its leading `v` — a bare `X.Y.Z`
is resolved to `vX.Y.Z`.

Supported platforms: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

Once installed, `notam update` does the same thing from the inside — see
[Updating](#updating).

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

### Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/uninstall.sh | sh
```

It asks first, before removing anything: whether to delete your configuration
and database in `~/.notam`. A bare Enter keeps them. The data is dealt with
next, and the binary in `~/.local/bin` goes last — so if removing a
root-owned binary fails, that error arrives while you are still reading output
about a directory already decided. Answer up front to skip the question, which
is also what you want in a script:

```sh
# remove everything, including the config and database
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/uninstall.sh | sh -s -- --purge

# remove only the binary
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/uninstall.sh | sh -s -- --keep-data

# uninstall from somewhere other than ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/uninstall.sh | sh -s -- --dir /usr/local/bin
```

With no terminal to ask on — a CI job, or output redirected to a file — it
keeps `~/.notam` and says so. Deleting your data is never something that
happens because nobody was there to say otherwise.

`--purge` removes only the files NOTAM writes: `config.yaml`, `notam.db` with
its `-wal`, `-shm` and `.bak` companions, and then `~/.notam` itself if that
emptied it. A prompt template you wrote at `~/.notam/prompts/` stays, and the
directory is kept with it.

Only the binary at `--dir` is removed. Another `notam` elsewhere on your `PATH`
is reported rather than deleted, since this script did not put it there.

`--purge` and `--keep-data` contradict each other, so passing both is refused
rather than resolved in either direction.

## Quick start

```sh
export NOTAM_GITHUB_TOKEN=...  # a token for the host you will add
notam                          # serves http://127.0.0.1:4317 and opens a browser
```

There is nothing to set up first. The first run writes `~/.notam/config.yaml`
with the github.com host filled in and no repositories, so the page opens on
an empty state offering the settings window.

Then, in the browser:

1. Add a repository in **Settings**, then pick it in the sidebar and press
   **Sync**. NOTAM pulls the merged
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
| `notam` | Create the config if there is none, migrate the database, serve the UI on `127.0.0.1:4317`, open a browser |
| `notam update` | Replace this binary with a newer release |
| `notam version` | Print the version. `notam --version` is the same thing |
| `notam help` | Print the usage summary |

| Flag | For | Meaning |
| --- | --- | --- |
| `--port <n>` | `notam` | Bind this exact port. Unlike the default, it does not auto-increment — if it is taken, the command fails |
| `--no-open` | `notam` | Do not launch a browser |
| `--version <tag>` | `update` | Install this release instead of the latest |
| `--force` | `update` | Reinstall even if already on that version |
| `--help`, `-h` | any | Print the usage summary and exit, wherever it appears in the arguments |

A browser is only launched on an interactive terminal that is not an SSH
session and that has an opener installed. The URL is printed either way.

### Syncing on a schedule

The server binds loopback with no authentication, so a scheduled sync is an
HTTP call. `GET /api/repos` lists the ids.

```
0 7 * * 1  curl -fsS -X POST http://127.0.0.1:4317/api/repos/<id>/sync
```

## Configuration

`~/.notam/config.yaml`, created on first run with mode `0600`. It is validated
at startup: an invalid file stops the process and names the offending path and
reason, rather than failing later in the middle of a sync. A malformed file is
never replaced — NOTAM creates a config, it does not repair one.

Edit it in the settings window or in a text editor; both write the same file,
and NOTAM re-reads it on every request, so a hand-edit shows up without a
restart. Saving from that window rewrites the file whole, which replaces any
comments you added. A save built on a version of the file that has since
changed on disk is refused rather than applied.

Removing a repository archives it. Its entries, rules, and promotion history
are kept, and adding it back restores them; deleting it permanently is a
separate action in the settings window. Renaming there carries that
history across — renaming by hand in the file does not, because a repository's
identity there is its `host` and `name`.

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
    web_base: https://ghe.acme.net
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
| `hosts[].web_base` | derived from `api_base` | Where repositories are browsed, for the links in the UI |
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

Environment variables NOTAM and its install scripts read:

| Variable | Meaning |
| --- | --- |
| *whatever `token_env` names* | The token for that host. Required |
| `NOTAM_HOME` | Use this directory instead of `$HOME` when locating `.notam/`. `uninstall.sh` reads it too, so it also decides which `.notam/` a purge would delete |
| `NOTAM_DIR` | Where `install.sh` puts the binary and `uninstall.sh` looks for it — the env var behind the `--dir` flag. Defaults to `~/.local/bin` |
| `NOTAM_WEB_DIST` | Serve the web UI from this directory instead of the copy compiled into the binary |
| `NOTAM_VERSION` | Read by `src/version.ts` as the version string `notam version` prints when running from source (a compiled binary ignores it — its version is baked in at compile time). Also read by `install.sh`, unrelatedly, as the release tag to install — see [Install](#install) |
| `NOTAM_REPO` | The `owner/repo` `notam update` installs from, and the one `install.sh` downloads from. Defaults to `luojiahai/notam` |
| `NOTAM_API_BASE` | Where `notam update` and `install.sh` resolve the latest release. Defaults to `https://api.github.com` |
| `NOTAM_DOWNLOAD_BASE` | Where `notam update` and `install.sh` fetch release assets from. Defaults to `https://github.com` |

## Updating

```sh
notam update                   # move to the latest release
notam update --version 0.2.0   # move to a specific one
```

It resolves the release, downloads the binary for this platform along with
`SHA256SUMS`, checks the digest, and replaces the running executable with an
atomic rename — so a half-written binary is never visible, and replacing one
that is currently running is safe. If `notam` on your `PATH` is a symlink, the
file behind it is what changes.

The lookup is always anonymous. Your GitHub token belongs to whichever host
`token_env` names, which may be an enterprise instance, and it is never sent to
github.com.

**Updates only move forward.** `notam update --version` will refuse a release
older than the one you are running, because migrations are forward-only: an
older build opens a database a newer one has already migrated. If you need an
older version anyway, install it directly and accept that it may not read your
existing database:

```sh
curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | NOTAM_VERSION=vX.Y.Z sh
```

The checksum proves the bytes arrived intact. It does not prove who produced
them — the manifest comes from the same host as the binary, so anyone able to
serve one can serve the other. Releases are not signed.

`notam update` only works on an installed release binary. Running from source it
refuses, because there is nothing to replace but your Bun installation.

## How it works

| Term | Meaning |
| --- | --- |
| **Entry** | A synced source artifact — in this version, always a merged pull request |
| **Rule** | One atomic Do or Don't extracted from an entry. One entry yields zero or more |
| **Promotion** | The pull request NOTAM opens to add rule files to a repository |

**Sync** reads over GraphQL — close to one query per pull request, retrieving
the conversation and the changed paths together, which matters when the first
backfill covers several hundred PRs against an hourly rate limit. Pull requests
that touch none of your `path_globs` are skipped and never stored. Re-syncing
refreshes an entry's content but never resets its analysis state.

A big enough pull request does not fit in that one query. Reviews, comments and
review threads are each captured up to a fixed cap, and a long file list takes
further queries to finish. Either way the entry is stored marked as truncated,
and the ones whose file list was shortened are counted in the summary
a sync reports. Analysis still runs on a truncated entry — just on
slightly less than the whole conversation.

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

Requires [Bun](https://bun.sh) 1.3.14 or newer — no other toolchain and no
native modules, so `git clone`, `bun install`, `bun run test` is the whole
setup. [CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, the invariants
worth preserving, and how a release is cut.

## Troubleshooting

| Symptom | What is happening |
| --- | --- |
| Startup fails naming an environment variable | A host's `token_env` is not exported in this shell |
| Startup refuses with a path and a reason | `config.yaml` failed validation. The message names the exact key |
| "The claude CLI was not found on PATH" | A warning, not a refusal. Sync and promotion work; analysis will fail until you install it |
| A sync seems to pause | GitHub rate limiting. The job backs off and resumes on its own, a bounded number of times — long enough for an ordinary reset, not indefinitely |
| An entry is `failed` | Open it — the stored error is rendered inline, with an Analyse control. Malformed model output gets one repair attempt, a timeout or crash gets two retries, before it lands here |
| "Create rules PR" failed | Every rule stayed `draft` and nothing was committed. GitHub's own message is shown verbatim — usually no write access, or a protected branch |
| `notam` came up on a different port | 4317 was taken, so it auto-incremented — through a bounded range, after which it gives up rather than scan on. Pass `--port` to insist on one |
| A rule's file already exists on the base branch | The confirmation dialog says so before you promote. Proceeding commits a suffixed second file; NOTAM never overwrites |
| The UI says the web app is not built | You are running from a source checkout without `bun run build:web`. Released binaries embed it |
| A promoted PR was closed unmerged | Its rules return to `draft` with the promotion link cleared, ready to propose again |

## License

MIT — see [LICENSE](LICENSE), which also names the third-party components the
release binaries embed.
