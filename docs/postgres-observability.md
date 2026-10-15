# PostgreSQL compatibility and private logging checks

The contract workflow runs all migrations, API/private-public boundaries, notes/Obsidian transfers, source anchors, and search tests against pinned PostgreSQL 17 and 18 images. PostgreSQL 18 is the proposed new Cloud SQL instance version; this test does not upgrade any existing database or establish live Cloud SQL compatibility.

`config/postgres-observability.json` separates native server settings from Cloud SQL-specific audit flags. Infrastructure must match this file; native CI configures only settings supported by ordinary PostgreSQL. The policy keeps operational connection/checkpoint/duration signals, DDL statement logging, terse errors, and disabled normal/error bind-parameter logging. Routine data/read and slow-statement logs remain off. The separate Cloud SQL policy enables DDL/role auditing, disables audit parameters, and masks audit literals.

The [PostgreSQL logging documentation](https://www.postgresql.org/docs/current/runtime-config-logging.html) explains why parameter settings and error verbosity matter. SQL text and primary error messages can still contain literal values; the policy is not universal log sanitization. Application SQL remains parameterized, no arbitrary-SQL endpoint is exposed, and runtime identities must not get schema/admin powers. Privileged operators must keep private literals out of manual DDL and inspect any added error paths.

CI verification has three explicit phases:

1. Configure native flags with `ALTER SYSTEM` and verify observed server settings after reload.
2. Perform a bound private write/read, a constraint failure, and a query timeout using a fresh synthetic marker. Emit a separate public sentinel proving logging is active.
3. Capture actual container logs and require the sentinel and both error paths while rejecting any occurrence of the private marker. Empty/incomplete captures cannot pass. Only counts/booleans are printed; database log contents are not uploaded as artifacts.

The probe refuses remote/non-test targets, requires the isolated CI opt-in, and only accepts a local `research_test` database under the synthetic postgres test user. It is not an operator command for configuring production. Marker/log files live under ignored `research-library/testing/`.

Cloud SQL's [audit setup](https://docs.cloud.google.com/sql/docs/postgres/pg-audit) additionally needs the extension installed by a privileged operator and deployed verification of literal masking and audit output. Native containers cannot prove that service-specific behavior. Terraform mock assertions prove configured values only. Before release, verify Cloud SQL flags, actual log redaction, private networking/IAM, least-privilege SQL roles, capacity, restore, and both signed-in and anonymous workflows in the chosen project.
