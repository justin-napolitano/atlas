-- Separate replica metadata: no private research state enters note bodies.
CREATE TABLE IF NOT EXISTS research_identity(slot INTEGER PRIMARY KEY CHECK(slot=1),scope TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_state(scope TEXT PRIMARY KEY,generation TEXT NOT NULL,snapshot BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS research_pending(scope TEXT NOT NULL,operation_id TEXT NOT NULL,payload BLOB NOT NULL,receipt BLOB,PRIMARY KEY(scope,operation_id));
CREATE TABLE IF NOT EXISTS research_resolved(scope TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(scope,operation_id),FOREIGN KEY(scope,operation_id) REFERENCES research_pending(scope,operation_id));
