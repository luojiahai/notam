import { VERSION } from "../../version.ts";

export type TokenCheck = {
	ok: boolean;
	/** The authenticated account, when the host named one. */
	login: string | null;
	/** Why it failed, verbatim from the host where there is anything to quote. */
	message: string | null;
};

export type TokenCheckOptions = {
	apiBase: string;
	token: string;
	fetch?: typeof fetch;
};

/**
 * Asks a host who the token belongs to.
 *
 * This exists because the cost of keeping tokens out of config.yaml was never
 * the export itself — it was having no way to tell whether the variable you
 * exported works. One unauthenticated-cheap call answers that without NOTAM
 * ever storing the secret.
 *
 * A failure is a returned result, not a throw: "this token is rejected" is the
 * answer the caller asked for, and turning it into a 502 would make a working
 * server look broken.
 */
export async function checkToken(
	options: TokenCheckOptions,
): Promise<TokenCheck> {
	const base = options.apiBase.replace(/\/+$/, "");
	const fetchImpl = options.fetch ?? fetch;

	let response: Response;
	try {
		response = await fetchImpl(`${base}/user`, {
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${options.token}`,
				"user-agent": `notam/${VERSION}`,
			},
		});
	} catch (error) {
		return {
			ok: false,
			login: null,
			message: `Could not reach ${base}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}

	if (!response.ok) {
		return {
			ok: false,
			login: null,
			message:
				`${base} answered ${response.status} ${response.statusText}`.trim(),
		};
	}

	const body = (await response.json().catch(() => null)) as {
		login?: unknown;
	} | null;
	return {
		ok: true,
		login: typeof body?.login === "string" ? body.login : null,
		message: null,
	};
}
