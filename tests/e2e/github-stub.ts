import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export type CreatedPull = {
	title: string;
	head: string;
	base: string;
	body: string;
};

export type CreatedBlob = { content: string };

export type GitHubStub = {
	url: string;
	pulls: CreatedPull[];
	blobs: CreatedBlob[];
	/** Flip to make the next getPRState answer "merged". */
	merged: boolean;
	/** Resolves once the GraphQL listing has been asked for, so a test knows a sync is in flight. */
	listingRequested: Promise<void>;
	close: () => Promise<void>;
};

function readBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		request.on("data", (chunk) => {
			body += String(chunk);
		});
		request.on("end", () => resolve(body));
		request.on("error", reject);
	});
}

/**
 * Just enough of GitHub's REST surface for one promotion and one status check:
 * the exact call sequence `RestGitHubClient.createPRWithFiles` walks, plus the
 * contents lookup the pre-flight uses. Nothing here is reachable from the
 * product except through a URL the test config points at, so no product code
 * knows it exists.
 */
export function startGitHubStub(): Promise<GitHubStub> {
	const pulls: CreatedPull[] = [];
	const blobs: CreatedBlob[] = [];
	const state = { merged: false };
	let nextSha = 1;
	let announceListing!: () => void;
	const listingRequested = new Promise<void>((done) => {
		announceListing = done;
	});

	const server = createServer(
		(request: IncomingMessage, response: ServerResponse) => {
			void (async () => {
				const url = new URL(request.url ?? "/", "http://stub");
				const path = url.pathname;
				const send = (status: number, payload: unknown) => {
					response.writeHead(status, { "content-type": "application/json" });
					response.end(JSON.stringify(payload));
				};
				const sha = () => `sha${nextSha++}`;

				/*
				 * The listing never answers. Sync's only way out is the abort
				 * signal, which is exactly the state a user reaches for Stop in:
				 * a request that is going to sit there. The socket is left open
				 * deliberately — closing it would look like a network failure
				 * and drive the retry path instead.
				 */
				if (path === "/graphql") {
					await readBody(request);
					announceListing();
					return;
				}

				// The pre-flight: no .claude/rules directory yet.
				if (path.endsWith("/contents/.claude/rules")) {
					return send(404, { message: "Not Found" });
				}
				if (path.includes("/git/ref/heads/")) {
					return send(200, { object: { sha: "basecommit" } });
				}
				if (path.includes("/git/commits/") && request.method === "GET") {
					return send(200, { tree: { sha: "basetree" } });
				}
				if (path.endsWith("/git/blobs")) {
					const body = JSON.parse(await readBody(request)) as {
						content: string;
					};
					blobs.push({ content: body.content });
					return send(201, { sha: sha() });
				}
				if (path.endsWith("/git/trees") || path.endsWith("/git/commits")) {
					return send(201, { sha: sha() });
				}
				if (path.endsWith("/git/refs")) {
					return send(201, { ref: "refs/heads/created" });
				}
				if (path.endsWith("/pulls") && request.method === "POST") {
					const body = JSON.parse(await readBody(request)) as CreatedPull;
					pulls.push(body);
					return send(201, {
						number: 900,
						html_url: "http://example.invalid/acme/mono/pull/900",
					});
				}
				if (/\/pulls\/\d+$/.test(path) && request.method === "GET") {
					return send(200, {
						state: state.merged ? "closed" : "open",
						merged: state.merged,
					});
				}
				return send(404, { message: `stub has no route for ${path}` });
			})().catch((error: unknown) => {
				// Without this a malformed body would reject into an unhandled
				// rejection and leave the client hanging until Playwright's
				// timeout, hiding whatever actually went wrong.
				response.writeHead(500, { "content-type": "application/json" });
				response.end(JSON.stringify({ message: String(error) }));
			});
		},
	);

	return new Promise<GitHubStub>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as AddressInfo;
			resolve({
				url: `http://127.0.0.1:${port}`,
				pulls,
				blobs,
				listingRequested,
				get merged() {
					return state.merged;
				},
				set merged(value: boolean) {
					state.merged = value;
				},
				close: () =>
					new Promise<void>((done) => {
						server.close(() => done());
					}),
			});
		});
	});
}
