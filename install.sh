#!/bin/sh
# NOTAM installer.
#
#   curl -fsSL https://raw.githubusercontent.com/luojiahai/notam/main/install.sh | sh
#
# Downloads the release binary for this platform, verifies it against the
# release's SHA256SUMS, and installs it. POSIX sh: no bashisms.
set -eu

REPO="${NOTAM_REPO:-luojiahai/notam}"
API_BASE="${NOTAM_API_BASE:-https://api.github.com}"
DOWNLOAD_BASE="${NOTAM_DOWNLOAD_BASE:-https://github.com}"
DIR="${NOTAM_DIR:-$HOME/.local/bin}"
TMP=""
STAGE=""

die() {
	printf '%s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage: install.sh [--dir <path>]

Downloads the latest notam release for this platform, verifies its SHA-256
checksum against the release's SHA256SUMS, and installs it.

  --dir <path>   Install directory (default: ~/.local/bin)
  --help         Show this message

Environment:
  NOTAM_VERSION        Install this release tag instead of the latest
  NOTAM_DIR            Same as --dir
  NOTAM_REPO           owner/repo to install from
  NOTAM_API_BASE       GitHub API base URL
  NOTAM_DOWNLOAD_BASE  Release download base URL
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

detect_platform() {
	os=$(uname -s)
	arch=$(uname -m)
	case "$os" in
		Darwin) os=darwin ;;
		Linux) os=linux ;;
		*) die "Unsupported operating system \"$os\". NOTAM ships darwin and linux builds." ;;
	esac
	case "$arch" in
		arm64|aarch64) arch=arm64 ;;
		x86_64|amd64) arch=x64 ;;
		*) die "Unsupported architecture \"$arch\". NOTAM ships x64 and arm64 builds." ;;
	esac
	printf '%s-%s' "$os" "$arch"
}

resolve_tag() {
	if [ -n "${NOTAM_VERSION:-}" ]; then
		case "$NOTAM_VERSION" in
			v*) printf '%s' "$NOTAM_VERSION" ;;
			*) printf 'v%s' "$NOTAM_VERSION" ;;
		esac
		return 0
	fi
	body=$(curl -fsSL "$API_BASE/repos/$REPO/releases/latest") ||
		die "Could not reach $API_BASE to resolve the latest release of $REPO."
	tag=$(printf '%s' "$body" |
		sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
		head -n 1)
	[ -n "$tag" ] || die "The latest release of $REPO reported no tag_name."
	printf '%s' "$tag"
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d' ' -f1
	else
		die "Neither sha256sum nor shasum is available, so the download cannot be verified."
	fi
}

cleanup() {
	[ -n "$TMP" ] && rm -rf "$TMP"
	[ -n "$STAGE" ] && rm -f "$STAGE"
	return 0
}

command -v curl >/dev/null 2>&1 || die "curl is required to install NOTAM."

PLATFORM=$(detect_platform)
TAG=$(resolve_tag)
ASSET="notam-$PLATFORM"
BASE_URL="$DOWNLOAD_BASE/$REPO/releases/download/$TAG"

TMP=$(mktemp -d)
trap cleanup EXIT INT TERM

printf 'Downloading %s %s\n' "$ASSET" "$TAG"
curl -fsSL -o "$TMP/$ASSET" "$BASE_URL/$ASSET" ||
	die "Could not download $BASE_URL/$ASSET"
curl -fsSL -o "$TMP/SHA256SUMS" "$BASE_URL/SHA256SUMS" ||
	die "Could not download $BASE_URL/SHA256SUMS"

expected=$(sed -n "s/^\([0-9a-f]\{64\}\) \{1,\}$ASSET\$/\1/p" "$TMP/SHA256SUMS" | head -n 1)
[ -n "$expected" ] || die "SHA256SUMS has no entry for $ASSET."
actual=$(sha256_of "$TMP/$ASSET")
[ "$expected" = "$actual" ] || die "Checksum mismatch for $ASSET.
  expected $expected
  actual   $actual
Nothing was installed."

mkdir -p "$DIR" || die "Could not create $DIR"
TARGET="$DIR/notam"

if [ -e "$TARGET" ]; then
	previous=$("$TARGET" version 2>/dev/null || printf 'unknown version')
	printf 'Upgrading the existing install at %s (%s).\n' "$TARGET" "$previous"
fi

# Staged inside the destination so the rename is atomic on the same filesystem:
# a half-written binary is never visible, and replacing one that is currently
# running is fine.
STAGE="$DIR/.notam-install.$$"
cp "$TMP/$ASSET" "$STAGE" || die "Could not write to $DIR"
chmod +x "$STAGE"
mv "$STAGE" "$TARGET" || die "Could not install $TARGET"
STAGE=""

installed=$("$TARGET" version 2>/dev/null || printf '%s' "$TAG")
printf 'Installed notam %s to %s\n' "$installed" "$TARGET"

case ":${PATH:-}:" in
	*":$DIR:"*) ;;
	*)
		printf '\n%s is not on your PATH. Add it with:\n  export PATH="%s:$PATH"\n' \
			"$DIR" "$DIR"
		;;
esac

# A notam installed elsewhere and earlier on PATH silently keeps winning after
# this install, which is a confusing way to discover you upgraded nothing.
resolved=$(command -v notam 2>/dev/null || true)
if [ -n "$resolved" ] && [ "$resolved" != "$TARGET" ]; then
	printf '\nNote: another notam earlier on your PATH will win: %s\n' "$resolved"
fi

printf '\nNext: run `notam init`\n'
