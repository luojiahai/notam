---
"notam": patch
---

`notam update` replaces the running binary with a newer release. It resolves the
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
