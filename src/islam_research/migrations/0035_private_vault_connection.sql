-- Private connection metadata only. No GitHub tokens or note bodies are stored here.
CREATE TABLE research.vault_connections (
 workspace_id text PRIMARY KEY CHECK(workspace_id='owner'),
 repository text NOT NULL CHECK(length(repository) BETWEEN 3 AND 201),
 repository_id bigint NOT NULL CHECK(repository_id>0),
 account_id bigint NOT NULL CHECK(account_id>0),
 account_login text NOT NULL CHECK(length(account_login) BETWEEN 1 AND 100),
 branch text NOT NULL CHECK(length(branch) BETWEEN 1 AND 128),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 connected_by text NOT NULL CHECK(length(connected_by) BETWEEN 1 AND 500),
 connected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON research.vault_connections FROM PUBLIC;
