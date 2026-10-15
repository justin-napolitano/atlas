# Public image and reviewable Cloud Run configuration

This extends the [isolated site build](public-site-build.md) with a verified image
context, synthetic container CI and optional Cloud Run resources. Nothing here
pushes an image, obtains cloud credentials, provisions resources or completes the
#42 launch. The parent #30 scope and verse/concept/article acceptance remain intact.

## Prepare a context without Docker

After building a verified public-only artifact:

```sh
uv run --no-sync python scripts/prepare_public_container.py prepare --artifact /path/to/exact/build-directory
uv run --no-sync python scripts/prepare_public_container.py verify --path /path/to/exact/context-directory
```

`--path` defaults to git-ignored `research-library/public-container-contexts` for
preparation; verification takes the exact immutable context directory. The
assembler accepts only an independently verified artifact and the checked-in
container policy. It copies no repository tree, `.git`, credentials, owner pages,
source maps or old releases. The context contains fixed Docker instructions,
positive `.dockerignore` rules, one read-only `artifact/` directory and a context
manifest. Its file inventory/hashes and instructions are checked again independently.
Unknown files or rewritten Docker instructions fail even with recomputed hashes.
The output cannot be placed inside its artifact input.

`config/public-container.json` pins the Linux/amd64 official Node 24 Alpine image
by its architecture-specific manifest digest and pins the Trivy release archive
by SHA-256. These values were inspected from the [official image metadata](https://hub.docker.com/v2/namespaces/library/repositories/node/tags/24-alpine)
and [Trivy release](https://github.com/aquasecurity/trivy/releases/tag/v0.76.0),
not resolved dynamically during a build. Changing a pin requires source review
and a fresh image scan. No floating base-image resolution or automatic policy
exception is introduced.

The image removes unused npm/Yarn tooling, preserves the OS package inventory for
vulnerability scanning, copies root-owned read-only application files, sets numeric
UID/GID 1000 and starts Node directly. It contains the approved data and existing
third-party notices. The runtime still has no database client, authoring API or
storage credential. A Docker healthcheck is included; Cloud Run uses its separately
declared HTTP probes rather than relying on that image healthcheck.

## Synthetic Linux container verification

`.github/workflows/public-container-validation.yml` runs on an isolated Linux
runner with read-only repository permission and no cloud credentials. Its script
refuses container execution outside the explicit Linux GitHub CI environment, so
it cannot start Docker on the older Mac. Local Python context tests require no
Docker or scanner download.

The workflow builds a synthetic approved release and actual frontend/context,
builds the image by pinned digest, and verifies:

- Linux/amd64, Node 24, numeric user/group, direct entrypoint, expected build label
  and absence of credential environment entries.
- Execution with a read-only root filesystem, all capabilities dropped,
  no-new-privileges, bounded PID/memory/CPU, and no mounted directories/socket.
- Failure of writes to application and temporary paths, absence of unused package
  managers, owner pages and the legacy graph.
- Actual HTTP availability and Chrome source/project/record navigation, CSP,
  citations/review limits and dark/mobile behavior inside the running image.
- An internal Docker network with no outbound route. The runner reaches the
  owned container's private bridge address; it does not publish an external port.

The first harness version expected published ports on an internal network and
failed. It now uses the inspected address of its own named test container. Browser
support for that private origin is confined to the guarded CI helper, not any
production authentication or API code.

Trivy runs on the runner against a saved archive of that exact image, without a
Docker socket mount. The archive checksum is not a registry deployment digest.
The scan must identify the tested image ID, expected OS and report schema. It uses
the current official vulnerability database, includes High/Critical findings even
when unfixed, refuses end-of-life OS and supplies no ignore file, VEX override or
finding suppression. Database/download/scan errors fail the job. A clean scan is
time/coverage-dependent evidence, not a guarantee of no vulnerabilities.

The same JSON scan is converted to a CycloneDX SBOM using [Trivy's report conversion](https://trivy.dev/docs/latest/configuration/reporting/).
The workflow retains synthetic scan/SBOM/summary evidence for 14 days; it uploads
neither the image archive nor private database logs. Containers/networks and the
test image are removed afterward. Bounded tool diagnostics are allowed only in
this synthetic, credential-free harness with a fresh empty Docker config. The
application's production errors/logs retain their existing redaction boundary.

The combined release gate now requires the container workflow as well as database,
frontend, infrastructure and graph checks. A missing, skipped, cancelled or failed
component cannot pass source verification. No passing check claims deployment or
launch completion.

## Optional Cloud Run service: disabled by default

`infra/gcp/public.tf` adds resources only when `public_release` is supplied. A null
default creates no service, anonymous invoker binding, extra service agent or key
grant. The existing foundation still needs actual private project/billing/state
configuration and an inspected complete plan before any billable apply.

The release input requires the dedicated regional repository's `/public@sha256:…`
image reference and complete verified build/release IDs. Mutable tags, a different
repository path and owner-api images are refused. These syntax checks do not prove
an image was scanned, approved or is current; the future publisher/deploy preflight
must bind the real registry digest to actual build/scan/source-head evidence.

The service uses the dedicated `reader` service account, request-based CPU,
scale-to-zero, initial maximum one instance, 1 CPU/256 MiB, concurrency 16, a
30-second request timeout and startup/liveness routes. It has no VPC connector,
SQL mount, secret volume or application environment injection. The runtime IAM
check stays enabled. Candidate services remain authenticated by default; setting
`anonymous = true` adds only `roles/run.invoker` for `allUsers` on this public
service, as required by the read-only product design. It does not grant access to
owner services, SQL, secrets or storage. Actual IAM inherited outside this module
must still be audited before release.

Image encryption uses the existing image key. Only the Google-managed Cloud Run
control-plane service agent gets the additional key-use binding; the runtime
reader receives no KMS or database grant. This is separate from the existing
Artifact Registry service-agent grant. Live agent creation, propagation, regional
availability, key policy and real service readiness remain unverified.

The service listens on the image's `PORT` and uses a dedicated identity, following
the official [container settings](https://docs.cloud.google.com/run/docs/configuring/services/containers)
and [service identity](https://docs.cloud.google.com/run/docs/configuring/services/service-identity)
contracts. Cloud Run terminates HTTPS upstream. Docker's local read-only/capability/
PID flags are not exposed as equivalent controls by this Terraform service schema;
do not claim the CI sandbox is an identical Cloud Run security configuration.
The image's non-root user and root-owned application files remain in effect.

Maximum instances and budget alerts are not a hard spending cap. Complete a real
[Cloud Run pricing](https://cloud.google.com/run/pricing) calculation for requests,
active/startup CPU, memory, logs, registry/images, KMS and egress; do not assume free
allowances or credits. Review runtime capacity and costs against measurements.
The existing PostgreSQL foundation estimates are separate from the public runtime.

## Infrastructure security evidence

The pinned Checkov 3.3.29 `CKV_GCP_102` covers v1 Cloud Run IAM resources, not v2.
`infra/checks/public_runtime.py` adds v2 checks for IAM bypass, authoring credential/
mount injection, the initial bounded runtime profile and scoped anonymous binding.
It does not waive a finding or replace the source-image, IAM or scholarly review.
Terraform mock contracts separately bind the reader identity, encryption, digest,
default-disabled and explicit-visibility behavior.

CI requires JSON evidence that the extra rule actually executed on both required
v2 resources, with zero failed/skipped checks. A unit test of a rule or a green
scanner exit alone is insufficient. Source-only Terraform policy evidence is
retained for inspection; no credentialed cloud plan or state is uploaded.

## Remaining rollout and research gates

Before live use: review the generated security-sensitive image/runtime/IAM code;
configure real project, private Terraform state, sole-owner identity and bounded
deployment credentials; inspect the full credentialed plan and cost worksheet;
push the verified image through a scoped build identity; resolve its registry
digest; recheck approved heads; deploy and verify the private candidate before
enabling anonymous access. No service-account keys or broad deploy-admin grants
are created here.

Scheduling, deployment freshness fencing, withdrawal/cache invalidation and rollback
must still be implemented and demonstrated. An old image can contain research that
has since been withdrawn; availability of a retained digest is not permission to
republish it. Runtime logging tests do not prove Google-managed request-log behavior.
Live restore, failed-deploy fallback, costs/capacity, cross-device authoring and the
complete Q 4:59 verse/concept/article workflow remain #42 requirements.

Human security/AppSec review remains required before release; there is no approval
or exception record implied by CI. The [platform](platform-threat-model.md) and
[publication](publication-threat-model.md) threat models still apply. This slice
reduces image contamination, mutable-image selection and accidental privilege
sharing; it does not claim full production readiness or scholarly verification.
