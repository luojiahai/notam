#!/usr/bin/env bun
/**
 * Compiles NOTAM into one self-contained executable per platform, with the
 * built single-page app inside it.
 *
 *   bun run scripts/build-binary.ts                       # this host, version "dev"
 *   bun run scripts/build-binary.ts --all --version 0.1.0 # all four, tagged
 *
 * Run `bun run build:web` first: a binary without the SPA is a binary that
 * serves the "web UI is not built" page, and shipping one of those would be
 * worse than failing here.
 */
import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { listAssetPaths } from "../src/server/static.ts";
import {
	hostPlatform,
	isPlatform,
	PLATFORMS,
	type Platform,
	renderEntryModule,
} from "./entry-module.ts";

/** Fixed, because the generated entrypoint imports `../src/...` relatively. */
const BUILD_DIR = "build";

/**
 * The specifier the generated entrypoint imports web assets through, relative
 * to `BUILD_DIR`. `relative()` omits a leading `./` whenever the target is a
 * plain descendant (e.g. `--web-dist build/spa` relative to `build` is just
 * `"spa"`), and a bare specifier like that is resolved by `bun build` as a
 * *package* rather than a path. Prefixing restores the relative form without
 * disturbing the `../`-style results `relative()` already produces correctly.
 */
export function webDistImportBase(buildDir: string, webDist: string): string {
	const base = relative(resolve(buildDir), resolve(webDist))
		.split("\\")
		.join("/");
	return base.startsWith(".") ? base : `./${base}`;
}

export type BuildOptions = {
	platforms: Platform[];
	version: string;
	outDir: string;
	webDist: string;
};

export function parseArgs(argv: string[]): BuildOptions {
	const platforms: Platform[] = [];
	let version = "dev";
	let outDir = "dist";
	let webDist = "web/dist";

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		if (flag === undefined) continue;
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined || next.startsWith("--")) {
				throw new Error(`${flag} needs a value`);
			}
			return next;
		};
		switch (flag) {
			case "--target": {
				const target = value();
				if (!isPlatform(target)) {
					throw new Error(
						`Unknown target "${target}". Known: ${PLATFORMS.join(", ")}`,
					);
				}
				platforms.push(target);
				break;
			}
			case "--all":
				platforms.push(...PLATFORMS);
				break;
			case "--version":
				version = value();
				break;
			case "--outdir":
				outDir = value();
				break;
			case "--web-dist":
				webDist = value();
				break;
			default:
				throw new Error(`Unknown flag "${flag}"`);
		}
	}

	if (platforms.length === 0) platforms.push(hostPlatform());
	return { platforms: [...new Set(platforms)], version, outDir, webDist };
}

export async function buildBinaries(options: BuildOptions): Promise<string[]> {
	const paths = await listAssetPaths(options.webDist);
	if (paths.length === 0) {
		throw new Error(
			`No web assets found in ${options.webDist}. Run \`bun run build:web\` first.`,
		);
	}

	await mkdir(BUILD_DIR, { recursive: true });
	await mkdir(options.outDir, { recursive: true });

	const entryPath = join(BUILD_DIR, "entry.ts");
	const base = webDistImportBase(BUILD_DIR, options.webDist);
	await Bun.write(entryPath, renderEntryModule(paths, base));

	const built: string[] = [];
	for (const platform of options.platforms) {
		const outfile = join(options.outDir, `notam-${platform}`);
		const proc = Bun.spawn(
			[
				"bun",
				"build",
				"--compile",
				`--target=bun-${platform}`,
				// The one place the version enters the product. `src/version.ts`
				// reads `process.env.NOTAM_VERSION`, and --define replaces that
				// expression with a literal at compile time.
				"--define",
				`process.env.NOTAM_VERSION=${JSON.stringify(options.version)}`,
				"--outfile",
				outfile,
				entryPath,
			],
			{ stdout: "inherit", stderr: "inherit" },
		);
		const code = await proc.exited;
		if (code !== 0) {
			throw new Error(
				`bun build --compile failed for ${platform} (exit ${code})`,
			);
		}
		built.push(outfile);
	}
	return built;
}

if (import.meta.main) {
	try {
		const options = parseArgs(Bun.argv.slice(2));
		for (const path of await buildBinaries(options)) {
			console.log(`Built ${path} (${options.version})`);
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
