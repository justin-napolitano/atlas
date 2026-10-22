CREATE TABLE research.vault_tasks (
 id uuid PRIMARY KEY,
 creation_sha256 text NOT NULL,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
 body text NOT NULL CHECK(length(body)<=20000),
 context_entry_id text REFERENCES research.notebook_entries(id),
 context_revision integer,
 context_page jsonb,
 state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 repository_id bigint,
 remote_id bigint UNIQUE,
 remote_number integer,
 remote_node_id text,
 remote_snapshot jsonb,
 write_state text NOT NULL DEFAULT 'pending' CHECK(write_state IN ('pending','uncertain','synced','conflict')),
 status_note text NOT NULL DEFAULT '',
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((context_entry_id IS NULL)=(context_revision IS NULL))
);
CREATE TABLE research.vault_task_operations (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES research.vault_tasks(id),
 input_sha256 text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('create','state')),
 payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatching','confirmed','conflict')),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.vault_issue_comments (
 repository_id bigint NOT NULL,
 issue_id bigint NOT NULL,
 comment_id bigint NOT NULL,
 snapshot jsonb NOT NULL,
 PRIMARY KEY(repository_id,issue_id,comment_id)
);
REVOKE ALL ON research.vault_tasks,research.vault_task_operations,research.vault_issue_comments FROM PUBLIC;
