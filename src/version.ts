/**
 * Replaced at build time by `bun build --define`. Plan 4 wires the release
 * pipeline; running from source always reports "dev".
 */
export const VERSION: string = process.env.NOTAM_VERSION ?? "dev";
