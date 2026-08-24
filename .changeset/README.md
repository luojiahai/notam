# Changesets

Every pull request that changes behaviour carries a changeset — a Markdown file
in this directory declaring the bump and describing the change in the words a
release reader needs. `bun run changeset` writes one; CI fails a pull request
that has none.

A pull request that genuinely changes nothing a user could observe still needs
one, because the check does not guess: `bun run changeset --empty` writes a
marker with no bump.

NOTAM is below 1.0, and stays there deliberately. **Breaking changes are
`minor`. Everything else is `patch`.** `major` is reserved for the day 1.0 is
cut on purpose, so never select it here.

Merging a pull request that carries changesets makes the Changesets action open
a "Version Packages" pull request, which folds them into `package.json` and
`CHANGELOG.md`. Merging *that* is what publishes a release.
