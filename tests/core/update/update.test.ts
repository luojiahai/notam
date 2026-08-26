import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseClient } from "../../../src/core/github/releases.ts";
import { runUpdate, UpdateError } from "../../../src/core/update/index.ts";

const API = "https://api.test";
const DOWNLOAD = "https://dl.test";
const ASSET = "notam-linux-x64";

const NEW_BINARY = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);

function sha256(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest("hex");
}

type Release = {
	latest?: string;
	/** Tag to asset bytes. Anything unlisted 404s, which is how a bad tag is driven. */
	assets?: Record<string, Uint8Array>;
	/** Overrides the manifest that would otherwise describe `assets`. */
	sums?: string;
};

function releaseClient(release: Release) {
	const calls: string[] = [];
	const fetchImpl = (async (url: string | URL | Request) => {
		const href = typeof url === "string" ? url : url.toString();
		calls.push(href);

		if (href === `${API}/repos/acme/notam/releases/latest`) {
			if (release.latest === undefined)
				return new Response("", { status: 404 });
			return new Response(JSON.stringify({ tag_name: release.latest }), {
				headers: { "content-type": "application/json" },
			});
		}

		const prefix = `${DOWNLOAD}/acme/notam/releases/download/`;
		if (href.startsWith(prefix)) {
			const [tag, name] = href.slice(prefix.length).split("/");
			const bytes = tag === undefined ? undefined : release.assets?.[tag];
			if (bytes === undefined) return new Response("", { status: 404 });
			if (name === "SHA256SUMS") {
				return new Response(release.sums ?? `${sha256(bytes)}  ${ASSET}\n`);
			}
			if (name === ASSET) return new Response(bytes.slice().buffer);
		}
		return new Response("", { status: 404 });
	}) as typeof fetch;

	return {
		calls,
		client: new ReleaseClient({
			repo: "acme/notam",
			apiBase: API,
			downloadBase: DOWNLOAD,
			fetch: fetchImpl,
			sleep: async () => {},
		}),
	};
}

let dir: string;
let execPath: string;
const lines: string[] = [];

beforeEach(async () => {
	// Canonical, because the code resolves the target through realpath and on
	// macOS /var is itself a symlink to /private/var.
	dir = await realpath(await mkdtemp(join(tmpdir(), "notam-update-")));
	execPath = join(dir, "notam");
	await writeFile(execPath, "old binary");
	await chmod(execPath, 0o755);
	lines.length = 0;
});

afterEach(async () => {
	await chmod(dir, 0o755).catch(() => {});
	await rm(dir, { recursive: true, force: true });
});

function update(release: Release, options: Record<string, unknown> = {}) {
	const { client, calls } = releaseClient(release);
	return {
		calls,
		run: () =>
			runUpdate({
				client,
				platform: "linux-x64",
				currentVersion: "0.1.2",
				execPath,
				log: (line) => lines.push(line),
				...options,
			}),
	};
}

const UPGRADE: Release = { latest: "v0.2.0", assets: { "v0.2.0": NEW_BINARY } };

/** Awaits a refusal and hands back the error, so one attempt answers every assertion. */
async function refusal(run: () => Promise<void>): Promise<Error> {
	try {
		await run();
	} catch (error) {
		return error as Error;
	}
	throw new Error("expected the update to be refused, but it succeeded");
}

describe("a successful update", () => {
	test("replaces the running binary with the verified bytes", async () => {
		await update(UPGRADE).run();
		expect(new Uint8Array(await Bun.file(execPath).arrayBuffer())).toEqual(
			NEW_BINARY,
		);
	});

	test("leaves the replacement executable", async () => {
		await update(UPGRADE).run();
		expect((await stat(execPath)).mode & 0o111).toBeGreaterThan(0);
	});

	test("says what it downloaded and where it landed", async () => {
		await update(UPGRADE).run();
		expect(lines.join("\n")).toContain(`Downloading ${ASSET} v0.2.0`);
		expect(lines.join("\n")).toContain(`Installed notam 0.2.0 to ${execPath}`);
	});

	test("leaves no staging file behind", async () => {
		await update(UPGRADE).run();
		expect(await readdir(dir)).toEqual(["notam"]);
	});

	test("installs an explicitly requested newer tag without asking for latest", async () => {
		const { run, calls } = update(
			{ assets: { "v0.3.0": NEW_BINARY } },
			{ requestedVersion: "0.3.0" },
		);
		await run();
		expect(calls.some((url) => url.includes("releases/latest"))).toBe(false);
		expect(calls.some((url) => url.includes("/download/v0.3.0/"))).toBe(true);
	});
});

