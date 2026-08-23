import type { ReactNode } from "react";

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
				<h1>NOTAM</h1>
				<span className="secondary">
					{repoName ?? "no repository selected"}
				</span>
				<span className="spacer" />
				{warnings.map((warning) => (
					<span key={warning} className="warning" role="status">
						{warning}
					</span>
				))}
				<button type="button" onClick={onSync} disabled={syncing || !repoName}>
					{syncing ? "Syncing…" : "Sync"}
				</button>
				<span className="secondary">{version}</span>
			</header>
			<div className="body">
				{sidebar}
				<main className="main">{children}</main>
			</div>
		</div>
	);
}
