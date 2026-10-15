# Hosted research trust boundaries

Status: implementation design/review record, not a completed production security review. Initial scope is one owner with private notes and explicitly published read-only research; PostgreSQL/GCP is selected by the owner. No regulated/account credentials belong in source, snapshots, telemetry, or fixtures.

## Assets and boundaries

- Browser ↔ owner API: authenticated owner edits notes/research. Public viewing is a separate mode/service without owner database credentials.
- API/migration job ↔ private PostgreSQL: managed runtime identity, encrypted connector path, bounded database access, and distinct schema/migration permissions.
- Owner/agent ↔ proposal review: machine suggestions retain source provenance and cannot publish or claim human review.
- Publisher ↔ approved SQL projections ↔ immutable image ↔ public viewer: allowlisted approved revisions only; the anonymous runtime has no database/storage identity. See ADR 0003.
- CI ↔ infrastructure/releases: pinned tools/artifacts, reviewed plans, and short-lived service-scoped federation when implemented. State/plans can contain sensitive configuration and stay private.
- Obsidian/imported documents ↔ research records: untrusted content and revision-aware validated updates, not executable agent instructions.

## Threats and control evidence

| STRIDE class / risk | Threat | Control / verification state |
| --- | --- | --- |
| Spoofing / high | An arbitrary user/header impersonates the owner or an agent | Verify issuer/audience/signature and stable owner subject server-side; no header-only trust. Pending owner-auth slice and adversarial tests; no owner API is exposed by this foundation |
| Tampering / high | Concurrent edits or stale agents replace newer research | PostgreSQL revision compare-and-swap/history in #60; browser conflict resolution and agent change-set validation still pending |
| Repudiation / medium | A proposal appears to be human-reviewed or old edits vanish | Actor, version, source provenance, immutable histories, explicit review/publication actions. Complete domain audit/role enforcement in later slices |
| Information disclosure / high | Public graph/search/counts/exports leak private notes/history | Separate schemas/public projection and dedicated publication reader; permission filtering before every query/ranking/traversal remains required in API implementation |
| Information disclosure / high | Database port, state, logs, or keys expose private data | Private IP, trusted-client TLS, no service-account keys, ignored plans/state, parameter redaction, terse errors, DDL/role-only auditing, and masked audit literals are configured. Native log tests, Cloud SQL-specific masking/extension checks, private remote state, and live connectivity remain release evidence |
| Denial of service / medium | Unbounded graph/search/jobs exhaust a small database or cloud budget | Explicit small tier/storage limit and alert budget in Terraform; bounded traversal/query, runtime max instances/pools, provider pacing and job budgets remain application requirements. Alerts do not stop spending |
| Elevation of privilege / high | Public runtime, worker, or CI gains owner/publish rights | Anonymous reader/worker get no data permissions or DB login. Publisher receives connection/login permission but must have only approved-public-schema SELECT via SQL bootstrap. Proposal scopes, image build/deploy permissions, and live negative-access tests remain gates |
| Tampering / high | Malicious source text redirects an agent or imports false scholarship | Treat content as data, preserve exact source locations, validate proposals, and require owner scholarly review/publication. No automatic claim promotion |
| Information loss / high | Failed migration or deletion destroys notes/citations | Checksummed migrations, revision logs, protected SQL deletion, backups/PITR, immutable release tags, and protected rotating image key. Retain key versions for rollback images. Isolated live restore/rollback remains mandatory and unverified |

The high residual risks above block claims of production readiness. Terraform mock plans and passing store tests establish only the tested controls. Required release evidence includes real owner/non-owner/public/worker requests, private-field/path/count checks, network/SQL-role validation, reviewed costs, private remote state, redacted telemetry, and a successful isolated restore. No email, organizational review, policy exception, or approval is represented as completed by this document.