describe("already on the resolved version", () => {
	test("does nothing and says so", async () => {
		const { run, calls } = update({
			latest: "v0.1.2",
			assets: { "v0.1.2": NEW_BINARY },
		});
		await run();
		expect(lines.join("\n")).toContain("already on 0.1.2");
		expect(await Bun.file(execPath).text()).toBe("old binary");
		expect(calls.some((url) => url.includes("/download/"))).toBe(false);
	});

	test("reinstalls under --force", async () => {
		await update(
			{ latest: "v0.1.2", assets: { "v0.1.2": NEW_BINARY } },
			{ force: true },
		).run();
		expect(new Uint8Array(await Bun.file(execPath).arrayBuffer())).toEqual(
			NEW_BINARY,
		);
	});
});

describe("refusals", () => {
	test("refuses to update a build that came from source", async () => {
		const { run } = update(UPGRADE, { currentVersion: "dev" });
		const error = await refusal(run);
		expect(error).toBeInstanceOf(UpdateError);
		expect(error.message).toContain("running from source");
	});

	test("refuses a build whose own version cannot be ordered", async () => {
		const { run } = update(UPGRADE, { currentVersion: "9.9.9-test" });
		expect((await refusal(run)).message).toContain("9.9.9-test");
	});

	test("refuses when the running executable is not notam", async () => {
		const bun = join(dir, "bun");
		await writeFile(bun, "not notam");
		const { run } = update(UPGRADE, { execPath: bun });
		expect(await refusal(run)).toBeInstanceOf(UpdateError);
	});

	test("refuses a downgrade and names the way to roll back anyway", async () => {
		const { run, calls } = update(
			{ assets: { "v0.1.0": NEW_BINARY } },
			{ requestedVersion: "0.1.0" },
		);
		const error = await refusal(run);
		expect(error.message).toContain("older");
		expect(error.message).toContain("install.sh");
		// Refused before anything was fetched, not after paying for the download.
		expect(calls.some((url) => url.includes("/download/"))).toBe(false);
	});

	test("refuses a downgrade even under --force", async () => {
		const { run } = update(
			{ assets: { "v0.1.0": NEW_BINARY } },
			{ requestedVersion: "0.1.0", force: true },
		);
		expect(await refusal(run)).toBeInstanceOf(UpdateError);
	});

	test("refuses a version it cannot order", async () => {
		const { run } = update(UPGRADE, { requestedVersion: "0.2.0-rc.1" });
		expect((await refusal(run)).message).toContain("0.2.0-rc.1");
	});

	test("refuses when the install directory is not writable", async () => {
		if (process.getuid?.() === 0) return;
		await chmod(dir, 0o500);
		const { run, calls } = update(
			{ assets: { "v0.3.0": NEW_BINARY } },
			{ requestedVersion: "0.3.0" },
		);
		expect((await refusal(run)).message).toContain(dir);
		// Checked before the download, so a doomed update costs no bytes at all.
		expect(calls).toHaveLength(0);
	});

	test("refuses bytes whose digest does not match the manifest", async () => {
		const { run } = update({
			latest: "v0.2.0",
			assets: { "v0.2.0": NEW_BINARY },
			sums: `${"0".repeat(64)}  ${ASSET}\n`,
		});
		expect((await refusal(run)).message).toContain("Checksum mismatch");
		expect(await Bun.file(execPath).text()).toBe("old binary");
	});

	test("refuses a manifest with no entry for this platform's asset", async () => {
		const { run } = update({
			latest: "v0.2.0",
			assets: { "v0.2.0": NEW_BINARY },
			sums: `${"0".repeat(64)}  notam-darwin-arm64\n`,
		});
		expect((await refusal(run)).message).toContain(ASSET);
	});

	test("leaves the old binary in place when the download fails", async () => {
		const { run } = update({ latest: "v9.9.9" });
		await refusal(run);
		expect(await Bun.file(execPath).text()).toBe("old binary");
	});
});

describe("interruption", () => {
	test("stops before writing anything when the signal is already aborted", async () => {
		const { run } = update(UPGRADE, { signal: AbortSignal.abort() });
		await refusal(run);
		expect(await Bun.file(execPath).text()).toBe("old binary");
		expect(await readdir(dir)).toEqual(["notam"]);
	});
});

describe("symlinked installs", () => {
	test("replaces the target and leaves the link a link", async () => {
		const bin = join(dir, "bin");
		await mkdir(bin);
		const link = join(bin, "notam");
		await symlink(execPath, link);

		await update(UPGRADE, { execPath: link }).run();

		expect((await lstat(link)).isSymbolicLink()).toBe(true);
		expect(new Uint8Array(await Bun.file(execPath).arrayBuffer())).toEqual(
			NEW_BINARY,
		);
	});

	test("reports the resolved path it actually wrote to", async () => {
		const bin = join(dir, "bin");
		await mkdir(bin);
		const link = join(bin, "notam");
		await symlink(execPath, link);

		await update(UPGRADE, { execPath: link }).run();

		expect(lines.join("\n")).toContain(execPath);
	});
});
