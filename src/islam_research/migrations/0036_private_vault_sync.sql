CREATE TABLE research.vault_sync_pages (
 entry_id text PRIMARY KEY REFERENCES research.notebook_entries(id),
 base_page jsonb,
 confirmed_head text CHECK(confirmed_head IS NULL OR confirmed_head ~ '^[0-9a-f]{40}$'),
 dirty_revision integer NOT NULL CHECK(dirty_revision>0),
 confirmed_revision integer NOT NULL DEFAULT 0 CHECK(confirmed_revision>=0),
 selected_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.vault_sync_plans (
 id uuid PRIMARY KEY,
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[0-9a-f]{64}$'),
 repository_id bigint NOT NULL,
 account_id bigint NOT NULL,
 branch text NOT NULL,
 base_head text NOT NULL CHECK(base_head ~ '^[0-9a-f]{40}$'),
 payload jsonb NOT NULL CHECK(octet_length(payload::text)<=3000000),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','dispatching','confirmed','conflict')),
 commit_sha text CHECK(commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{40}$'),
 created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Enrolled local edits and their outbound intent share the note transaction.
CREATE FUNCTION research.enqueue_vault_page() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,research AS $$
BEGIN
 UPDATE vault_sync_pages SET dirty_revision=NEW.revision,updated_at=clock_timestamp() WHERE entry_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER notebook_vault_queue AFTER UPDATE ON research.notebook_entries FOR EACH ROW EXECUTE FUNCTION research.enqueue_vault_page();
REVOKE ALL ON research.vault_sync_pages,research.vault_sync_plans FROM PUBLIC;
REVOKE ALL ON FUNCTION research.enqueue_vault_page() FROM PUBLIC;
