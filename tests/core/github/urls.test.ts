import { describe, expect, test } from "bun:test";
import { repoWebUrl, webBaseFromApi } from "../../../src/core/github/urls.ts";

describe("webBaseFromApi", () => {
	test("drops the api subdomain github.com serves its API from", () => {
		expect(webBaseFromApi("https://api.github.com")).toBe("https://github.com");
	});

	test("drops the API path an Enterprise Server host carries", () => {
		expect(webBaseFromApi("https://ghe.example.net/api/v3")).toBe(
			"https://ghe.example.net",
		);
	});

	test("keeps a port, which an Enterprise Server host may well have", () => {
		expect(webBaseFromApi("https://ghe.example.net:8443/api/v3")).toBe(
			"https://ghe.example.net:8443",
		);
	});

	test("leaves a host whose API shares its web origin alone", () => {
		expect(webBaseFromApi("https://git.example.net")).toBe(
			"https://git.example.net",
		);
	});
});

describe("repoWebUrl", () => {
	test("joins a host's web base and an owner/repo name", () => {
		expect(
			repoWebUrl(
				{ web_base: "https://github.com", api_base: "https://api.github.com" },
				"acme/mono",
			),
		).toBe("https://github.com/acme/mono");
	});

	test("falls back to the API origin for a host config no longer reconciles", () => {
		expect(
			repoWebUrl(
				{ web_base: "", api_base: "https://ghe.example.net/api/v3" },
				"acme/mono",
			),
		).toBe("https://ghe.example.net/acme/mono");
	});
});
