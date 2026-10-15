# Runtime SQL permissions

This is a post-migration grant step for a **dedicated research database**, not a cloud provisioning command. The two runtime login roles must already exist. The publisher is an authenticated build-time snapshot reader; the anonymous immutable public site receives no database credentials. No cloud resources or IAM users have been created by this change.

The owner API can read the existing private research tables and use the precise insert/update columns needed by the current project, record, reading-state, excerpt, and annotation stores. Defaults keep new records pending. It cannot set review state, origin, graph authority, or the imported excerpt's review scope, write revision-history tables, delete/truncate records, mutate immutable excerpts, create persistent tables, grant access, or publish snapshots. History triggers retain their migration-owner authority and write history after successful saves. These grants intentionally provide no editorial approval operation; that requires a separate, reviewed workflow.

The publisher receives only `USAGE` on `research_public` and `SELECT` on `research_public.snapshots`. It cannot use the private schema or change publication rows. Approval and snapshot generation are still separate roadmap work. Future tables and columns acquire no automatic runtime grants; extend this policy and its negative tests deliberately.

## Operator sequence

1. Create the dedicated database and separate migration, owner-API, and publisher IAM SQL logins using the reviewed infrastructure plan. Determine the actual PostgreSQL login names, which differ from full service account email addresses. No service account keys or database passwords are generated here.
2. As an operator, give the migration identity the ability to create its own schemas in that database. Run the existing migrations as that identity, so it owns both schemas, tables, and history functions. Ownership transfer from an earlier administrator migration is a separate operator decision; this tool never takes ownership. Keep the migration identity out of runtime deployments.
3. Connect as that schema owner using a trusted Cloud SQL Auth Proxy/connector and the required IAM authentication/TLS configuration. Set `RESEARCH_BOOTSTRAP_DATABASE_URL` privately in the operator environment. Preview first:

   ```sh
   uv run python scripts/configure_sql_permissions.py \
     --owner-role 'actual-owner-sql-login' \
     --publisher-role 'actual-publisher-sql-login'
   ```

4. Inspect the quoted grants, then repeat with `--apply`. The command applies and checks both roles in one transaction; errors roll back all of its grants. Repeating it is safe. Preview performs catalog reads and a transaction advisory lock, without changing grants or application data. Output includes role names and SQL grants, never the connection URL or research content.
5. Configure the owner service with the owner identity and the future snapshot build with the publisher identity. Never use the migration/operator credentials in either runtime. Check effective permissions again after migrations or external IAM changes.

The preflight refuses missing/elevated logins, memberships, database or schema creation powers, object ownership, grant options, unexpected table/column privileges, and executable application functions. It does not silently revoke existing access or create missing roles. A fresh IAM login that inherits a Cloud SQL system membership may be refused: inspect the live role topology and add a narrowly verified compatibility policy before deployment. Local PostgreSQL CI does not establish Cloud SQL IAM compatibility.

This checker covers persistent objects and application functions in this dedicated database, not the entire PostgreSQL cluster, every system function, foreign connection, extension, or cloud IAM permission. PostgreSQL's ordinary `PUBLIC` access to the `public` schema and database temporary objects is retained; `CREATE` on the persistent `public` schema is refused. Do not run this against a shared application database. Concurrent privileged DDL/GRANT operations must be excluded during bootstrap; the advisory lock coordinates this tool only. The existing owner API remains the authentication and application-policy boundary, including canonical RDF edit guards and actor attribution; SQL column grants do not independently implement every application rule.

## Verification

The PostgreSQL 17/18 CI matrix creates disposable login roles in an isolated trust-authenticated service. Tests connect **as those roles**, save records and revisions, reading status/notes, immutable excerpts and anchored annotations using the existing stores, and verify history triggers succeed without granting history writes. Negative tests attempt review promotion, graph-authority changes, history changes, publication writes, persistent DDL, private reads as publisher, and grant/membership drift. Preview and repeat application are exercised. These synthetic trust logins never substitute for a live IAM login test.

Live release gates still include the GCP project and owner identity, migration-role ownership/bootstrap, Cloud SQL IAM membership compatibility, connection budgets, the publisher/export/deployment workflow, and restore/rollback verification. This slice closes none of those gates by itself.
