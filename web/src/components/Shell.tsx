import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle.tsx";

export type ShellProps = {
	version: string;
	warnings: string[];
	sidebar: ReactNode;
	children: ReactNode;
};

/**
 * App-wide chrome only: warnings, theme, version — each true of the whole
 * process regardless of what is selected. Anything scoped to a single
 * repository belongs in `RepoBar`, above the tabs; in this header a
 * one-repository action reads as a global one.
 */
export function Shell({ version, warnings, sidebar, children }: ShellProps) {
	return (
		<div className="shell">
			<header className="header">
				<h1 className="brand">NOTAM</h1>
				<span className="spacer" />
				<ThemeToggle />
				<span className="version">{version}</span>
			</header>

			{/*
				Server text of unbounded length, so it gets the full width and
				wraps. It stays out of the header's flex row, where one long
				sentence is enough to push the controls off the end.
			*/}
			<div className="banners">
				{warnings.map((warning) => (
					<div key={warning} className="banner" role="status">
						<span className="banner-label">Warning</span>
						<span className="banner-text">{warning}</span>
					</div>
				))}
			</div>

			<div className="body">
				{sidebar}
				<main className="main">{children}</main>
			</div>
		</div>
	);
}
