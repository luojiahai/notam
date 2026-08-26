import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { GithubMark } from "./GithubMark.tsx";
import { SidebarResizer } from "./SidebarResizer.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** NOTAM's own repository, not a configured host's — a fact of the build. */
const REPOSITORY_URL = "https://github.com/luojiahai/notam";

export type ShellProps = {
	version: string;
	warnings: string[];
	onOpenSettings: () => void;
	sidebar: ReactNode;
	children: ReactNode;
};

/**
 * App-wide chrome only: warnings, theme, version — each true of the whole
 * process regardless of what is selected. Anything scoped to a single
 * repository belongs in `RepoBar`, above the tabs; in this header a
 * one-repository action reads as a global one.
 *
 * The header band takes the dark ink in both themes. It is the one surface
 * that is never data, so giving it a fixed colour rather than the theme's own
 * makes the boundary between the tool and what the tool is showing you legible
 * without a rule.
 */
export function Shell({
	version,
	warnings,
	onOpenSettings,
	sidebar,
	children,
}: ShellProps) {
	return (
		<div className="shell">
			<header className="header">
				<h1 className="brand">NOTAM</h1>
				<span className="brand-expansion">
					notes on team agreements &amp; methods
				</span>
				<span className="spacer" />
				<ThemeToggle />
				{/*
					App-wide, like everything else in this header: it edits the one
					config file, not the selected repository.

					Icon-only, which is the rule this header follows: a control that
					takes you somewhere or toggles chrome carries a glyph and an
					accessible name, and a control that acts on what you are looking
					at keeps its label. The theme control above is neither — it
					displays which of three modes is live, so it keeps its text.
				*/}
				<button
					type="button"
					className="btn-icon"
					onClick={onOpenSettings}
					aria-label="Settings"
					title="Settings"
				>
					<Settings className="icon" aria-hidden="true" />
				</button>
				<a
					className="btn-icon"
					href={REPOSITORY_URL}
					target="_blank"
					rel="noreferrer"
					aria-label="NOTAM on GitHub"
					title="NOTAM on GitHub"
				>
					<GithubMark className="icon" />
				</a>
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
				{/*
					Immediately after the sidebar and outside it: the handle finds
					the element it resizes as its previous sibling, and the sidebar
					scrolls, which would carry a handle placed inside it away.
				*/}
				<SidebarResizer />
				<main className="main">{children}</main>
			</div>

			{/*
				Where this process is and which build it is, and nothing else. Both
				answer "which NOTAM am I talking to" — the question you ask when two
				of them are open, which is what the address settles. Anything about
				the selected repository would be a second copy of the repository bar
				four rows above it.
			*/}
			<div className="statusline">
				<span className="statusline-addr">{location.host}</span>
				<span className="spacer" />
				{warnings.length > 0 && (
					<span className="statusline-warn">
						{warnings.length} warning{warnings.length === 1 ? "" : "s"}
					</span>
				)}
				<span>notam {version}</span>
			</div>
		</div>
	);
}
