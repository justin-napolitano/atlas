-- Additive candidate only. Do not apply to an owner's live workspace automatically.
CREATE TABLE IF NOT EXISTS federation_schema_version (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 version INTEGER NOT NULL CHECK(version=1)
);
INSERT INTO federation_schema_version(singleton,version) VALUES(1,1)
 ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS federation_brains (
 organization_id TEXT NOT NULL,
 brain_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revoked INTEGER NOT NULL CHECK(revoked IN (0,1)),
 membership_epoch INTEGER NOT NULL CHECK(membership_epoch BETWEEN 1 AND 9007199254740991),
 access_generation INTEGER NOT NULL CHECK(access_generation>=0),
 cursor_version INTEGER NOT NULL CHECK(cursor_version>=0),
 cursor TEXT NOT NULL CHECK(length(CAST(cursor AS BLOB))<=8192),
 PRIMARY KEY(organization_id,brain_id,user_id)
);
CREATE TABLE IF NOT EXISTS federation_outbox (
 enqueue_order INTEGER PRIMARY KEY AUTOINCREMENT,
 organization_id TEXT NOT NULL,
 brain_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 operation_json BLOB NOT NULL,
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 status TEXT NOT NULL CHECK(status IN ('pending','in_flight','accepted','conflict','suspended','resolved')),
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 0 AND 9007199254740991),
 receipt_json BLOB,
 resolution_operation_id TEXT,
 error_code TEXT NOT NULL CHECK(error_code IN ('','transport_uncertain','access_denied','authentication_required')),
 UNIQUE(organization_id,brain_id,user_id,operation_id),
 FOREIGN KEY(organization_id,brain_id,user_id)
  REFERENCES federation_brains(organization_id,brain_id,user_id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,brain_id,user_id,resolution_operation_id)
  REFERENCES federation_outbox(organization_id,brain_id,user_id,operation_id) ON DELETE RESTRICT,
 CHECK((status IN ('accepted','conflict','resolved') AND receipt_json IS NOT NULL)
    OR (status IN ('pending','in_flight','suspended') AND receipt_json IS NULL)),
 CHECK((status='resolved' AND resolution_operation_id IS NOT NULL)
    OR (status<>'resolved' AND resolution_operation_id IS NULL))
);
CREATE INDEX IF NOT EXISTS federation_outbox_ready
 ON federation_outbox(organization_id,brain_id,user_id,status,enqueue_order);
CREATE TRIGGER IF NOT EXISTS federation_outbox_operation_immutable
 BEFORE UPDATE ON federation_outbox
 WHEN OLD.operation_json<>NEW.operation_json OR OLD.request_sha256<>NEW.request_sha256
   OR OLD.organization_id<>NEW.organization_id OR OLD.brain_id<>NEW.brain_id
   OR OLD.user_id<>NEW.user_id OR OLD.operation_id<>NEW.operation_id
 BEGIN SELECT RAISE(ABORT,'federation operation identity and content are immutable'); END;
