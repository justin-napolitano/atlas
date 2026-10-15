# GCP foundation (review before provisioning)

This module prepares private Cloud SQL PostgreSQL 18, a VPC/subnet with sampled flow logs and explicit default-deny ingress, separate service identities, a CMEK-protected immutable image repository, and budget alerts. It does **not** deploy an app, grant human sessions, publish research, or create service-account keys. Public delivery follows `docs/adr/0003-immutable-public-delivery.md`: an approved-snapshot image with no database access in the anonymous runtime.

Terraform is pinned to 1.16.6 and Google/Google-beta providers to 8.7.0. Beta generates the Artifact Registry service identity before its key grant. Commit the lockfile. Mock plans validate contracts, not live IAM, regional availability, or restore behavior.

## Inputs and execution

Use an existing GCP project and linked billing account. The checked-in `example.tfvars` contains synthetic placeholders. Store real environment configuration outside the repository, and use Application Default Credentials or an approved short-lived deployment identity; do not put credentials in variables/state or a frontend bundle.

```sh
terraform init -backend=false
terraform fmt -check -recursive
terraform validate
terraform test
# After selecting a private remote-state backend and actual environment values:
terraform init -reconfigure -backend-config=/private/path/backend.hcl
terraform plan -var-file=/private/path/research.tfvars -out=review.tfplan
```

The module intentionally has no configured backend. Add an empty `backend "gcs" {}` block in a private deployment root wrapping this module before using `-backend-config`; the development commands use local ignored state. Set up a private, versioned GCS state bucket with tightly scoped IAM first. Do not apply from an unprotected local state file or commit plan/state outputs. Planning also needs live credentials and service access; a mock test is not a live plan.

Inspect resource count, IAM, region, network ranges, costs, and the complete saved plan before a separately authorized apply. No resource has been provisioned by these files. The current initial footprint is single-zone/shared-core; it is not a high-availability service and shared-core has no Cloud SQL SLA. Review the small tier's memory capacity against measured query behavior before launch.

## Boundaries and next slices

| Identity | Foundation permission | Still required |
| --- | --- | --- |
| owner-api | Cloud SQL connector/instance login | Authenticated owner-only API and explicit SQL table grants |
| migrator | Cloud SQL connector/instance login | Controlled migration job/SQL schema ownership |
| reader | No database/storage permissions | Static runtime containing only an approved release |
| publisher | Cloud SQL connector/instance login | Public-schema SELECT only; approved export and scoped image build/deploy |
| worker | No database/storage permissions | Scoped proposal API/job permissions |

The database has no public IP or authorized public networks and requires TLS with trusted client certificates. Configure Direct VPC egress and a supported Cloud SQL connector/IAM flow. A connector does not replace reachability or SQL authorization. No runtime service exists yet, so live ingress/owner sessions remain unverified.

Cloud Run service deployment follows #33/#35: pin an immutable release image, set owner/public modes and dedicated identities, configure verified owner authentication, minimum instances zero, maximum initially one per service, bounded concurrency/pools/timeouts, health probes, and revision rollback. A worker must not gain owner-level write/publish authority. CI federation follows concrete service-level permissions; no broad deployment-admin identity is granted in this foundation.

Public builds contain approved projections only; private notes/excerpts never enter their build contexts. Failed builds retain the last successful image. Tags are immutable; a regional software KMS key rotates every 90 days with Terraform destruction protection. The Artifact Registry service agent gets image-key use; an enabled public runtime additionally grants its Google-managed Cloud Run control-plane service agent key use. The anonymous runtime account gets neither grant. Retain keys/images needed for rollback. Withdrawal and caches remain #41 work; no public runtime is deployed.

The optional `public_release` input defaults to null and adds no runtime resources. It accepts only a verified/scanned `/public@sha256:…` image in this regional repository plus build/release IDs. Anonymous visibility is false by default; an explicit true binds only this public service's invoker role to `allUsers`, keeping the IAM check enabled. See [public container delivery](../../docs/public-container-delivery.md) for the exact image context, Linux-only tests, extra v2 security checks, service limits and unverified rollout gates. The reader identity stays database-free, without VPC/SQL/secret mounts. Neither a mock plan nor a well-formed digest proves approval or source-head freshness; complete those checks before a reviewed apply.

