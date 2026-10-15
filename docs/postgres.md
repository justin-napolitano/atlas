# PostgreSQL research store

This slice adds the private record store, immutable revision history, compare-and-swap writes, and a derived index of the existing canonical RDF. It does not deploy GCP, authenticate a browser, publish private records, or migrate curated graph authoring authority.

## Setup and migration

Use PostgreSQL 17 for the current integration target and Python 3.12 for the development environment. Cloud SQL supports PostgreSQL 17 ([version policy](https://docs.cloud.google.com/sql/docs/postgres/db-versions)). Other supported Python versions remain covered by package metadata; no existing CLI requires the database extra.

```sh
uv sync --frozen --extra graph --extra database
# Inject RESEARCH_DATABASE_URL through your local environment or managed secret configuration.
uv run --no-sync python scripts/database.py migrate
uv run --no-sync python scripts/database.py create-project islam 'Islam Research Atlas'
uv run --no-sync python scripts/database.py import-turtle islam graph/research.ttl --actor local-owner
# Inspect the dry-run counts/IDs and then explicitly apply.
uv run --no-sync python scripts/database.py import-turtle islam graph/research.ttl --actor local-owner --apply
```

The migration connection must own the target schemas and be separate from future runtime identities. Migrations use an advisory lock, one transaction, and immutable checksums. A changed/missing applied migration fails rather than being silently replayed. Release migrations must be a controlled job, not startup work on every API replica.

The import reads one bounded local Turtle file, makes no network requests, preserves exact original text and its checksum, and indexes local subject IDs and explicit triples. An identical retry is a no-op. A changed snapshot or colliding IDs requires explicit reconciliation and is rejected without replacing existing authoring data. A project's imported RDF index is protected from owner edits through the repository while `graph_authority` remains `canonical_rdf`.

Existing review strings are retained under record attributes. Imports start with pending review and do not upgrade abstract/metadata checks into full reading. That is deliberately conservative; the migration report is not a new scholarly review.

## Storage contract

| Storage | Purpose |
| --- | --- |
| `research.projects` | Workspace scope and explicit graph-authority decision |
| `research.records` | Stable-ID typed records with scoped attributes, review state, origin, revision, and tombstone |
| `research.record_revisions` | Immutable snapshots written by the database for every successful record change |
| `research.relation_types` / `relations` | Explicit full-IRI predicates, endpoints, provenance, and review state; scoped execution profiles follow separately |
| `research.personal_states` / revisions | Private reading/screening/notes, independent of source verification |
| `research.import_snapshots` | Lossless original input, checksum, counts, and import date |
| `research_public.snapshots` | Explicit publication projection, initially empty; never a view of private state |

The record-kind contract reserves distinct work/edition/passage, lexical-form/sense/definition/occurrence, and historical person/school/period records. Type-specific validators, relation endpoint policies, scholarly review, and hosted authoring migration still need their respective roadmap slices. Arbitrary JSON attributes are private storage, not permission to publish or a claim of a validated ontology.

IDs are globally stable; a canonical record currently has one owning project. Cross-project collections/sharing require explicit memberships in a later migration rather than copying an ID into another project. Do not merge a work, edition, annotation, and note merely because their labels match.

## Concurrency and identity

Clients send `expected_revision=0` for a new record or the last seen server revision for an update. A competing write produces `RevisionConflict` and the current record so the API can return a conflict response. Personal notes and record revisions persist separately; reading a source does not change its scholarly review. Read timestamps are assigned by the server and cleared when moving out of read state.

The database module is not an authentication layer. It takes an already authorized actor; never expose it directly to an unauthenticated caller. By default PUBLIC has no schema/table/function access. Separate owner/public roles and deployment/auth verification belong to the subsequent authorization slice. Public readers must never connect with the migration or owner identity. Publication tables stay empty until a deliberate allowlisted publication implementation lands.

## Verification and recovery

Set `RESEARCH_TEST_DATABASE_URL` to a disposable PostgreSQL database, then run:

```sh
uv run --no-sync python -m unittest discover -s tests -v
```

Tests create synthetic projects and retain fixture rows in that disposable database. They must not run against production. The GitHub PostgreSQL workflow supplies an ephemeral PostgreSQL 17 service; without a test URL the integration cases are explicitly skipped, not declared passed. Tests cover migration retry, import preview/idempotency, retained text, revisions, competing sessions, private progress, constraints, and absent PUBLIC privileges.

There is no destructive automatic down migration. Before deployment, snapshot/backup the database, apply and verify in an isolated instance, and retain the preceding app artifact. If a migration fails its transaction rolls back. Recover an applied change through an explicit forward fix or verified isolated restore; do not edit an applied migration checksum or delete research/history to make a deployment pass. Cloud backup restoration and portable archive reimport are tracked separately in #31/#54.
