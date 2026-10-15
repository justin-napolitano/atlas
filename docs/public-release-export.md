# Approved public release export

This is a local artifact boundary for #41, not a deployment, publication scheduler,
backup, or completed #42 launch. The owner first approves an exact preview through
the publication workspace. This exporter reads only current approved public heads
and immutable public snapshots using the restricted publisher login. It cannot
select private notes, passages, previews, or revision history. Never use a schema
owner, migration, or owner-application login; the runtime SQL audit rejects them.

## Run from the repository checkout

Install the locked dependencies with `uv sync --frozen --extra database --extra semantic`.
Provide `RESEARCH_PUBLISHER_DATABASE_URL` using private environment injection, never
a command-line argument or a committed environment file. Apply migration 0006 as
the migrator first; the exporter does not migrate or grant itself permissions.

```sh
uv run --no-sync python scripts/export_approved_release.py export
uv run --no-sync python scripts/export_approved_release.py current
uv run --no-sync python scripts/export_approved_release.py verify --path /path/to/exact/release-directory
```

`export` and `current` use the git-ignored `research-library/public-releases` root by
default; `--path` can select another operator-owned root. `verify` takes the exact
immutable release directory, not the export root. Offline `verify`/`current` need
only the semantic extra, no database URL or driver. Export reads the checkout's
pinned `semantic/` resources; this is not yet a standalone packaged-wheel exporter.
The output summary contains a release ID, project counts and `deployed: false`.
Failures do not echo driver errors, connection strings, paths, or payload values.

## Bundle and activation contract

The root contains `current.json` and `releases/release-<sha256>/`. Each release has:

- `data/projects.json`: all active explicitly approved projects, each pointing to a
  project-ID-hashed graph filename. There is no automatic first-project selection.
- `data/graph-<sha256>.json`: the exact approved payload represented as deterministic
  UTF-8 JSON. No private attributes, personal reading state or discoveries are added.
- `data/release.json`: successful export time, active/withdrawn counts and delivery
  mode. It describes export health, never live deployment or scholarly correctness.
- `semantic/publication.ossie.json`: a fixed public-only Ossie 0.1.1 metadata model,
  logical node/edge bindings and project-scoped joins. No model SQL is executed.
- Pinned upstream schema, license documents, notice and upstream provenance. The
  private `semantic/research.ossie.json` workspace model is never an input.
- `release-manifest.json`: selected head revisions, approval-payload hashes and
  file hashes/sizes. The release ID hashes the manifest without its own ID.

The original approval digest hashes PostgreSQL's `jsonb::text` representation.
Artifact file digests hash the deterministic exported bytes, which can differ in
whitespace/order from that database representation. Both are retained explicitly;
the offline verifier checks files and contracts, not a signature or fresh database
authorization. Export establishes the raw approval digest at capture time.

Validation rejects unknown/private fields at every payload level, unknown kinds,
duplicate identities, dangling edges, unsafe source links, mismatched project and
snapshot identities, duplicate JSON keys, nonfinite numbers and unregistered files.
Limits are 100 heads, 100 nodes and 300 edges per project, 2 MB per graph and 20 MB
per release. Semantic resources must match the pinned upstream checksums. Hashes
alone are insufficient: the verifier also checks the projection, index, withdrawal,
health and exact public semantic contracts even if hashes were recomputed.

Files are staged and independently verified before an immutable directory is
installed. The final `os.replace` of `current.json` is the activation point; partial
staging and validation failures leave the current pointer intact. Written files are
flushed/fsynced; full filesystem power-loss durability is not established. The
operator must own/control output parents: symlink entries inside release storage
are refused, but this is not a defense against concurrent hostile filesystem owners.

A read-only READ COMMITTED transaction takes shared advisory lock `(184512,1)`
before querying heads and holds it through local activation. The migration adds an
exclusive statement-trigger lock for every head insert/update/delete. Thus normal
approval/withdrawal cannot commit between capture and local activation. READ
COMMITTED deliberately refreshes the head query's snapshot after waiting for the
lock; see PostgreSQL's [isolation](https://www.postgresql.org/docs/18/transaction-iso.html)
and [advisory locking](https://www.postgresql.org/docs/18/explicit-locking.html#ADVISORY-LOCKS)
contracts. Publisher table permissions remain SELECT-only. Publication writes may
briefly wait or hit their existing bounded lock timeout during an export.

Database acknowledgement and filesystem activation are separate commit points.
An I/O failure or connection failure after activation can leave a successfully
selected release despite a failed command. Exit status 3 means activation is
uncertain: inspect with `current` before retrying; do not assume failure restored
the old pointer. The exporter does not automatically roll back public visibility.

## Withdrawal, delivery and remaining gates

An explicitly withdrawn head has no graph in a new bundle. If all projects are
withdrawn, a valid empty index replaces active content. A database with no recorded
publication decisions is refused rather than silently replacing the last good
release. Older immutable release directories remain as operator-held history.

**Do not serve the export root or its history directory publicly.** A subsequent
public image builder must copy only one independently verified release's current
files and the read-only frontend, excluding owner pages and legacy graph data.
The existing public frontend still needs approved-bundle multi-project and empty
withdrawal handling. Until that integration exists, this artifact is not a runnable
public site. Build/deploy must recheck current heads after image construction;
this local lock does not guard a later remote deploy. Withdrawal must also replace
the served image and invalidate caches. Restoring an older release can republish
withdrawn content and requires fresh approval/head verification.

Remaining delivery work: isolated public image construction, source-head freshness
at deploy, registry/runtime IAM and signed build identity, measured failure and
rollback drills, cache withdrawal, scheduling, live Cloud SQL role compatibility,
and GCP deployment after review of a concrete credentialed plan. No billable cloud
resources, publication decisions or deployment credentials are created here.

## Verification and security review

Synthetic artifact tests exercise multi-project export, all-withdrawn output,
private-marker exclusion, rehashed malicious content, pinned-resource drift,
symlinks, failed writes and last-good preservation. The PostgreSQL 17/18 CI suite
uses actual restricted LOGIN roles and verifies private-table denial, head-lock
coordination, post-wait freshness, withdrawal exclusion, missing/disabled-guard
rejection and uncertain activation acknowledgement. Local runs skip real-database
tests when no isolated test DSN is configured; those skips are not database proof.

This extends the [publication threat model](publication-threat-model.md): disclosure
through overly broad export or private semantics is high impact; allowlisting,
restricted SQL and marker/forgery tests mitigate it. Stale publication after
withdrawal is high impact; the lock mitigates local capture/activation races, with
deployment/cache risk still open. Local tampering or partial writes can corrupt a
release; strict independent verification and immutable staging mitigate accidental
and rehashed contract-invalid content, but hashes are not publisher authentication.
The publisher can briefly delay publication writes; bounded locks and payloads
limit this availability risk. Required human/AppSec review of this generated data
access and public exposure boundary remains outstanding before release; no review,
exception approval, independent audit or production-readiness claim is implied.
