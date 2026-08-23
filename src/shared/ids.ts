/** Crockford base32: no I, L, O, or U, so ids never read as a word or a typo. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(millis: number, length: number): string {
	let out = "";
	let n = millis;
	for (let i = 0; i < length; i++) {
		out = ALPHABET.charAt(n % 32) + out;
		n = Math.floor(n / 32);
	}
	return out;
}

/**
 * A sortable, prefixed, 22-character id: `<prefix>_<10 time chars><10 random chars>`.
 * The time prefix makes ids sort by creation order, which is what lets the job
 * queue claim work with a plain `ORDER BY created_at, id`.
 */
export function newId(prefix: string, now: number = Date.now()): string {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	let random = "";
	for (const byte of bytes) random += ALPHABET.charAt(byte % 32);
	return `${prefix}_${encodeTime(now, 10)}${random}`;
}
