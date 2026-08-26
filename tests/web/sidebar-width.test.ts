import { describe, expect, test } from "bun:test";
import {
	applySidebarWidth,
	clampSidebarWidth,
	peekSidebarWidth,
	readSidebarBounds,
	readSidebarWidth,
	restoreSidebarWidth,
	SIDEBAR_WIDTH_FALLBACK_MAX,
	SIDEBAR_WIDTH_FALLBACK_MIN,
	SIDEBAR_WIDTH_STORAGE_KEY,
	storeSidebarWidth,
} from "../../web/src/lib/sidebar-width.ts";

/** A `Storage` backed by a Map, so a test can inspect what was written. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
	const map = new Map(Object.entries(seed));
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key: string) => map.get(key) ?? null,
		key: (index: number) => [...map.keys()][index] ?? null,
		removeItem: (key: string) => {
			map.delete(key);
		},
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
	};
}

/** A `Storage` that throws on every access, as Safari does in privacy mode. */
function hostileStorage(): Storage {
	const boom = () => {
		throw new Error("SecurityError");
	};
	return {
		get length(): number {
			return boom();
		},
		clear: boom,
		getItem: boom,
		key: boom,
		removeItem: boom,
		setItem: boom,
	};
}

describe("readSidebarWidth", () => {
	test("round-trips a stored width", () => {
		const storage = fakeStorage();
		storeSidebarWidth(312, storage);
		expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("312");
		expect(readSidebarWidth(storage)).toBe(312);
	});

	test("stores whole pixels, so a fractional drag does not persist noise", () => {
		const storage = fakeStorage();
		storeSidebarWidth(312.4, storage);
		expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("312");
	});

	test("reads no preference as null rather than as the default", () => {
		expect(readSidebarWidth(fakeStorage())).toBeNull();
	});

	test("rejects a value that is not a positive finite number", () => {
		for (const stored of ["", "wide", "NaN", "0", "-40", "Infinity"]) {
			const storage = fakeStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: stored });
			expect(readSidebarWidth(storage)).toBeNull();
		}
	});

	test("survives a storage that throws on every access", () => {
		const storage = hostileStorage();
		expect(readSidebarWidth(storage)).toBeNull();
		expect(() => storeSidebarWidth(280, storage)).not.toThrow();
		expect(() => storeSidebarWidth(null, storage)).not.toThrow();
	});
});

describe("storeSidebarWidth", () => {
	test("clears the key rather than storing the default width", () => {
		const storage = fakeStorage({ [SIDEBAR_WIDTH_STORAGE_KEY]: "312" });
		storeSidebarWidth(null, storage);
		expect(storage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
	});
});

describe("clampSidebarWidth", () => {
	const bounds = { min: 176, max: 480 };

	test("holds a width inside the bounds unchanged", () => {
		expect(clampSidebarWidth(300, bounds)).toBe(300);
	});

	test("clamps to either bound", () => {
		expect(clampSidebarWidth(20, bounds)).toBe(176);
		expect(clampSidebarWidth(2000, bounds)).toBe(480);
	});

	test("prefers the floor when a narrow viewport puts the ceiling below it", () => {
		expect(clampSidebarWidth(300, { min: 176, max: 120 })).toBe(176);
	});
});

describe("readSidebarBounds", () => {
	/*
	 * These tests run under happy-dom, which loads no stylesheet, so this is
	 * the path taken whenever the tokens cannot be resolved — the same path a
	 * browser takes before the stylesheet arrives.
	 */
	test("falls back to the built-in bounds when the tokens do not resolve", () => {
		expect(readSidebarBounds(document.documentElement)).toEqual({
			min: SIDEBAR_WIDTH_FALLBACK_MIN,
			max: SIDEBAR_WIDTH_FALLBACK_MAX,
		});
	});
});

describe("peekSidebarWidth / restoreSidebarWidth", () => {
	test("puts back an override exactly as it stood", () => {
		const root = document.documentElement;
		applySidebarWidth(460, root);
		const before = peekSidebarWidth(root);

		applySidebarWidth(300, root);
		restoreSidebarWidth(before, root);
		expect(peekSidebarWidth(root)).toBe("460px");
		applySidebarWidth(null, root);
	});

	test("restores having had no override at all, rather than a default", () => {
		const root = document.documentElement;
		applySidebarWidth(null, root);
		const before = peekSidebarWidth(root);
		expect(before).toBe("");

		applySidebarWidth(300, root);
		restoreSidebarWidth(before, root);
		// Not "240px": pinning a width nobody chose is how a temporary clamp
		// becomes a standing preference.
		expect(peekSidebarWidth(root)).toBe("");
	});
});
