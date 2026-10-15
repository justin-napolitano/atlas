# Authenticated owner service delivery

This slice packages the existing workspace and publication UI with the real API
on one origin. It does not provision a cloud resource, publish an image, create a
Google OAuth client, or prove live sign-in/database connectivity.

## Build and verify

```sh
uv sync --frozen --extra api --extra database --extra test
npm ci --prefix web --no-audit --no-fund
uv run --no-sync python -m unittest discover -s tests -p test_owner_runtime.py -v
uv run --no-sync python scripts/build_owner_frontend.py --output research-library/owner/frontend
uv run --no-sync python scripts/prepare_owner_container.py --frontend research-library/owner/frontend --output research-library/owner/context
```

Use new output directories. The frontend has only workspace.html, publish.html
and compiled JS/CSS. Its dedicated Vite build disables publicDir and sourcemaps;
the owner image does not include the checkout, .git, private research library,
credentials, fixture datasets, node_modules or public-graph.json. Package code
and resources are copied from tracked source paths only. The generated context
contains checksums for inspection; these checksums and source-head label are not
an independent source-attestation or approval. Build a clean reviewed commit in
CI and bind the resulting image ID, scanner evidence and registry digest before
deployment. Frontend output is bounded to four megabytes and 100 files.

The multi-stage image restores API/database dependencies from uv.lock with exact
versions, archive hashes and binary-only wheels. Its Python 3.12 Alpine
linux/amd64 base is pinned by the architecture-specific manifest digest observed
from the [official Python registry](https://hub.docker.com/_/python). The first Debian12 candidate was rejected by the actual CI scanner for
unsuppressed High/Critical OS findings; the smaller Alpine candidate retains the
same complete gate with no exception or ignore. Binary-only musllinux wheel
availability and actual execution are verified by CI. No new Python runtime
dependency is introduced. It runs as UID/GID1000, with root-owned
read-only application/package files and no bytecode writes. One Uvicorn worker
uses bounded concurrency/backlog, no default request/access logging, no proxy
header trust, and ten-second graceful shutdown. Application request logs retain
existing route-template/status/release/request-ID redaction. Google-managed
request logs still require a separate privacy check before live use.

Every page and asset validates the same signed IAP JWT and exact configured owner
subject as the API. Unsigned email headers are ignored. Missing/foreign/invalid
identities receive 401/403; unavailable verification receives503. No environment
flag disables authentication. `/` redirects to `/workspace.html` after owner
verification. `/v1` and `/health` remain existing API routes; unknown API paths
cannot fall through to HTML. The public-mode API is refused by this factory.

Assets are integrity-checked and preloaded at startup. Paths are exact allowlisted
keys, never filesystem reads. Extra files, symlinks, map files and arbitrary JSON
fail startup. Responses are no-store/noindex and retain HSTS, framing, MIME and
referrer controls. Only frontend responses use a UI-specific CSP: scripts and
connections remain same-origin. Inline **styles** are allowed for the existing
React resizable-pane dimensions; inline scripts/eval are not permitted. The API's
stricter CSP remains unchanged.

`owner-container-validation.yml` builds/runs/scans only on an isolated Linux CI
runner. It verifies the production entrypoint, read-only non-root execution,
failed unauthenticated page/API reads, storage-unavailable readiness, lack of a
public snapshot API and graceful shutdown. Transport tests use real synthetic
ES256 signatures. This is not a live Google session or Cloud SQL test. The image
scan covers OS packages and detected installed Python distributions; a separate
SBOM scan covers React/react-dom/scheduler at their locked bundled versions.
Native Python, bundled native libraries and proxy-image advisory coverage require
upstream review; do not infer complete native-component coverage from a clean
OS/package scan. Scanner/download errors and unsuppressed High/Critical findings
fail the job. No ignore list or exception is introduced.

## Reviewable Cloud Run configuration

`owner_release = null` creates no owner runtime/IAP resources. The optional input
requires a dedicated `/owner@sha256:...` image, full source commit, exact verified
IAP subject, sole-owner email and exact HTTPS browser origin. It never accepts a
mutable tag or the public image path. These input checks do not attest approval,
freshness or vulnerability status. Supply private environment values outside git.

The owner service enables native IAP and retains IAM invocation checks. Only the
IAP service agent receives run.invoker. Exactly one user is declared in the
service-scoped IAP accessor binding; the backend additionally checks the signed
stable subject. Inherited project/organization IAM must still be inspected.
Google documents the native IAP setup and personal-project limitation in
[Configure IAP for Cloud Run](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run):
projects without an organization need one-time Console consent/client setup for
external Google identities; programmatic creation is not available. This is an
actual launch prerequisite, not permission to substitute an authentication bypass.

The service uses owner-api identity, direct VPC egress for private ranges, and a
separate pinned Google Cloud SQL Auth Proxy2.26.2 sidecar. The proxy binds only
127.0.0.1:5432, requests private IP and automatic IAM database authentication, and
caps connections at16. The application's local proxy leg uses sslmode=disable;
the proxy establishes Google's encrypted/authenticated connection to Cloud SQL.
No reusable DB password is stored in Terraform, environment or image. See
[Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy)
and [automatic IAM login](https://docs.cloud.google.com/sql/docs/postgres/iam-logins).
A local TCP startup probe orders container startup; actual owner readiness checks
storage. Proxy credentials and IAP verification depend on actual Google endpoints.
The existing VPC default-deny ingress and private-only SQL foundation stay intact.

The initial profile scales to zero/max one instance, concurrency8, timeout30s;
owner1CPU/512Mi and proxy1CPU/256Mi. Both use request-based CPU. Two-container CPU,
Cloud SQL, backups, registry, key operations, networking and managed logs must all
be included in the reviewed pricing worksheet. Neither max instances nor budget
alerts form a hard spending cap. No live cost claim is made here.

## Ordered launch workflow and remaining gates

1. Resolve project, billing, region, owner identity and exact HTTPS origin. Configure
   private Terraform state and short-lived deploy credentials; do not use SA keys.
2. Complete source/security/AppSec review of owner routing, CSP, image, identity,
   proxy and network changes. This document is not a review approval or exception.
3. Build and scan the clean reviewed commit. Independently review proxy/native
   runtime advisories. Bind the image ID to the pushed dedicated repository digest;
   credentials for that separately authorized push must be narrowly scoped.
4. Inspect the complete credentialed Terraform plan and current cost worksheet.
   Obtain the agreed approval before any billable apply. No apply command is run
   by these scripts/workflows. Do not enable owner_release until bootstrap below
   and personal-project OAuth setup are ready.
5. Bootstrap SQL under a separate migrator/operator identity reachable from the
   private VPC. Run the existing checksummed migrations, then preview and explicitly
   apply `scripts/configure_sql_permissions.py` for the IAM owner/publisher SQL
   role names. Migration/DDL privileges must never reach owner-api or public reader.
   Cloud SQL IAM users can inherit managed memberships: the existing strict audit
   intentionally refuses unreviewed memberships. Resolve and verify those actual
   effective privileges before launch; do not silence or bypass the audit.
6. Verify all migration hashes and required grants under real restricted IAM roles.
   The one-shot managed migrator job and its connector lifecycle are still pending;
   a continuously running proxy sidecar must not leave a Cloud Run Job hanging.
   Current infrastructure does not claim to execute migrations automatically.
7. Enable the reviewed owner release, complete native-IAP Console setup if required,
   verify only IAP can invoke, and record the exact signed subject/audience/origin.
   Never print/store full assertions or private research in diagnostics.
8. Exercise actual Google owner sign-in from two browsers/devices: source intake,
   passage capture, inline notes, CAS conflict recovery, reading position and
   publication decisions. Verify another Google identity and anonymous direct
   origin requests are denied. Test logout/session revocation and unavailable
   key/SQL endpoints. Inspect effective inherited IAM and managed request logs.
9. Verify restore to an isolated DB, an unsuccessful deployment fallback and schema
   compatibility before rollback. An older image must understand current immutable
   migrations; do not reverse/drop migrations to make it start. A successful
   source CI run does not prove recovery or live launch.

The anonymous public service remains a separately built credential-free immutable
artifact. Owner notes and passages never become public through this delivery path.
Publication/build freshness fencing, withdrawal propagation and daily deployment
scheduling remain explicit separate launch work.
