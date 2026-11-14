-- MU-10: explicitly created separate replica files only; no owner migration.
CREATE TABLE IF NOT EXISTS replica_schema_version (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL CHECK(version=1)
);
INSERT INTO replica_schema_version VALUES(1,1) ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS replica_identity (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 organization_id TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL, origin TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS replica_identity_immutable BEFORE UPDATE ON replica_identity
 BEGIN SELECT RAISE(ABORT,'replica identity is immutable'); END;
CREATE TABLE IF NOT EXISTS replica_pages (
 organization_id TEXT NOT NULL, brain_id TEXT NOT NULL, user_id TEXT NOT NULL, page_id TEXT NOT NULL,
 local_json BLOB NOT NULL, remote_json BLOB, draft_operation_id TEXT, draft_base_json BLOB,
 PRIMARY KEY(organization_id,brain_id,user_id,page_id),
 FOREIGN KEY(organization_id,brain_id,user_id) REFERENCES federation_brains(organization_id,brain_id,user_id),
 FOREIGN KEY(organization_id,brain_id,user_id,draft_operation_id) REFERENCES federation_outbox(organization_id,brain_id,user_id,operation_id)
);
CREATE TABLE IF NOT EXISTS replica_snapshots (
 organization_id TEXT NOT NULL, brain_id TEXT NOT NULL, user_id TEXT NOT NULL, page_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), snapshot_json BLOB NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,page_id,revision),
 FOREIGN KEY(organization_id,brain_id,user_id) REFERENCES federation_brains(organization_id,brain_id,user_id)
);
CREATE TRIGGER IF NOT EXISTS replica_snapshots_immutable BEFORE UPDATE ON replica_snapshots
 BEGIN SELECT RAISE(ABORT,'replica revision history is immutable'); END;
