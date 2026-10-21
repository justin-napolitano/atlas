-- Desktop-only APIs use these additive authorities; legacy intake receipts stay intact.
CREATE TABLE research.desktop_requests (
 request_uuid uuid PRIMARY KEY,
 input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL,
 changed_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE research.desktop_artifacts (
 id uuid PRIMARY KEY REFERENCES research.desktop_requests(request_uuid) DEFERRABLE INITIALLY DEFERRED,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 32768),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
 media_type text NOT NULL CHECK(media_type IN ('text/plain','text/markdown')),
 record_id text REFERENCES research.records(id),
 entry_id text REFERENCES research.notebook_entries(id),
 document_ids jsonb NOT NULL DEFAULT '[]',
 rights_basis text NOT NULL,
 changed_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((record_id IS NULL) <> (entry_id IS NULL))
);
CREATE INDEX desktop_artifacts_digest ON research.desktop_artifacts(sha256);
REVOKE ALL ON research.desktop_requests,research.desktop_artifacts FROM PUBLIC;
