import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, realpath, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Platform } from "../../shared/platform.ts";
import type { ReleaseClient } from "../github/releases.ts";
import { compareVersions, parseVersion, tagFor } from "./version.ts";

/** Thrown for every condition that must refuse an update with an actionable message. */
export class UpdateError extends Error {
	override name = "UpdateError";
}

export type UpdateOptions = {
	client: ReleaseClient;
	/** Which release asset to fetch, i.e. what this machine runs. */
	platform: Platform;
	/** `VERSION`; "dev" whenever the binary was not compiled for a release. */
	currentVersion: string;
	execPath: string;
	/** `--version`: a bare `0.1.0` or a `v0.1.0` tag. Latest when absent. */
	requestedVersion?: string;
	/** Reinstall even when the resolved version is the one already running. */
	force?: boolean;
	log: (line: string) => void;
	signal?: AbortSignal;
};

/**
 * Replaces the running binary with a release binary, verified against that
 * release's `SHA256SUMS`.
 *
 * Forward only. An older build opens a database a newer one has already
 * migrated, and `migrations.ts` is forward-only, so the moment a migration
 * renames or drops anything the downgraded build cannot read what it finds.
 * Rolling back is `NOTAM_VERSION=<tag> sh install.sh`, which does not depend on
 * a working `notam` and is the honest place for an operation that can leave a
 * database unreadable.
 */
export async function runUpdate(options: UpdateOptions): Promise<void> {
	const { client, currentVersion, execPath, log, signal } = options;

	// Both conditions, not either: a compile-time version does not prove the
	// running executable is ours, and the name alone does not prove it came
	// from a release. Running from source, `execPath` is the Bun binary, and
	// writing a NOTAM release over the user's language runtime would be a
	// catastrophe with no undo.
	if (currentVersion === "dev" || basename(execPath) !== "notam") {
		throw new UpdateError(
			"`notam update` replaces an installed release binary, and this one is running from source.\nInstall a release with install.sh, or build one with `bun run build:binary`.",
		);
	}

	// Distinct from running from source: this is a binary that was compiled
	// with a version nothing can be ordered against, so no release can be shown
	// to be newer than it.
	const current = parseVersion(currentVersion);
	if (current === null) {
		throw new UpdateError(
			`This binary reports version "${currentVersion}", which is not major.minor.patch, so no release can be shown to be newer than it.`,
		);
	}

	// The link is what is on the user's PATH; the file behind it is what has to
	// change. Writing over the link instead would orphan the real binary and
	// silently break every other link pointing at it.
	const target = await realpath(execPath);
	const directory = dirname(target);

	const tag = tagFor(
		options.requestedVersion ?? (await client.latestTag(signal)),
	);
	const wanted = parseVersion(tag);
	if (wanted === null) {
		throw new UpdateError(
			`Cannot tell whether ${tag} is newer than ${currentVersion}: a version must be major.minor.patch.`,
		);
	}

	const ordering = compareVersions(wanted, current);
	if (ordering < 0) {
		throw new UpdateError(
			`${strip(tag)} is older than the ${currentVersion} you are running, and \`notam update\` only moves forward.\nTo install it anyway: NOTAM_VERSION=${strip(tag)} sh install.sh`,
		);
	}
	if (ordering === 0 && options.force !== true) {
		log(`notam is already on ${currentVersion}, nothing to do.`);
		return;
	}

	// Before the download, not after: an update that cannot possibly land
	// should cost a moment rather than 60 MB.
	try {
		await access(directory, constants.W_OK);
	} catch {
		throw new UpdateError(
			`${directory} is not writable, so ${target} cannot be replaced.\nRe-run with sudo, or re-install with install.sh.`,
		);
	}

	const asset = `notam-${options.platform}`;
	log(`Downloading ${asset} ${tag}`);
	const bytes = await client.downloadAsset(tag, asset, signal);
	const manifest = await client.downloadChecksums(tag, signal);

	const expected = digestFor(manifest, asset);
	if (expected === null) {
		throw new UpdateError(`SHA256SUMS for ${tag} has no entry for ${asset}.`);
	}
	const actual = sha256(bytes);
	// This proves the bytes arrived intact. It does not prove who produced
	// them: the manifest comes from the same host as the asset, so anyone able
	// to serve one can serve the other. Authenticity would need the release to
	// be signed and the public key to ship inside this binary.
	if (expected !== actual) {
		throw new UpdateError(
			`Checksum mismatch for ${asset}.\n  expected ${expected}\n  actual   ${actual}\nNothing was installed.`,
		);
	}

	await install(bytes, target, directory, signal);
	log(`Installed notam ${strip(tag)} to ${target}`);
}

/**
 * Staged inside the destination directory so the rename is atomic on the same
 * filesystem: a half-written binary is never visible, and replacing one that is
 * currently running is fine — the running process keeps the old inode. The
 * suffix is random rather than derived from the pid so a pre-created symlink at
 * a predictable path in a shared directory cannot intercept the verified bytes.
 */
async function install(
	bytes: Uint8Array,
	target: string,
	directory: string,
	signal: AbortSignal | undefined,
): Promise<void> {
	// The last point at which stopping costs nothing. Everything past here is a
	// write followed by a rename, and interrupting between those two would leave
	// a staging file behind for no benefit.
	signal?.throwIfAborted();

	const stage = join(
		directory,
		`.notam-update.${randomBytes(6).toString("hex")}`,
	);
	try {
		await Bun.write(stage, bytes);
		await chmod(stage, 0o755);
		await rename(stage, target);
	} catch (error) {
		await rm(stage, { force: true });
		throw error;
	}
}

/** The manifest format `sha256sum -c` reads: a 64-character digest, spaces, the file name. */
function digestFor(manifest: string, asset: string): string | null {
	for (const line of manifest.split("\n")) {
		const match = /^([0-9a-f]{64}) +(.+)$/.exec(line.trim());
		if (match && match[2] === asset) return match[1] ?? null;
	}
	return null;
}

function sha256(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest("hex");
}

function strip(tag: string): string {
	return tag.startsWith("v") ? tag.slice(1) : tag;
}
