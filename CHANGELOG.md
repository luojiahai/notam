# notam

## 0.1.2

### Patch Changes

- [#19](https://github.com/luojiahai/notam/pull/19) [`904cc30`](https://github.com/luojiahai/notam/commit/904cc30fa9b1f538c138ad49543cc2282e431cc0) Thanks [@luojiahai](https://github.com/luojiahai)! - Both headers now link out to GitHub. The app header carries NOTAM's own repository beside the version; the repository bar carries the repository it names, on whichever host serves it — `hosts[].web_base` states that address, and is derived from `api_base` when it is not given. The repository bar also gathers everything about a sync at its right-hand end, beside Sync and Stop, leaving the name and its link alone on the left.

- [#17](https://github.com/luojiahai/notam/pull/17) [`473b92c`](https://github.com/luojiahai/notam/commit/473b92c03f96552f634111de68498f38ede8e8ce) Thanks [@luojiahai](https://github.com/luojiahai)! - The header now spells the wordmark out: `Notes On Team Agreements & Methods` sits beside `NOTAM`, dimmed a level below it and hidden below tablet width, where a truncated expansion would read worse than none at all.

- [#20](https://github.com/luojiahai/notam/pull/20) [`7542aeb`](https://github.com/luojiahai/notam/commit/7542aebe27998bddf9ec1c76b81f5249cc453b68) Thanks [@luojiahai](https://github.com/luojiahai)! - A failed analysis no longer prints its error into the entries row. The stored message is `claude`'s own output, of unbounded length, and a row that grew to fit it stopped reading as a row. The Failed pill is now a button that opens the entry drawer, where that text already sits — and it sits there as a trace: monospace, its line breaks kept, scrolled past a few lines rather than growing without limit. Row action cells also take the row's full height again, so their separator lines meet the ones beside them on any row taller than a single line.

- [#21](https://github.com/luojiahai/notam/pull/21) [`274f8d7`](https://github.com/luojiahai/notam/commit/274f8d7bf866743e17040e34364561e0e6ded39c) Thanks [@luojiahai](https://github.com/luojiahai)! - Promotions have a tab of their own, beside Entries and Rules. It lists every promotion in the selected repository with the branch it was cut from, the pull request it opened, how many rules it carries, and the days it was created and last checked — filtered by open, merged or closed, and searchable by branch or pull request number. Refresh status sits in that toolbar, above the list it rewrites. Each repository in the sidebar counts the promotions open in it alongside its entries and drafts, and creating a rules pull request takes you straight to the tab it lands in.

## 0.1.1

### Patch Changes

- [#13](https://github.com/luojiahai/notam/pull/13) [`56b8341`](https://github.com/luojiahai/notam/commit/56b834158f969e3c8b2bfd25e064691401b664be) Thanks [@luojiahai](https://github.com/luojiahai)! - Releases are cut by Changesets. Each pull request declares its own bump and release note, merging one opens a version pull request, and merging that publishes the binaries, the checksums, and the changelog section written alongside the change.

## 0.1.0

### Minor Changes

- Initial release.
