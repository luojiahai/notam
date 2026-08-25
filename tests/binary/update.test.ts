import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { chmod, cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hostPlatform } from "../../src/shared/platform.ts";

const root = resolve(import.meta.dir, "..", "..");
const ASSET = `notam-${hostPlatform()}`;

/**
 * The release this fake server offers. A shell script rather than a second
 * compiled binary: what is under test is the download, the verification and
 * the atomic replacement of a *running* executable, and a script proves all
 * three while costing one compile instead of two.
 */
const REPLACEMENT = '#!/bin/sh\necho "0.2.0-replaced"\n';

function sha256(text: string): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(text);
	return hasher.digest("hex");
}

let outDir: string;
let installDir: string;
let binary: string;
let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

/** Set per test to drive the tag the fake release reports. */
let latestTag = "v0.2.0";
/** Set per test to serve a manifest that does not describe the asset. */
let corruptSums = false;

async function run(command: string[]): Promise<void> {
	const proc = Bun.spawn(command, {
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await proc.exited) !== 0) {
		throw new Error(`${command.join(" ")} failed`);
	}
}

async function notam(args: string[]) {
	const proc = Bun.spawn([binary, ...args], {
		cwd: installDir,
		env: {
			PATH: process.env.PATH ?? "",
			HOME: installDir,
			NOTAM_HOME: installDir,
			NOTAM_REPO: "acme/notam",
			NOTAM_API_BASE: baseUrl,
			NOTAM_DOWNLOAD_BASE: baseUrl,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode, output: stdout + stderr };
}

/** Puts a fresh copy of the compiled binary back at the install path. */
async function reinstall(): Promise<void> {
	await rm(binary, { force: true });
	await cp(join(outDir, ASSET), binary);
	await chmod(binary, 0o755);
}

beforeAll(async () => {
	outDir = await mkdtemp(join(tmpdir(), "notam-update-build-"));
	// Canonical: the binary reports the path it resolved, and on macOS the
	// temporary directory reaches it through a symlinked /var.
	installDir = await realpath(
		await mkdtemp(join(tmpdir(), "notam-update-bin-")),
	);
	binary = join(installDir, "notam");

	// A real, parseable release version: the binary refuses to update itself
	// unless it can show the offered release is newer than what it is.
	await run(["bun", "run", "build:web"]);
	await run([
		"bun",
		"run",
		"scripts/build-binary.ts",
		"--version",
		"0.1.0",
		"--outdir",
		outDir,
	]);
	await reinstall();

	server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			const { pathname } = new URL(request.url);
			if (pathname === "/repos/acme/notam/releases/latest") {
				return Response.json({ tag_name: latestTag });
			}
			const prefix = "/acme/notam/releases/download/";
			if (pathname.startsWith(prefix)) {
				const [, name] = pathname.slice(prefix.length).split("/");
				if (name === ASSET) return new Response(REPLACEMENT);
				if (name === "SHA256SUMS") {
					const digest = corruptSums ? "0".repeat(64) : sha256(REPLACEMENT);
					return new Response(`${digest}  ${ASSET}\n`);
				}
			}
			return new Response("", { status: 404 });
		},
	});
	baseUrl = `http://127.0.0.1:${server.port}`;
}, 180_000);

afterAll(async () => {
	await server?.stop(true);
	if (outDir) await rm(outDir, { recursive: true, force: true });
	if (installDir) await rm(installDir, { recursive: true, force: true });
});

describe("a compiled binary updating itself", () => {
	// Every test starts from the compiled 0.1.0 binary and an honest release,
	// so one that replaces or corrupts either cannot reach the next.
	beforeEach(async () => {
		await reinstall();
		latestTag = "v0.2.0";
		corruptSums = false;
	});

	test("replaces itself with the verified release and the replacement runs", async () => {
		const result = await notam(["update"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain(`Downloading ${ASSET} v0.2.0`);
		expect(result.output).toContain(`Installed notam 0.2.0 to ${binary}`);

		// The proof: the path that just did the updating now runs the new thing.
		const after = Bun.spawn([binary, "version"], { stdout: "pipe" });
		expect((await new Response(after.stdout).text()).trim()).toBe(
			"0.2.0-replaced",
		);
	}, 60_000);

	test("installs the exact tag --version names", async () => {
		latestTag = "v0.9.9";

		const result = await notam(["update", "--version", "0.2.0"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("Installed notam 0.2.0");
	}, 60_000);

	test("does nothing when the latest release is the version it already is", async () => {
		latestTag = "v0.1.0";

		const result = await notam(["update"]);
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("already on 0.1.0");
		expect((await notam(["version"])).stdout.trim()).toBe("0.1.0");
	}, 60_000);

	test("refuses a downgrade and points at install.sh instead", async () => {
		const result = await notam(["update", "--version", "0.0.9"]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("older");
		expect(result.output).toContain("install.sh");
		expect((await notam(["version"])).stdout.trim()).toBe("0.1.0");
	}, 60_000);

	test("leaves itself intact when the download fails verification", async () => {
		corruptSums = true;

		const result = await notam(["update"]);
		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("Checksum mismatch");
		expect(result.output).toContain("Nothing was installed");
		expect((await notam(["version"])).stdout.trim()).toBe("0.1.0");
	}, 60_000);
});
