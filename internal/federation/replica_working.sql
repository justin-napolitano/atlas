-- MU-10 workspace v2, allocated by the coordinator. New replicas or explicit
-- verified-snapshot-before-upgrade only; immutable wire operations stay unchanged.
ALTER TABLE replica_schema_version RENAME TO replica_schema_version_v1;
CREATE TABLE replica_schema_version(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version=2));
INSERT INTO replica_schema_version VALUES(1,2);
DROP TABLE replica_schema_version_v1;
CREATE TABLE replica_working_pages (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,page_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),synced_version INTEGER NOT NULL DEFAULT 0 CHECK(synced_version>=0 AND synced_version<=version),
 content_json BLOB NOT NULL,base_json BLOB,generation_id TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(organization_id,brain_id,user_id,page_id),
 FOREIGN KEY(organization_id,brain_id,user_id,page_id) REFERENCES replica_pages(organization_id,brain_id,user_id,page_id)
);
CREATE TABLE replica_working_edits (
 edit_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,page_id TEXT NOT NULL,
 expected_version INTEGER NOT NULL,version INTEGER NOT NULL,content_json BLOB NOT NULL,base_json BLOB,generation_id TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(organization_id,brain_id,user_id,page_id) REFERENCES replica_pages(organization_id,brain_id,user_id,page_id)
);
CREATE TRIGGER replica_working_edit_immutable BEFORE UPDATE ON replica_working_edits
 BEGIN SELECT RAISE(ABORT,'local edit intent is immutable'); END;
CREATE TABLE replica_working_operations (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,operation_id TEXT NOT NULL,page_id TEXT NOT NULL,version INTEGER NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,operation_id),
 FOREIGN KEY(organization_id,brain_id,user_id,operation_id) REFERENCES federation_outbox(organization_id,brain_id,user_id,operation_id)
);
CREATE TABLE replica_sync_state (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('bootstrap','feed')),snapshot_id TEXT NOT NULL DEFAULT '',generation_id TEXT NOT NULL DEFAULT '',cursor TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(organization_id,brain_id,user_id),FOREIGN KEY(organization_id,brain_id,user_id) REFERENCES federation_brains(organization_id,brain_id,user_id)
);
CREATE TABLE replica_selected_authority (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,can_write INTEGER NOT NULL CHECK(can_write IN (0,1)),
 PRIMARY KEY(organization_id,brain_id,user_id),FOREIGN KEY(organization_id,brain_id,user_id) REFERENCES federation_brains(organization_id,brain_id,user_id)
);
CREATE TABLE replica_bootstrap_pages (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,page_id TEXT NOT NULL,snapshot_json BLOB NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,snapshot_id,page_id)
);
CREATE TABLE replica_snapshot_archives (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,page_id TEXT NOT NULL,generation_id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot_json BLOB NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,page_id,generation_id,revision)
);
CREATE TABLE replica_operation_generations (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,operation_id TEXT NOT NULL,generation_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,operation_id),FOREIGN KEY(organization_id,brain_id,user_id,operation_id) REFERENCES federation_outbox(organization_id,brain_id,user_id,operation_id)
);
CREATE TRIGGER replica_operation_generation_immutable BEFORE UPDATE ON replica_operation_generations
 BEGIN SELECT RAISE(ABORT,'operation generation is immutable'); END;
CREATE TABLE replica_generation_blocks (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,page_id TEXT NOT NULL,old_generation_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,page_id)
);
CREATE TABLE replica_blocked_operations (
 organization_id TEXT NOT NULL,brain_id TEXT NOT NULL,user_id TEXT NOT NULL,operation_id TEXT NOT NULL,
 PRIMARY KEY(organization_id,brain_id,user_id,operation_id)
);
