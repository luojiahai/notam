#!/bin/sh
# NOTAM uninstaller.
#
#   curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/uninstall.sh | sh
#
# Removes the binary install.sh placed, and asks before deleting the config and
# database in ~/.notam. Touches the network never. POSIX sh: no bashisms.
set -eu

DIR="${NOTAM_DIR:-$HOME/.local/bin}"
DATA="${NOTAM_HOME:-$HOME}/.notam"
DECISION=""
KEEP_REPORTED=0
FAILED=0

die() {
	printf '%s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: uninstall.sh [--dir <path>] [--keep-data | --purge]

Removes the notam binary, then asks whether to delete the configuration and
database in ~/.notam. Without an answer it keeps them.

  --dir <path>   Directory the binary was installed to (default: ~/.local/bin)
  --keep-data    Keep ~/.notam without asking
  --purge        Delete ~/.notam without asking
  --help         Show this message

Environment:
  NOTAM_DIR      Same as --dir
  NOTAM_HOME     Overrides $HOME when locating ~/.notam
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
		--dir)
			[ $# -ge 2 ] || die "--dir needs a value"
			DIR="$2"
			shift 2
			;;
		--dir=*)
			DIR="${1#--dir=}"
			shift
			;;
		--keep-data)
			[ "$DECISION" != purge ] ||
				die "--keep-data and --purge contradict each other. Nothing was removed."
			DECISION=keep
			shift
			;;
		--purge)
			[ "$DECISION" != keep ] ||
				die "--keep-data and --purge contradict each other. Nothing was removed."
			DECISION=purge
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			usage >&2
			die "Unknown argument \"$1\""
			;;
	esac
done

TARGET="$DIR/notam"

# Ask on the terminal, never on stdin: under `curl | sh` stdin is this script,
# so a plain `read` would swallow the rest of the file and treat it as the
# answer. Output that is not going to a terminal means nobody is watching to
# answer either, which is just as non-interactive as having no /dev/tty at all.
interactive() {
	[ -t 1 ] || return 1
	( : < /dev/tty ) 2>/dev/null
}

# Returns non-zero when the file survived, so a caller can hold back the line it
# would otherwise print. A failure is collected rather than fatal: partial
# progress is progress when tearing down, and abandoning the purge because one
# file could not be unlinked leaves exactly the state the user asked to clear.
# The reason is stated here rather than left to rm, so that every failure names
# the path and the way past it.
remove() {
	{ [ -e "$1" ] || [ -L "$1" ]; } || return 0
	rm -f "$1" 2>/dev/null && return 0
	FAILED=1
	printf 'Could not remove %s. Try again with sudo.\n' "$1" >&2
	return 1
}

# The binary install.sh wrote is the only one this script may delete. Any other
# notam on PATH was put there by something else -- Homebrew, a hand-built
# checkout -- and is reported so "I uninstalled it but `notam` still works"
# has an answer. Scanned by hand rather than with `command -v`, whose result
# the shell may have cached before the removal below.
find_shadow() {
	saved="$IFS"
	IFS=:
	# Intentional word splitting: PATH is colon-separated by definition.
	set -- $PATH
	IFS="$saved"
	for entry in "$@"; do
		[ -n "$entry" ] || entry="."
		[ "$entry/notam" != "$TARGET" ] || continue
		if [ -x "$entry/notam" ] && [ ! -d "$entry/notam" ]; then
			printf '%s' "$entry/notam"
			return 0
		fi
	done
	return 1
}

# Everything is resolved before anything is removed, so the question below can
# name the exact directory it is about.
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
	binary_present=1
else
	binary_present=0
fi
[ -d "$DATA" ] && data_present=1 || data_present=0

if [ "$data_present" -eq 1 ] && [ -z "$DECISION" ]; then
	if interactive; then
		# The resolved path is in the question because `sudo -i` resolves it to
		# /root/.notam, and this is the only moment a wrong target can be
		# stopped. A bare Enter -- or anything that is not a plain yes -- keeps
		# the data; there is no re-ask, which is how this cannot spin.
		printf 'Delete your NOTAM config and database in %s? [y/N] ' "$DATA"
		IFS= read -r answer < /dev/tty || answer=""
		case "$answer" in
			[yY]|[yY][eE][sS]) DECISION=purge ;;
			*) DECISION=keep ;;
		esac
	else
		DECISION=keep
		KEEP_REPORTED=1
		printf 'No terminal to ask on, keeping %s — rerun with --purge to delete it.\n' \
			"$DATA"
	fi
fi

# The data goes first. If unlinking a root-owned binary fails, that error should
# land while the user is still reading output about a directory already dealt
# with, rather than after the binary has vanished.
if [ "$data_present" -eq 1 ]; then
	if [ "$DECISION" = purge ]; then
		printf "Deleting NOTAM's files in %s\n" "$DATA"
		kept=0
		# Only the files NOTAM writes are named here. The config template invites
		# a hand-written ~/.notam/prompts/owner-repo.md, which NOTAM only ever
		# reads: an uninstaller must not take that with it. An unmatched .bak
		# glob stays literal and remove() skips it.
		for file in \
			"$DATA/config.yaml" \
			"$DATA/notam.db" \
			"$DATA/notam.db-wal" \
			"$DATA/notam.db-shm" \
			"$DATA"/notam.db.*.bak; do
			remove "$file" || kept=1
		done
		# The directory goes only if removing NOTAM's own files emptied it. That
		# claim can only be made when they all actually went: with a file left
		# behind, what remains is NOTAM's own and rmdir was never going to work.
		if [ "$kept" -eq 0 ] && ! rmdir "$DATA" 2>/dev/null; then
			printf 'Kept %s (it still contains files NOTAM did not create).\n' "$DATA"
		fi
	elif [ "$KEEP_REPORTED" -eq 0 ]; then
		printf 'Keeping %s\n' "$DATA"
	fi
fi

if [ "$binary_present" -eq 1 ]; then
	if remove "$TARGET"; then
		printf 'Removed %s\n' "$TARGET"
	fi
else
	# Not an error: half-uninstalled is exactly the state someone reruns this
	# from, and "already gone" is the outcome they asked for.
	printf 'No notam at %s\n' "$TARGET"
fi

if shadow=$(find_shadow); then
	printf '\nNote: another notam is still on your PATH: %s\n' "$shadow"
fi

# install.sh tells people to put $DIR on their PATH, and no script may rewrite a
# shell profile to undo that. An empty $DIR is the one condition under which
# suggesting they undo it themselves is actually correct -- ~/.local/bin
# usually holds other tools, and telling everyone to drop it would break them.
if [ -d "$DIR" ] && [ -z "$(ls -A "$DIR" 2>/dev/null)" ]; then
	printf '\n%s is now empty. If you added it to your PATH for NOTAM, you can remove that line from your shell profile.\n' \
		"$DIR"
fi

exit "$FAILED"
