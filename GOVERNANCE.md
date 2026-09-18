# Governance

This document describes how the Brain Memory open-source project is run: who
decides what, how to take part, and how those rules change.

Brain Memory is a young project with one maintainer. This document says so
plainly, and describes how the project intends to grow beyond that.

## Scope

This governance covers everything in this repository: the memory file format,
the `brain` CLI and recall engine, the agent plugins and integrations, the
benchmark harness, and the documentation. All of it is released under the
[MIT License](LICENSE).

Brain Cloud, the optional hosted sync service operated by Omelas, is a separate
product and is not governed by this document. The local-first plugin works in
full without an account, and nothing in this repository requires the hosted
service.

## Roles

**Users** run Brain Memory. Bug reports, questions and use cases filed in the
[issue tracker](https://github.com/omelas-tech/brain/issues) are contributions.

**Contributors** are anyone who has had a change merged: code, documentation,
tests, benchmark data or integrations. No agreement needs to be signed.
Contributions are accepted under the MIT License.

**Maintainers** have write access. They review and merge contributions, cut
releases, triage issues and security reports, and are responsible for the
direction of the project. Current and emeritus maintainers are listed in
[MAINTAINERS.md](MAINTAINERS.md).

## How decisions are made

Day-to-day decisions are made in the open, in issues and pull requests, by lazy
consensus: a proposal that draws no objection from a maintainer within a
reasonable time is accepted.

Three kinds of change affect everyone who depends on the project, and are
proposed in a public issue labelled `rfc` before they land. The issue stays
open for comment for at least seven days.

- changes to the **memory file format** (frontmatter fields, directory layout,
  the index and association files)
- changes to the **scoring model** that alter how recall ranks memories
- changes to the **security model** (provenance, quarantine, consent tiers,
  encryption)

While there is a single maintainer, that maintainer makes the final call and
records the reasoning in the issue. Once there are three or more maintainers,
decisions that do not reach consensus are settled by a simple majority vote of
maintainers, and no single employer may hold a majority of the votes.

## Becoming a maintainer

The project is actively looking for co-maintainers, particularly from
organisations other than Omelas.

A contributor can be nominated as a maintainer by any existing maintainer after
sustained, good-quality involvement. As a guide, that means several
non-trivial merged changes over three months or more, and helpful
participation in review and issue triage. The nomination is made in a public
issue. It is accepted if no maintainer objects within seven days.

Maintainers who have been inactive for six months may be moved to emeritus
status, and are welcome back at any time.

## Compatibility

The memory file format is the project's public interface: memories are plain
files that users own and other tools may read. Format changes are versioned,
and any change that would make existing memories unreadable ships with a
migration and is called out in the [changelog](CHANGELOG.md).

## Security

Security reports are handled privately, as described in
[SECURITY.md](SECURITY.md).

## Code of conduct

Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Changing this document

Changes to this document are proposed by pull request and stay open for comment
for at least fourteen days before a maintainer merges them.
