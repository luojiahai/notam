import { describe, expect, test } from "bun:test";
import {
	hostPlatform,
	isPlatform,
	PLATFORMS,
} from "../../src/shared/platform.ts";

describe("the platform table", () => {
	test("is exactly the four shipped targets", () => {
		expect([...PLATFORMS]).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"linux-arm64",
		]);
	});

	test("recognises its own members and nothing else", () => {
		expect(isPlatform("linux-arm64")).toBe(true);
		expect(isPlatform("win32-x64")).toBe(false);
	});

	test("maps a host's platform and arch onto one of them", () => {
		expect(hostPlatform("darwin", "arm64")).toBe("darwin-arm64");
		expect(hostPlatform("linux", "x64")).toBe("linux-x64");
	});

	test("refuses a host it cannot build for", () => {
		expect(() => hostPlatform("win32", "x64")).toThrow("win32-x64");
	});
});
