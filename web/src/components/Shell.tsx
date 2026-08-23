import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle.tsx";

export type ShellProps = {
	repoName: string | null;
	version: string;
	warnings: string[];
	onSync: () => void;
	syncing: boolean;
	sidebar: ReactNode;
	children: ReactNode;
};

export function Shell({
	repoName,
	version,
	warnings,
	onSync,
	syncing,
	sidebar,
	children,
}: ShellProps) {
	return (
		<div className="shell">
			<header className="header">
				<h1 className="brand">NOTAM</h1>
				<span className="header-context" data-empty={repoName === null}>
					{repoName ?? "no repository selected"}
				</span>
				<span className="spacer" />
				<button
					type="button"
					className="btn-primary"
					onClick={onSync}
					disabled={syncing || !repoName}
				>
					{syncing ? "Syncing…" : "Sync"}
				</button>
				<ThemeToggle />
				<span className="version">{version}</span>
			</header>

			{/*
				Warnings used to sit in the header's flex row, where one long
				sentence from the server squeezed the sync button off the end.
				They are server text of unbounded length, so they get the full
				width and wrap instead of competing with the controls.
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
