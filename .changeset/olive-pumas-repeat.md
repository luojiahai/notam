---
"notam": patch
---

`uninstall.sh` is the mirror of `install.sh`: it removes the binary the
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
