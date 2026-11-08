# Explicit research synchronization (Atlas #3)

Research sync is separate from note sync and the existing reader. The host must
explicitly select an authenticated account, organization and brain and enable the
research feature. No owner database, note body, source file, account, or existing
reader progress is migrated automatically. Source content is uploaded only through
an explicit user selection. All fixtures in this implementation are synthetic.

The canonical Go wire contract is `contracts/research/v1/types.go`; MU mirrors it
in `internal/researchsync/types.go`. The joint acceptance fixture compares these
files byte-for-byte after the package declaration substitution. Both implementations
share the same validation and JSON fields. There is no separate research identity:
MU derives the actor exclusively from its injected verified authenticator and
rechecks current brain membership inside PostgreSQL transactions.

* `GET /v1/organizations/{org}/brains/{brain}/research/state` returns organization,
  brain, user, generation, visible records and their count, including tombstones.
* `POST .../research/operations` accepts an operation UUID, generation UUID, base
  revision and typed record. Replies are immutable accepted/conflict receipts,
  bound to that operation, actor, scope and generation. Reusing an operation UUID
  with different content is rejected. A generation mismatch requires an explicit
  fresh snapshot and a reviewed new operation; pending content is retained.

Records are collections, immutable source/document versions, collection memberships,
exact selector annotations and personal reading progress. Collections, sources and
memberships are shared within the selected brain and require write capability.
Other brain writers can edit shared collections/memberships using CAS. Source
content, title, hash and document version are immutable; only a tombstone can
change. A new edition uses a new source ID and document-version UUID. Source
content is an explicitly uploaded UTF-8 text excerpt, at most 262144 bytes; there
is no implicit binary/PDF ingestion, remote URL retrieval, or full-library upload.

Annotations default to private and require an exact source ID, document version,
SHA-256 and selector. Sharing is explicit at creation, and visibility is fixed
thereafter. To publish a private annotation, deliberately create a separate shared
annotation. Shared annotations can be edited by brain writers; private annotations
can be read/changed only by their author. Selectors use Unicode code-point offsets,
with exact quote/prefix/suffix checks against immutable document text. Reading
progress is always private and independently keyed by actor/source/version. Reuse
the existing record ID when changing progress or collection membership, including
resurrection after tombstoning. Deleting a source retains its immutable history
and dependent records; it does not cascade away personal writing.

`researchsync.Open(path)` creates a dedicated 0600 SQLite sidecar. It rejects
unrelated existing files/databases, symlinks and permissive files. Its identity is
bound to the configured server origin, organization, brain and user; it cannot be
reused across identities. The caller supplies an HTTP client whose credentials
come from the trusted account/session provider. The research client accepts only
HTTPS or loopback HTTP, rejects redirects, validates bound acknowledgements, and
never accepts authentication or arbitrary server URLs from operation JSON.

`Client.Queue` durably stores an immutable operation before network traffic;
`Send` persists its receipt; `Refresh` replaces only the verified remote snapshot.
`Cached` and `Pending` recover state after restart. Pending operations include
uncertain writes and conflicts for explicit review; accepted receipts remain
available for replay. A conflict never silently replaces local content, and there
is no CRDT merge. A new explicit operation with a new UUID/base revision resolves
a reviewed edit. Snapshot budgets are 1000 visible records and 3MiB serialized
SQL JSON; requests are limited to 512KiB and responses to 4MiB. Pending review is
bounded at 100 entries and reports overflow instead of silently dropping entries.

MU migration `0012_research_sync.sql` is additive after foundation+sync. Raw tables
are inaccessible to `muthur_api`; only scoped security-definer functions are
callable. Brain locks serialize revocation and writes. Deferred constraint triggers
recheck current capability at COMMIT for both read snapshots/counts and operation
receipts, including time-based grant expiry. The repository returns data only
after COMMIT succeeds. Research records and receipts never change shared note
bodies or source connector ownership. Runtime mounting remains host-owned and
feature gated. Disable the feature to roll back application exposure; retain the
additive tables and SQLite sidecars for reviewed recovery rather than deleting
research history. Never point acceptance tests at an owner database.

## Verification

Personal isolated SQLite checks:

```sh
go test ./internal/researchsync ./contracts/research/v1
```

The MU test creates/removes its own PostgreSQL container, installs only synthetic
fixtures, serves real HTTP, and launches the personal Go/SQLite acceptance test.
`ATLAS_RESEARCH_TEST_DIR` must select the reviewed Atlas checkout; no existing
PostgreSQL URL is accepted.

```sh
MUTHUR_RUN_RESEARCH_TEST=1 ATLAS_RESEARCH_TEST_DIR=/path/to/atlas \
  go test ./internal/researchsync -run TestPostgresResearchHTTP -count=1 -v
```

The joint test covers two independent users, private counts/annotations/progress,
shared collection edits, membership tombstones, exact Unicode selectors, source
immutability, stale versions, replay/conflicts, SQLite restart recovery, actor-header
denial, revocation, generation rotation and expiry during read/write COMMIT.
Native desktop acceptance, owner-data migration, broad dataset pagination and
production identity deployment are separate work; this test does not claim them.
