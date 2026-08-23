import { describe, expect, test } from "bun:test";
import { parseArgs, webDistImportBase } from "../../scripts/build-binary.ts";
import { hostPlatform } from "../../scripts/entry-module.ts";

describe("parseArgs", () => {
	test("defaults to this host, version dev, dist/, web/dist", () => {
		expect(parseArgs([])).toEqual({
			platforms: [hostPlatform()],
			version: "dev",
			outDir: "dist",
			webDist: "web/dist",
		});
	});

	test("--all is every shipped platform", () => {
		expect(parseArgs(["--all"]).platforms).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"linux-arm64",
		]);
	});

	test("takes repeated --target flags without duplicating them", () => {
		expect(
			parseArgs(["--target", "linux-x64", "--target", "linux-x64"]).platforms,
		).toEqual(["linux-x64"]);
	});

	test("reads the version, the output directory, and the dist directory", () => {
		const options = parseArgs([
			"--version",
			"0.1.0",
			"--outdir",
			"/tmp/out",
			"--web-dist",
			"/tmp/dist",
		]);
		expect(options.version).toBe("0.1.0");
		expect(options.outDir).toBe("/tmp/out");
		expect(options.webDist).toBe("/tmp/dist");
	});

	test("rejects a target it cannot build", () => {
		expect(() => parseArgs(["--target", "win32-x64"])).toThrow("win32-x64");
	});

	test("rejects a flag with no value", () => {
		expect(() => parseArgs(["--version"])).toThrow("--version needs a value");
	});

	test("rejects an unknown flag", () => {
		expect(() => parseArgs(["--fast"])).toThrow('Unknown flag "--fast"');
	});
});

describe("webDistImportBase", () => {
	test("leaves an already-relative result alone", () => {
		expect(webDistImportBase("build", "web/dist")).toBe("../web/dist");
	});

	test("prefixes a bare descendant with ./ so bun build resolves it as a path, not a package", () => {
		expect(webDistImportBase("build", "build/spa")).toBe("./spa");
	});
});
