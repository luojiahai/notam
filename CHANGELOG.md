# notam

## 0.1.6

### Patch Changes

- [#35](https://github.com/luojiahai/notam/pull/35) [`35eaa8e`](https://github.com/luojiahai/notam/commit/35eaa8e76e8f59d42c155ab917dc417297c691be) Thanks [@luojiahai](https://github.com/luojiahai)! - The interface is a console, and every overlay is one window in the middle.
  
  NOTAM is a local tool, driven from a terminal, that reads and writes files a
  terminal shows you. The web UI now says so: one monospaced family end to end,
  square corners, a visible grid, micro-labels in tracked capitals, and a chrome
  band top and bottom that holds the dark ink in both themes — so the boundary
  between the tool and what the tool is showing you needs no rule to be legible.
  The status line at the foot carries the address this process answers on and the
  build it is, which is the question you ask when two of them are open.
  
  Amber is the accent and it is a fill, not only an ink: there is one filled
  control on a screen, so finding the thing that acts costs no reading. It sits
  over a hundred degrees from `--ok` and `--alert`, which is what keeps a status
  column legible beside an accented one. `--warn` is the accent's own hue on
  purpose — attention and interaction are one signal level here, and every
  surface that takes it is a bordered notice, a banner, or a glyph with its
  sentence beside it, never a bare tint in a column of accented things.
  
  A rule's type is a bracketed tag, its status a bracketed token with no box at
  all, the way a log line reports state. Confidence gets a bar beside the digits
  rather than only a decimal to decode, and weak confidence dims the bar instead
  of recolouring it — the number never moves, so hue is a second reading of a
  value already stated and never the only thing carrying it.
  
  The entry and rule surfaces stop being drawers pinned to the right edge. They
  are the same centred window every dialog already was, because two overlay
  geometries in one app read as one of them having missed, and the reader has no
  way to tell which was meant. `Drawer` is `Panel` accordingly.
  
  That window now keeps the promise `aria-modal` makes. Focus moves into it on
  open, Tab cannot leave it, and the control that opened it gets focus back when
  it closes; previously focus sat on a button behind the scrim and the first
  Shift+Tab walked into the table. Clicking beside a window dismisses it, which
  is what everyone tries first — but only when both the press and the release
  land outside, so selecting text in a dialog and releasing past its edge no
  longer throws away what you were in the middle of. Settings dismisses that way
  too: the form stages the whole document and reaches `config.yaml` only on Save,
  and the window reads the file fresh every time it opens, so a reopen gives back
  everything closing it costs.
  
  A window larger than the space it has now scrolls to all of it. Centring with
  `place-items: center` splits an oversized item's overflow to both sides, and
  the half past the scroll origin is reachable by no scrollbar, so a window
  taller or wider than the viewport lost an edge off the top or the left —
  which reads as a window that failed to centre rather than one that is too big.
  `margin: auto` centres the same way while collapsing on the overflowing side.
  Each window is capped to the overlay's content box, and Settings stacks its
  rail above its pane below the width where the two cannot sit side by side.
  
  The tab strip is a real tablist rather than three buttons wearing the role. The
  run is one tab stop, the arrows move within it, Home and End reach its ends,
  and the panel below is a tabpanel labelled by whichever tab is live. A tablist
  that leaves three separate stops in the sequence is worse than the plain
  buttons it replaced, because a screen reader announces arrows that do nothing.
  
  The truncated-file-count marker is an icon with its sentence beside it instead
  of a bare warning sign whose meaning lived only in a tooltip, and a table
  loading its rows says `aria-busy` rather than announcing nothing at all.

- [#31](https://github.com/luojiahai/notam/pull/31) [`d5e561b`](https://github.com/luojiahai/notam/commit/d5e561bc32fad98183cffad048a64c7144b07ad5) Thanks [@luojiahai](https://github.com/luojiahai)! - Settings is a centred window with a rail, and the header control is a gear.
  
  The header's Settings button loses its label. It is a glyph now, beside the
  GitHub mark that already worked that way, under the rule the header follows:
  a control that takes you somewhere or toggles chrome carries an icon and an
  accessible name, and a control that acts on what you are looking at keeps its
  label. The theme control is neither, so it keeps its three words — it shows
  which of three modes is live, and no single glyph says that.
  
  Settings itself stops being a drawer. Hosts, their repositories, whatever is
  archived, and the process knobs are listed down the left; whichever you pick
  is edited on the right. The relationship the document holds as a foreign key
  is visible without opening anything: a repository sits under the host that
  owns it, and its count sits beside the host's name. Only one entity's fields
  are on screen, so the window is the same height whether you have configured
  one repository or twenty.
  
  That is what earns it the centred geometry a drawer pinned to one edge cannot
  give: a split wants width and height together. Save and Discard are pinned to
  the bottom edge, because the rail and the pane scroll independently and an
  action inside either could be scrolled away from a change made in the other.
  Escape closes the window, and so does a click beside it.
  
  Analysis and Server merge into one Process pane, stating once that its knobs
  apply at the next start instead of once per heading. Restoring something
  archived now moves the pane to what was restored rather than leaving a Restore
  button for a row the document already names. The empty state a first run meets
  offers "Configure a repository", which is what that path is for.

## 0.1.5

### Patch Changes

- [#29](https://github.com/luojiahai/notam/pull/29) [`ec2b810`](https://github.com/luojiahai/notam/commit/ec2b8109b32214b94dc1c7f723c4ede2410ac205) Thanks [@luojiahai](https://github.com/luojiahai)! - Config is editable from the browser, and created on first run.
  
  `notam` on its own now starts the server; `run`, `init`, and `sync` are
  gone, each with an error naming what replaced it. A first run writes
  `~/.notam/config.yaml` itself — with the github.com host filled in and no
  repositories — so there is nothing to set up before opening the UI. A file
  that exists but does not parse is never replaced.
  
  A settings drawer edits the same file a text editor does. NOTAM now owns
  it: saving rewrites it whole, so comments do not survive, and a save built
  on a version that has since changed on disk is refused rather than applied.
  Tokens stay out of it — the drawer edits the name of the environment
  variable and offers a connection test, and the value never reaches the
  browser.
  
  Removing a host or repository archives it. Entries, rules, and promotion
  history are kept, adding it back restores them, and deleting permanently is
  a separate, confirmed action. Renaming in the drawer carries that history
  across; renaming by hand in the file does not, because a repository's
  identity there is its host and name.
  
  A missing token variable is now a warning rather than a refusal to start,
  since the drawer is where it gets fixed. Scheduled syncs move from
  `notam sync` to `curl -X POST http://127.0.0.1:4317/api/repos/<id>/sync`.

## 0.1.4

### Patch Changes

- [#28](https://github.com/luojiahai/notam/pull/28) [`59bef6c`](https://github.com/luojiahai/notam/commit/59bef6c50f4176e7ba5dd19f98e11dd92c1da973) Thanks [@luojiahai](https://github.com/luojiahai)! - The left sidebar can be resized by dragging its right edge, and remembers the
  width you give it.
  
  It will not go narrower than `11rem` or wider than `30rem`, and never takes
  more than 40% of the window, so a width chosen on a large monitor still leaves
  room for the tables on a laptop. Narrowing the window squeezes the sidebar
  without forgetting what you picked: widen it again and your width comes back.
  
  The handle takes the keyboard as well as the mouse. Tab to it and the arrow
  keys nudge the edge, Shift jumps, and Home and End go straight to the narrowest
  and widest. Escape abandons a drag part-way through, and double-clicking the
  edge puts the sidebar back to its default width.
  
  On a narrow window the sidebar is a horizontal rail rather than a column, so
  there is no edge to drag and the handle does not appear.

- [#26](https://github.com/luojiahai/notam/pull/26) [`30a3f0f`](https://github.com/luojiahai/notam/commit/30a3f0f8b21eda9b3a7084158be6bd51692eaf19) Thanks [@luojiahai](https://github.com/luojiahai)! - `uninstall.sh` is the mirror of `install.sh`: it removes the binary the
  installer placed, then asks whether to delete the configuration and database in
  `~/.notam`. It makes no network calls.
  
  The question is asked on `/dev/tty` rather than stdin, because under
  `curl -fsSL … | sh` stdin is the script itself and a plain `read` would swallow
  the rest of it. Where there is no terminal to ask on — a CI job, or output
  redirected to a file — it keeps `~/.notam` and says so, so data is never
  deleted because nobody was there to say otherwise. A bare Enter keeps it too;
  only a plain yes deletes. `--keep-data` and `--purge` answer up front, and
  together they are refused rather than resolved.
  
  `--purge` removes only the files NOTAM writes — `config.yaml`, `notam.db` and
  its `-wal`, `-shm` and `.bak` companions — then removes `~/.notam` itself if
  that emptied it. A hand-written `~/.notam/prompts/` template is something NOTAM
  only ever reads, so it survives, and the directory is kept with it. The data
  directory is resolved through `NOTAM_HOME` exactly as the CLI resolves it, and
  the resolved path appears in the question, so a `sudo -i` teardown pointing at
  `/root/.notam` is visible before anything is removed.
  
  Only the binary at `--dir` (or `NOTAM_DIR`, default `~/.local/bin`) is removed,
  and a symlink there is unlinked rather than followed. Another `notam` elsewhere
  on your `PATH` is reported rather than deleted, since the installer did not put
  it there. A binary that is already gone is not an error — half-uninstalled is
  the state you rerun this from — and failures are collected rather than fatal,
  so a binary that needs `sudo` to unlink does not abandon the purge.

- [#27](https://github.com/luojiahai/notam/pull/27) [`a180049`](https://github.com/luojiahai/notam/commit/a180049e736f10d852dd1c0baf898670d5dec109) Thanks [@luojiahai](https://github.com/luojiahai)! - NOTAM is MIT licensed. A note below the license text records that the release
  binaries are compiled with Bun and statically link the components Bun bundles —
  JavaScriptCore among them, which is LGPL-2 — and points at Bun's own
  `LICENSE.md` for the full list, rather than enumerating a set that will change
  without us.
  
  The README is now only what someone running NOTAM needs. How it is built,
  tested, and released has moved to `CONTRIBUTING.md`, which also writes down the
  commit and branch conventions, the invariants worth preserving, and the two
  ordering hazards in the test suites that fail confusingly when you trip them.
  
  Several documented behaviours were less true than they read, and now say what
  NOTAM does. A rate-limited sync backs off a bounded number of times rather than
  indefinitely. `notam run` scans a bounded range of ports before giving up. The
  installer cannot name the version it replaces when running as root, because it
  will not execute a file it found already in place. `NOTAM_VERSION` takes a tag
  with or without its leading `v`. `NOTAM_DIR` is the environment variable behind
  `--dir`, and `NOTAM_HOME` decides which `.notam` an uninstall would purge.
  `uninstall.sh` asks about your data before it removes anything, and refuses
  `--purge` and `--keep-data` together.
  
  Sync no longer claims one query retrieves the whole conversation. Long
  conversations and long file lists are each captured up to a limit, and an entry
  that reached one is stored marked as truncated — the word `notam sync` has
  always printed in its summary, now with something to read about it. Analysis
  still runs on such an entry, on slightly less than the whole conversation.

- [#24](https://github.com/luojiahai/notam/pull/24) [`fd3f176`](https://github.com/luojiahai/notam/commit/fd3f17600f80f6d75c309087289b648736d4692c) Thanks [@luojiahai](https://github.com/luojiahai)! - `notam update` replaces the running binary with a newer release. It resolves the
  release, downloads the binary for this platform along with `SHA256SUMS`, checks
  the digest, and installs it with an atomic rename inside the directory it is
  replacing — so a half-written binary is never visible, and replacing an
  executable that is currently running is safe. A `notam` on your `PATH` that is a
  symlink has the file behind it replaced rather than the link itself.
  
  `notam update --version 0.2.0` installs an exact release; `--force` reinstalls
  the version already running. The lookup is anonymous: the token NOTAM holds
  belongs to whichever host `token_env` names, which may be an enterprise
  instance, and it is never sent to github.com.
  
  Updates only move forward. Migrations are forward-only, so an older build opens
  a database a newer one has already migrated and may find a shape it cannot read;
  `notam update` refuses a downgrade and names `install.sh` as the way to install
  an older release deliberately. Running from source it refuses outright, since
  the only executable there to replace is Bun itself.
  
  `NOTAM_REPO`, `NOTAM_API_BASE` and `NOTAM_DOWNLOAD_BASE` point the lookup
  somewhere other than the public repository, with the same meanings they already
  have in `install.sh`.

## 0.1.3

### Patch Changes

- [#22](https://github.com/luojiahai/notam/pull/22) [`b938209`](https://github.com/luojiahai/notam/commit/b938209b956f61854356f069970939aa65d56b92) Thanks [@luojiahai](https://github.com/luojiahai)! - A rule now carries its subject matter instead of a do/don't polarity. The
  analyser classifies each rule as `architecture`, `code-style`, `documentation`,
  `performance`, `security`, `testing`, or `workflow`, and a directive states its
  own prohibition rather than leaning on a badge to supply the negation. Anything
  the model returns outside those seven is stored as `other`, so one unrecognised
  label no longer discards every valid rule extracted from the same pull request.
  
  Promoted rule files scope themselves correctly. The frontmatter key for a rule's
  globs is `paths`, which is the key Claude Code reads, and an unscoped rule omits
  it entirely so it loads at launch rather than matching nothing. The promotion
  pull request groups its rules under their type.

## 0.1.2

### Patch Changes

- [#19](https://github.com/luojiahai/notam/pull/19) [`904cc30`](https://github.com/luojiahai/notam/commit/904cc30fa9b1f538c138ad49543cc2282e431cc0) Thanks [@luojiahai](https://github.com/luojiahai)! - Both headers now link out to GitHub. The app header carries NOTAM's own repository beside the version; the repository bar carries the repository it names, on whichever host serves it — `hosts[].web_base` states that address, and is derived from `api_base` when it is not given. The repository bar also gathers everything about a sync at its right-hand end, beside Sync and Stop, leaving the name and its link alone on the left.

- [#17](https://github.com/luojiahai/notam/pull/17) [`473b92c`](https://github.com/luojiahai/notam/commit/473b92c03f96552f634111de68498f38ede8e8ce) Thanks [@luojiahai](https://github.com/luojiahai)! - The header now spells the wordmark out: `Notes On Team Agreements & Methods` sits beside `NOTAM`, dimmed a level below it and hidden below tablet width, where a truncated expansion would read worse than none at all.

- [#20](https://github.com/luojiahai/notam/pull/20) [`7542aeb`](https://github.com/luojiahai/notam/commit/7542aebe27998bddf9ec1c76b81f5249cc453b68) Thanks [@luojiahai](https://github.com/luojiahai)! - A failed analysis no longer prints its error into the entries row. The stored message is `claude`'s own output, of unbounded length, and a row that grew to fit it stopped reading as a row. The Failed pill is now a button that opens the entry drawer, where that text already sits — and it sits there as a trace: monospace, its line breaks kept, scrolled past a few lines rather than growing without limit. Row action cells also take the row's full height again, so their separator lines meet the ones beside them on any row taller than a single line.

- [#21](https://github.com/luojiahai/notam/pull/21) [`274f8d7`](https://github.com/luojiahai/notam/commit/274f8d7bf866743e17040e34364561e0e6ded39c) Thanks [@luojiahai](https://github.com/luojiahai)! - Promotions have a tab of their own, beside Entries and Rules. It lists every promotion in the selected repository with the branch it was cut from, the pull request it opened, how many rules it carries, and the days it was created and last checked — filtered by open, merged or closed, and searchable by branch or pull request number. Refresh status sits in that toolbar, above the list it rewrites. Each repository in the sidebar counts the promotions open in it alongside its entries and drafts, and creating a rules pull request takes you straight to the tab it lands in.

## 0.1.1

### Patch Changes

- [#13](https://github.com/luojiahai/notam/pull/13) [`56b8341`](https://github.com/luojiahai/notam/commit/56b834158f969e3c8b2bfd25e064691401b664be) Thanks [@luojiahai](https://github.com/luojiahai)! - Releases are cut by Changesets. Each pull request declares its own bump and release note, merging one opens a version pull request, and merging that publishes the binaries, the checksums, and the changelog section written alongside the change.

## 0.1.0

### Minor Changes

- Initial release.