SQL flags log connections/checkpoints/durations and DDL, with routine DML/read and slow-statement logs disabled. Normal/error bind parameters are omitted; terse errors suppress detail/context rows. pgAudit is configured for DDL/roles, parameters off, literal masking on. Native primary errors or manually executed literal SQL can still contain values: parameterized application queries and restrictive runtime roles remain required. The Cloud SQL flag does not install the extension: a privileged operator must create `pgaudit` in the research database and verify actual masking before release ([auditing](https://docs.cloud.google.com/sql/docs/postgres/pg-audit), [flags](https://docs.cloud.google.com/sql/docs/postgres/flags)). Native CI does not prove Cloud SQL audit behavior.

## Cost worksheet

Illustrative US-central1 list-price input, checked 2026-10-15, 730 hours/month, single-zone Enterprise:

| Component | Assumption | Approximate monthly USD |
| --- | --- | ---: |
| `db-f1-micro` compute | 0.0105/hour | 7.67 |
| Alternative `db-g1-small` compute | 0.035/hour | 25.55 |
| 10 GiB SSD | 0.000232877/GiB-hour | 1.70 |
| Example 1 GiB billable backup use | 0.000109589/GiB-hour | 0.08 |
| Software KMS key version | 1 retained active/disabled version | 0.06 |

KMS operations and each additional retained key version add charges; rotation does not erase old versions automatically. See [KMS pricing](https://cloud.google.com/kms/pricing). The database-only subtotal below excludes this image-key cost, runtime/build/image storage, flow logs, and actual audit volume.

The illustrative micro database subtotal is about **9.45/month**, or **27.33/month** with g1-small, under those assumptions. These are calculated estimates, not a quote or the whole platform bill. Source: [Cloud SQL pricing](https://cloud.google.com/sql/pricing). Recheck region, currency, backup/PITR bytes, and taxes before applying. Automatic SSD growth stops at 20 GiB but is not automatic capacity management; reaching the limit requires intervention.

Add actual Cloud Run request/CPU/memory/runtime, background jobs, image/object storage and versions, logging, network/egress, and optional scheduler charges. Do not assume credits/free allowances apply to this account. Complete [the pricing calculator](https://cloud.google.com/products/calculator) with the real workload and [Cloud Run prices](https://cloud.google.com/run/pricing). Direct VPC avoids a permanently running connector instance; do not add an idle connector/NAT by habit ([cost guidance](https://docs.cloud.google.com/run/docs/tips/services-cost-optimization)).

Default budget alerts are 25 USD at 50/90/100% of actual monthly spend, sent through billing's default notification configuration. Confirm recipients actually receive a test notification. Alerts are not a hard spending cap, database storage limit, or guaranteed immediate notification. The higher database tier needs a revised budget. Review gross costs separately from credits.

## Recovery and teardown

Automated backups and seven-day PITR are configured; proposed initial objectives are RPO up to 24 hours from scheduled backup (tighter only after PITR is verified) and RTO under four hours after a successful drill. These are targets, not demonstrated guarantees. Before release:

1. Create known synthetic/private test records in an isolated instance and record a restore point without printing note contents/credentials.
2. Restore or clone into a distinct test instance; never overwrite the live instance for the drill.
3. Apply the same SQL-role boundary, check migration checksums and record/history counts, and exercise a save/conflict and public/private query.
4. Record timings, checksum/count evidence, permissions, operator actions, and cleanup. Verify backup retention and notification delivery.
5. Test application rollback against the current schema; use forward migrations or isolated restore for database recovery, not edited migration checksums.

SQL deletion protection is enabled in Terraform and the API. Teardown needs a reviewed change disabling both after a verified retained backup. KMS destruction protection also requires a recovery-aware change. Google service identities/key-ring metadata can persist; API enablements are not automatically disabled on destroy. Mock validation does not prove deletion or recovery.

Security review remains required before live IAM/network/runtime rollout. See `docs/platform-threat-model.md` for the current trust-boundary assessment and explicit unverified controls.

Optional owner service resources are disabled by default; see [owner service delivery](../../docs/owner-service-delivery.md) for native IAP, private IAM SQL proxy, identity/cost review and migration prerequisites. No owner release input deploys itself.
