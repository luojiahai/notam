/**
 * A local stand-in for the two GitHub endpoints `install.sh` uses: the latest
 * release lookup, and the release asset downloads.
 *
 * The "binary" it serves is a shell script that prints a version, so the
 * installer's own `notam version` probe works and the test can assert on what
 * it printed.
 */
import { PLATFORMS } from "../../src/shared/platform.ts";

export const STUB_REPO = "acme/notam";
export const STUB_TAG = "v1.2.3";
export const STUB_BINARY = "#!/bin/sh\necho 1.2.3\n";

export const STUB_PLATFORMS: readonly string[] = PLATFORMS;

export function sha256(text: string): string {
	return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export function defaultChecksums(): string {
	const sum = sha256(STUB_BINARY);
	return `${STUB_PLATFORMS.map((platform) => `${sum}  notam-${platform}`).join(
		"\n",
	)}\n`;
}

export type ReleaseStub = {
	url: string;
	/** Every path requested, in order, so a test can assert what was skipped. */
	requests: string[];
	setChecksums: (text: string) => void;
	reset: () => void;
	close: () => Promise<void>;
};

export function startReleaseStub(): ReleaseStub {
	const requests: string[] = [];
	let checksums = defaultChecksums();

	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch(request) {
			const { pathname } = new URL(request.url);
			requests.push(pathname);

			if (pathname === `/repos/${STUB_REPO}/releases/latest`) {
				return Response.json({ tag_name: STUB_TAG, name: STUB_TAG });
			}
			const downloads = `/${STUB_REPO}/releases/download/${STUB_TAG}`;
			if (pathname === `${downloads}/SHA256SUMS`) {
				return new Response(checksums);
			}
			for (const platform of STUB_PLATFORMS) {
				if (pathname === `${downloads}/notam-${platform}`) {
					return new Response(STUB_BINARY);
				}
			}
			return new Response("not found", { status: 404 });
		},
	});

	return {
		url: `http://127.0.0.1:${server.port}`,
		requests,
		setChecksums: (text: string) => {
			checksums = text;
		},
		reset: () => {
			requests.length = 0;
			checksums = defaultChecksums();
		},
		close: async () => {
			await server.stop(true);
		},
	};
}
