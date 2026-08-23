import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `root` is pinned to this file's directory rather than left to default: both
 * scripts run from the repository root, where Vite would otherwise look for
 * `index.html`. With it pinned, `outDir: "dist"` is `web/dist` — the directory
 * `src/server/static.ts` loads at boot.
 *
 * The dev proxy points at the default `notam run` port so `bun run dev:web`
 * gives hot reload against a real server, SSE included.
 */
export default defineConfig({
	root: import.meta.dirname,
	plugins: [react()],
	build: { outDir: "dist", emptyOutDir: true },
	server: {
		port: 5173,
		proxy: { "/api": { target: "http://127.0.0.1:4317", changeOrigin: false } },
	},
});
