-- Separate replica metadata: no private research state enters note bodies.
CREATE TABLE IF NOT EXISTS research_state(scope TEXT PRIMARY KEY,generation TEXT NOT NULL,snapshot BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS research_pending(scope TEXT NOT NULL,operation_id TEXT NOT NULL,payload BLOB NOT NULL,receipt BLOB,PRIMARY KEY(scope,operation_id));
