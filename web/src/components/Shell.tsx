import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle.tsx";

export type ShellProps = {
	version: string;
	warnings: string[];
	sidebar: ReactNode;
	children: ReactNode;
};

/**
 * App-wide chrome only. The repository name and its Sync button used to sit in
 * this header, which made a one-repository action look like a global one; both
 * moved to `RepoBar`, above the tabs. What is left here — warnings, theme,
 * version — is true of the whole process regardless of what is selected.
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
				wraps. It used to sit in the header's flex row, where one long
				sentence was enough to push the controls off the end.
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
