package federation

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceUpgradeSnapshotsLegacyReplicaAndPreservesFrozenOperationBytes(t *testing.T) {
	ctx := context.Background()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "legacy.sqlite")
	if err = os.WriteFile(path, nil, 0600); err != nil {
		t.Fatal(err)
	}
	id := ReplicaIdentity{OrganizationID: org, UserID: user, DeviceID: device, Origin: "https://synthetic.invalid"}
	db, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(SQLiteSchema); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(replicaSchema); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO replica_identity VALUES(1,?,?,?,?)", string(org), string(user), string(device), id.Origin); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	r, err := OpenReplica(ctx, path, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if err = r.WorkspaceReady(ctx); !errors.Is(err, ErrWorkspaceUpgrade) {
		t.Fatal("legacy replica silently upgraded", err)
	}
	e := r.Engine(nil)
	if err = e.Enable(ctx, r.key(brain), 1); err != nil {
		t.Fatal(err)
	}
	op := operation(op1, 0, "Frozen before workspace upgrade 日本語\r\n")
	if _, err = r.Edit(ctx, e, op); err != nil {
		t.Fatal(err)
	}
	var before []byte
	if err = r.db.QueryRow("SELECT operation_json FROM federation_outbox WHERE operation_id=?", string(op1)).Scan(&before); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(dir, "verified-v1-snapshot.sqlite")
	if err = r.UpgradeWorkspace(ctx, backup); err != nil {
		t.Fatal(err)
	}
	if err = r.WorkspaceReady(ctx); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err = r.db.QueryRow("SELECT operation_json FROM federation_outbox WHERE operation_id=?", string(op1)).Scan(&after); err != nil || string(before) != string(after) {
		t.Fatal("upgrade changed frozen writing", err)
	}
	snapshot, err := OpenReplica(ctx, backup, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Close()
	if err = snapshot.WorkspaceReady(ctx); !errors.Is(err, ErrWorkspaceUpgrade) {
		t.Fatal("rollback snapshot not original schema", err)
	}
	entry, err := snapshot.Engine(nil).Entry(ctx, snapshot.key(brain), op1)
	if err != nil || entry.Operation != op {
		t.Fatal("snapshot lost original operation", err)
	}
}
