# ADR 0003: immutable public builds and isolated publication reads

- Status: selected delivery design; live implementation and release gates pending
- Date: 2026-10-15
- Refines ADR 0002 and issues #31/#41; preserves one human owner and explicit publication

The public viewer will serve a release image containing only approved public snapshots and static frontend assets. A scheduled publisher reads approved projections, validates/exports them, and builds an immutable release. The anonymous runtime has no database login, private-document access, or storage credentials. A failed export/build/deploy leaves the previous successful release available. Rollback selects a retained image digest; withdrawal requires a replacement build and cache handling.

PostgreSQL remains authoritative for private authoring and approved publication snapshots. The existing read-only projection adapter can supply the publisher through a dedicated SQL identity with only public-schema SELECT. The builder must not query private schemas or publish arbitrary owner records. Publication requires owner-approved snapshots or a previously approved bibliography-only discovery policy. Agent notes and private excerpts are not default inputs. SQL grants, allowlisted projection, owner approval, atomic build selection, rollback, and withdrawal tests remain prerequisites.

This replaces the foundation's proposed publication-object bucket. No cloud resources were provisioned, so this change deletes no live publications. Public delivery has one versioned release artifact and remains available independently of authoring-database outages. Artifact Registry stores images with immutable tags and a regional customer-managed image key. Retain old key versions while retained images need them. A private Terraform state backend remains a separate prerequisite.

The owner service still requires verified IAP identity, stable owner subject, private SQL connectivity, and restrictive SQL grants. Its frontend/API share an HTTPS origin. The publisher gets a separate IAM SQL login; anonymous reader/worker get none. Build/deploy permissions and CI federation will be scoped with actual runtime resources, not broad project administration now.

The proposed new database is PostgreSQL 18, the current [Cloud SQL default](https://docs.cloud.google.com/sql/docs/postgres/db-versions). Application contracts must pass against 17 and 18 before provisioning. This is a new-instance plan, not a live database upgrade. Require [trusted client certificates](https://docs.cloud.google.com/sql/docs/postgres/configure-ssl-instance) through an IAM-aware Auth Proxy/connector over private IP; client private keys do not enter Terraform state.

Operational logging excludes routine DML/read statements and bind values. DDL/role auditing, masked audit literals, terse errors, and parameter redaction are planned. Native error statements can still reveal literal SQL or primary error messages, so application queries remain parameterized and runtime roles cannot run arbitrary SQL/DDL. CI must inspect native PostgreSQL logs using synthetic private markers. Cloud SQL-specific masking and extension installation require deployed verification.

Mock plans and local/browser CI do not prove a hosted release. Remaining gates include project/billing/region selection, OAuth/IAP setup, scoped runtime/publisher deployment, SQL bootstrap, measured costs/capacity, live privacy checks, cross-device editing, restore, rollback, and withdrawal. This ADR does not authorize billable provisioning.
