/** The last segment of a repo-relative path, for the collision sentence. */
export function basename(path: string): string {
	const index = path.lastIndexOf("/");
	return index === -1 ? path : path.slice(index + 1);
}
