package federation

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func realReplica(t *testing.T, origins ...string) (*Replica, string, ReplicaIdentity) {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Chmod(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "replica.sqlite")
	identity := ReplicaIdentity{OrganizationID: org, UserID: user, DeviceID: device, Origin: "https://synthetic.invalid"}
	if len(origins) > 0 {
		identity.Origin = origins[0]
	}
	r, err := OpenReplica(context.Background(), path, identity, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r, path, identity
}

func TestReplicaAtomicEditRollbackAndDurableRestart(t *testing.T) {
	ctx := context.Background()
	r, path, identity := realReplica(t)
	var sqliteVersion string
	if err := r.db.QueryRow("SELECT sqlite_version()").Scan(&sqliteVersion); err != nil {
		t.Fatal(err)
	}
	t.Log("native SQLite version:", sqliteVersion)
	e := r.Engine(nil)
	key := r.key(brain)
	if err := e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	_, err := r.db.Exec(`CREATE TRIGGER synthetic_reject_edit BEFORE INSERT ON replica_pages BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`)
	if err != nil {
		t.Fatal(err)
	}
	op := operation(op1, 0, "Exact العربية\r\n日本語 👩🏽‍💻 é\t")
	if _, err = r.Edit(ctx, e, op); err == nil {
		t.Fatal("failed page edit acknowledged")
	}
	if _, err = e.Entry(ctx, key, op1); !errors.Is(err, ErrNotFound) {
		t.Fatal("outbox escaped rolled-back page transaction", err)
	}
	if _, err = r.db.Exec(`DROP TRIGGER synthetic_reject_edit`); err != nil {
		t.Fatal(err)
	}
	if _, err = r.Edit(ctx, e, op); err != nil {
		t.Fatal(err)
	}
	if err = r.Close(); err != nil {
		t.Fatal(err)
	}
	r, err = OpenReplica(ctx, path, identity, false)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	page, err := r.Page(ctx, brain, op.PageID)
	if err != nil || page.Local != op.Payload || page.DraftOperationID != op1 {
		t.Fatal("durable draft changed", err)
	}
	entry, err := r.Engine(nil).Entry(ctx, key, op1)
	if err != nil || entry.Operation != op || entry.Status != Pending {
		t.Fatal("durable outbox changed", err)
	}
	for name, want := range map[string]string{"journal_mode": "wal", "synchronous": "2", "foreign_keys": "1"} {
		var got string
		if err = r.db.QueryRow("PRAGMA " + name).Scan(&got); err != nil || got != want {
			t.Fatal("connection durability setting", name, got, err)
		}
	}
}

func TestReplicaReceiptAndPageCommitTogetherAfterRemoteAcceptance(t *testing.T) {
	ctx := context.Background()
	r, path, identity := realReplica(t)
	key := r.key(brain)
	op := operation(op1, 0, "Preserve after remote commit")
	logical := map[v1.ID]bool{}
	calls := 0
	transport := transportFunc(func(_ context.Context, got v1.Operation) (v1.Receipt, error) {
		calls++
		logical[got.OperationID] = true
		return accepted(got), nil
	})
	e := r.Engine(transport)
	if err := e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Edit(ctx, e, op); err != nil {
		t.Fatal(err)
	}
	if _, err := r.db.Exec(`CREATE TRIGGER synthetic_reject_receipt BEFORE UPDATE ON replica_pages WHEN NEW.draft_operation_id IS NULL BEGIN SELECT RAISE(ABORT,'synthetic commit failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ProcessOne(ctx, key); err == nil {
		t.Fatal("receipt commit failure hidden")
	}
	entry, err := e.Entry(ctx, key, op1)
	if err != nil || entry.Status != InFlight || entry.Receipt != nil {
		t.Fatal("premature receipt acknowledgement", err)
	}
	if err = r.Close(); err != nil {
		t.Fatal(err)
	}
	r, err = OpenReplica(ctx, path, identity, false)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if _, err = r.db.Exec(`DROP TRIGGER synthetic_reject_receipt`); err != nil {
		t.Fatal(err)
	}
	e = r.Engine(transport)
	if _, err = e.ProcessOne(ctx, key); err != nil {
		t.Fatal(err)
	}
	page, err := r.Page(ctx, brain, op.PageID)
	if err != nil || page.DraftOperationID != "" || page.Remote == nil || page.Remote.Revision != 1 || page.Local != op.Payload {
		t.Fatal("receipt and replica diverged", err)
	}
	if calls != 2 || len(logical) != 1 {
		t.Fatal("logical write changed on retry")
	}
}

func TestReplicaHistoryDirtyRefreshAndExplicitResolution(t *testing.T) {
	ctx := context.Background()
	r, _, _ := realReplica(t)
	key := r.key(brain)
	e := r.Engine(nil)
	if err := e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	base := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: "Base\r\n", State: v1.Active}}
	put := func(s v1.Snapshot) error {
		return r.Transaction(ctx, func(tx Tx) error { raw, _ := SQLTransaction(tx); return cacheSnapshot(ctx, raw, key, page, s) })
	}
	if err := put(base); err != nil {
		t.Fatal(err)
	}
	op := operation(op1, 1, "Unsent local 日本語")
	if _, err := r.Edit(ctx, e, op); err != nil {
		t.Fatal(err)
	}
	server := base
	server.RevisionID = event
	server.Revision = 2
	server.Content.Body = "Remote edit"
	if err := put(server); err != nil {
		t.Fatal(err)
	}
	local, err := r.Page(ctx, brain, page)
	if err != nil || local.Local != op.Payload || local.Base == nil || *local.Base != base || local.Remote == nil || *local.Remote != server {
		t.Fatal("refresh overwrote local/base", err)
	}
	if _, err = r.Edit(ctx, e, operation(op2, 2, "Blind second edit")); !errors.Is(err, ErrDraftPending) {
		t.Fatal(err)
	}
	e.Transport = transportFunc(func(_ context.Context, got v1.Operation) (v1.Receipt, error) {
		receipt := conflictReceipt(got)
		receipt.Conflict.Base = &base
		receipt.Conflict.Server = &server
		return receipt, nil
	})
	if _, err = e.ProcessOne(ctx, key); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	merged := operation(op2, 2, "Explicit merged writing")
	if _, err = r.Resolve(ctx, e, op1, merged); err != nil {
		t.Fatal(err)
	}
	old, err := e.Entry(ctx, key, op1)
	if err != nil || old.Status != Resolved || old.Receipt.Conflict.Local != op.Payload {
		t.Fatal("resolution lost evidence", err)
	}
	local, err = r.Page(ctx, brain, page)
	if err != nil || local.Local != merged.Payload || local.Base == nil || *local.Base != server {
		t.Fatal("resolution replica mismatch", err)
	}
	if err := put(base); err != nil {
		t.Fatal(err)
	}
	wrong := server
	wrong.Content.Body = "Revision identity changed"
	if err := put(wrong); !errors.Is(err, ErrInvalidReceipt) {
		t.Fatal("same revision changed", err)
	}
}

func TestReplicaAccountIsolationAndUnrelatedFilesUntouched(t *testing.T) {
	ctx := context.Background()
	r, path, identity := realReplica(t)
	other := identity
	other.UserID = device
	if _, err := OpenReplica(ctx, path, other, false); !errors.Is(err, ErrAccessDenied) {
		t.Fatal("wrong account opened", err)
	}
	if err := r.Engine(nil).Enable(ctx, Key{org, brain, device}, 1); !errors.Is(err, ErrAccessDenied) {
		t.Fatal("store account boundary bypassed", err)
	}
	if _, err := OpenReplica(ctx, path, identity, true); err == nil {
		t.Fatal("create replaced existing replica")
	}
	unrelated := filepath.Join(filepath.Dir(path), "unrelated.sqlite")
	before := []byte("synthetic unrelated file\n")
	if err := os.WriteFile(unrelated, before, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenReplica(ctx, unrelated, identity, false); err == nil {
		t.Fatal("unrelated file opened")
	}
	after, err := os.ReadFile(unrelated)
	if err != nil || string(before) != string(after) {
		t.Fatal("unrelated file changed", err)
	}
}

func TestReplicaVerifiedSnapshotPreviewAndRollbackToNewFile(t *testing.T) {
	ctx := context.Background()
	r, path, id := realReplica(t)
	e := r.Engine(nil)
	key := r.key(brain)
	if err := e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	op := operation(op1, 0, "Snapshot exact 日本語\r\n")
	if _, err := r.Edit(ctx, e, op); err != nil {
		t.Fatal(err)
	}
	preview, err := r.Preview(ctx)
	if err != nil || preview.Identity != id || preview.Pages != 1 || preview.Operations != 1 || preview.Brains != 1 {
		t.Fatal(preview, err)
	}
	snapshotPath := filepath.Join(filepath.Dir(path), "snapshot.sqlite")
	if err = r.Snapshot(ctx, snapshotPath); err != nil {
		t.Fatal(err)
	}
	if err = r.Snapshot(ctx, snapshotPath); err == nil {
		t.Fatal("snapshot overwrote existing file")
	}
	copy, err := OpenReplica(ctx, snapshotPath, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	state, err := copy.Engine(nil).State(ctx, key)
	if err != nil || state.Enabled {
		t.Fatal("restored copy enabled without selection", err)
	}
	local, err := copy.Page(ctx, brain, op.PageID)
	if err != nil || local.Local != op.Payload {
		t.Fatal("snapshot lost exact writing", err)
	}
	rollback := filepath.Join(filepath.Dir(path), "rollback.sqlite")
	if err = copy.Snapshot(ctx, rollback); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenReplica(ctx, rollback, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	entry, err := restored.Engine(nil).Entry(ctx, key, op1)
	if err != nil || entry.Operation != op {
		t.Fatal("rollback lost operation", err)
	}
	state, err = e.State(ctx, key)
	if err != nil || !state.Enabled {
		t.Fatal("snapshot changed original", err)
	}
}
