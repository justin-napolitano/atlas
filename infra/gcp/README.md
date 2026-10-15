# GCP foundation (review before provisioning)

This module prepares private Cloud SQL PostgreSQL 17, a VPC/subnet for later Cloud Run Direct VPC access, separate service identities, a private versioned publication bucket, an image repository, and project-scoped budget alerts. It does **not** deploy an application, grant a human editing session, publish research, or create user-managed service-account keys.

Terraform is pinned to 1.16.6 and the Google provider to 8.7.0. Commit the provider lockfile. Mock plans validate configuration contracts; they do not prove IAM access, regional availability, or a live database restore.

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
| reader | Publication-bucket object reader | Public viewer restricted to published objects |
| publisher | Publication-bucket object CRUD | Owner-authorized allowlisted publication job |
| worker | No database or bucket permissions | Scoped proposal API/job permissions |

The database has no public IP or authorized public networks and requires encrypted connections. Runtime private connectivity must be configured explicitly with Direct VPC egress and a supported Cloud SQL connector/IAM flow. A connector does not replace network reachability or SQL authorization. No runtime service exists yet, so there are no public ingress or owner-session claims to verify in this slice.

Cloud Run service deployment follows #33/#35: pin an immutable release image, set owner/public modes and dedicated identities, configure verified owner authentication, minimum instances zero, maximum initially one per service, bounded concurrency/pools/timeouts, health probes, and revision rollback. A worker must not gain owner-level write/publish authority. CI federation follows concrete service-level permissions; no broad deployment-admin identity is granted in this foundation.

The publication bucket itself prohibits anonymous access. A read-only runtime may serve selected published objects; private notes and source documents do not belong in it. Versioning retains earlier object revisions; noncurrent objects expire after 30 days. Withdrawal must account for earlier versions, caches, and access policy in #41.

## Cost worksheet

Illustrative US-central1 list-price input, checked 2026-10-15, 730 hours/month, single-zone Enterprise:

| Component | Assumption | Approximate monthly USD |
| --- | --- | ---: |
| `db-f1-micro` compute | 0.0105/hour | 7.67 |
| Alternative `db-g1-small` compute | 0.035/hour | 25.55 |
| 10 GiB SSD | 0.000232877/GiB-hour | 1.70 |
| Example 1 GiB billable backup use | 0.000109589/GiB-hour | 0.08 |

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

SQL deletion protection is enabled in both Terraform and the API. Teardown requires an explicit reviewed change disabling both protections after a verified retained backup. Bucket `force_destroy` is false. API enablements are not automatically disabled on destroy. Do not promise deletion or recovery solely from `terraform validate`.

Security review remains required before live IAM/network/runtime rollout. See `docs/platform-threat-model.md` for the current trust-boundary assessment and explicit unverified controls.
