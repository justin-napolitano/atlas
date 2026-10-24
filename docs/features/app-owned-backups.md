# Application-owned Markdown backups

Epic #256, owner direction #255, [ADR 0007](../adr/0007-app-owned-markdown-backups.md).
This extends the existing local Electron private-vault connection. Application
storage remains authoritative for all notes and reading.

## Reviewed delivery

Select at most ten saved standalone pages in Markdown backups, then review exact
saved revisions and exclusions. Review is read-only remotely. Applying the reviewed
selection uses the pinned private account/repository/branch and expected branch
head. A remote difference is a conflict; it never pulls into Atlas. Divergent
versions remain available for comparison. Unsupported selections are excluded;
eligible pages can proceed alongside them, but an all-excluded batch cannot confirm.

The operation UUID and frozen payload are persisted before dispatch. An uncertain
response is reconciled by operation marker and exact content, rather than a blind
second commit. Concurrent typing remains a newer local revision. Local save success
is independent of remote backup success. There is no automatic background backup.

## Version 1 coverage

Existing files remain `notes/<uuid>.md` and `.atlas/pages/<uuid>.json`. A backup adds
`.atlas/backups/<operation-uuid>.json` with format `1`, kind
`atlas-application-note-backup`, creation timestamp and selected-page scope. Each
covered page has its stable note ID, source application revision and SHA-256 of the
exact raw Markdown and metadata bytes. Explicit selected exclusions have ID,
revision and reason. Strict decoding rejects unknown versions, duplicate IDs/keys,
invalid paths/digests and inconsistent counts. Batches and file sizes are bounded.

The manifest does not contain its own Git commit ID: that would be self-referential.
The durable application operation/result records dispatch state and confirmed commit
alongside the manifest. Confirmation verifies the manifest and every covered file
at that immutable snapshot. File hashes cover original bytes, including Unicode
and line endings, rather than a normalized or re-encoded representation.

Coverage excludes unselected pages, source-bound notes/annotations, reading
positions/progress, drafts/revisions/Trash, original files, GitHub tasks/comments
and folder hierarchy. Legacy project context and unsupported links remain local.
Linked dependencies must be available remotely or included in the selected export;
recovery reports dependencies outside the snapshot that are missing locally.
This is not a complete database backup, reader migration or Obsidian compatibility
certification. Use the existing coordinated database/artifact backup for full recovery.

## Recovery inspection

Inspect backups lists bounded manifest summaries, paginated by UUID rather than
date. Inspect recovery resolves the commit that last changed the selected manifest
when no explicit commit is supplied; it never substitutes today's page files for
an older snapshot. Hash verification precedes comparison. Results report `matches`,
`would_create`, `conflict` or `blocked` with the original application revision and
current local revision, where present.

Inspection performs no SQL writes, imports, task creation, revision replacement or
pending-operation replay. A mismatch or unavailable dependency stops confirmation
or marks the proposed recovery as blocked. There is no owner restore action in
this delivery. Synthetic tests import supported records into a second empty database
through the existing codec to prove recovery fidelity without touching owner data.

Prepared legacy plans cannot apply after this authority change. Already-dispatching
push-only legacy operations can reconcile their existing commit, but have no new
verified receipt; legacy plans containing pulls cannot run. Existing records remain
preserved for review. New backup selections use `app-backup-v1` mode.

## Boundaries and verification

Recovery/list routes exist only in the trusted desktop owner service with existing
session/origin protection. Hosted/public routes remain unavailable. Each remote
read rechecks private visibility and pinned identities. Imported Markdown, metadata
and task text remain untrusted data; no code, hooks or task instructions execute.
Native authentication/private-data release review remains flagged; this document
does not assert external security approval.

Acceptance uses synthetic PostgreSQL, fake GitHub and a disposable native workspace.
Tests cover exact bytes, remote divergence, lost acknowledgement, newer typing,
partial exclusions, tampered snapshots, historical recovery, missing dependencies
and fresh-database reconstruction. No actual owner notes or credentials are fixtures.
See the [delivery record](private-github-vault-delivery.md) and #256 for results.
