# ADR 0006: private Markdown vault and GitHub Issues

Status: accepted direction, 2026-10-21; first local delivery under #242 in PRs #249–252.
See [verified behavior and remaining gates](../features/private-github-vault-delivery.md).

Note authority and bidirectional page sync are superseded by
[ADR 0007](0007-app-owned-markdown-backups.md) under #255/#256. The decision below
records the earlier direction; task authority and privacy boundaries still apply.

## Decision

Use one private content repository for portable Markdown context and its GitHub
Issues for actionable tasks. Keep application code separate. Preserve the local
PostgreSQL authoring/recovery model and add an explicit sync boundary; do not turn
GitHub APIs into the synchronous editor database. Retain independent writing,
optional collections and the existing reader/source identities from ADR 0005.

Use GitHub's existing Git and Issues APIs with Markdown/YAML/JSON files. The Atlas
stable-ID mapping is a small versioned application contract, not a claim of an
external universal sync standard. Issues and Git files have different authorities
and backup mechanisms. Git history is not a backup of issue/comment API records.

The detailed [authority and acceptance contract](../features/private-github-vault.md)
governs imports, privacy, exact bodies/anchors, offline intents, retries and conflicts.
Connect is read-only until an explicit first-upload selection is reviewed. Imported
task/page context never authorizes command execution or publication by itself.

## Consequences

- The owner can work in Atlas, GitHub or a Markdown editor, with explicit conflict
  handling. A fresh instance must reconstruct supported identities before cutover.
- Ordinary writing never needs an issue. Actionable work can stand alone or link
  to existing pages; projects and stages are not required.
- PostgreSQL contains local durable state and revision-aware projections. GitHub
  agreement is shown separately from local save; offline work remains usable.
- Source-bound notes/readings need their original dependencies. Portable Markdown
  alone does not establish portable progress, highlights, licensed originals or a
  complete second-machine reader. Those remain separately gated work.
- Credential storage, repo/account binding, API limits, uncertain issue creation,
  partial coverage and issue backups are first-class implementation requirements.

This narrows the old synchronization deferral: local GitHub vault integration is
authorized now. Hosted GCP application sync, multi-user web authoring and autonomous
agent execution remain deferred. Nothing here enables an automatic private upload.
