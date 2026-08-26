---
"notam": patch
---

NOTAM is MIT licensed. A note below the license text records that the release
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
