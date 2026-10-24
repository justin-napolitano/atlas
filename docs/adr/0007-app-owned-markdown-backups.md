# ADR 0007: application-owned notes and reviewed Markdown backups

Status: accepted owner direction, 2026-10-24; implementation epic #256 under #255.
Supersedes ADR 0006's Git-authoritative page cutover and bidirectional page delivery.

## Decision

Atlas application storage owns notes, saved revisions, drafts and reading state.
GitHub Markdown is a private, selected backup/export for optional Markdown editors
such as Obsidian. Connecting a repository does not transfer authority. A remote
edit becomes a visible conflict; backup delivery never imports or replaces writing.
An eventual import needs a separate explicit review and mutation contract.

Reuse existing stable page IDs, the portable page codec, private account/repository
binding and expected-head commit delivery. Record exact raw body/metadata digests
and source application revisions in a versioned coverage manifest. Confirm only
after verifying those bytes at the resulting Git commit. Store the commit identity
in the application receipt envelope, outside the manifest committed to that commit.

Recovery inspection reads a historical snapshot, verifies coverage and compares
against current application records. It reports matches, missing pages, conflicts
and missing dependencies without changing SQL records or replaying tasks. Synthetic
fresh-database import proves the existing codec; it does not enable owner import.

## Consequences

- Local save, backup dispatch, verified coverage and device synchronization remain
  distinct. A later acknowledgement cannot confirm newer unsent writing.
- Each selected snapshot covers at most ten saved standalone pages. Reading
  positions, source-bound records, original files and full application recovery
  still require coordinated database/artifact backups; Markdown is not that backup.
- GitHub Issues remain the authority for connected tasks. Portable API snapshots
  and task/comment recovery remain #247, separate from Git file history.
- Existing local revision history and pending operations are retained. Prepared
  legacy sync plans require a new preview; in-flight push-only legacy plans may
  reconcile without gaining a verified coverage badge. Legacy pulls cannot run.
- Manual selection remains required. No polling, automatic owner upload, hosted
  synchronization, graph dependency or new service is introduced.

See [the implemented backup contract](../features/app-owned-backups.md).
