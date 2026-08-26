---
"notam": patch
---

Config is editable from the browser, and created on first run.

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
