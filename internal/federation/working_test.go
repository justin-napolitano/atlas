package federation

import (
	"context"
	"errors"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestWorkingAutosaveWhileFrozenReceiptCannotEraseNewerWriting(t *testing.T) {
	ctx := context.Background()
	r, path, id := realReplica(t)
	e := r.Engine(nil)
	key := r.key(brain)
	if err := e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	first := v1.PageContent{Title: "Incident", Body: "Initial 日本語\r\n", State: v1.Active}
	one, err := r.SaveWorking(ctx, brain, page, op1, 0, first)
	if err != nil || one.Version != 1 {
		t.Fatal(one, err)
	}
	frozen, err := r.FreezeWorking(ctx, e, brain, page)
	if err != nil || frozen.Operation.Payload != first {
		t.Fatal(err)
	}
	newer := first
	newer.Body += "Newer العربية é"
	if _, err = r.SaveWorking(ctx, brain, page, op2, 1, newer); err != nil {
		t.Fatal(err)
	}
	e.Transport = transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) { return accepted(op), nil })
	if _, err = e.ProcessOne(ctx, key); err != nil {
		t.Fatal(err)
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil || current.Local != newer || current.Version != 2 || current.SyncedVersion != 1 || current.DraftOperationID != "" {
		t.Fatal("old receipt erased or acknowledged newer edit", current, err)
	}
	if err = r.Close(); err != nil {
		t.Fatal(err)
	}
	r, err = OpenReplica(ctx, path, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	e = r.Engine(e.Transport)
	second, err := r.FreezeWorking(ctx, e, brain, page)
	if err != nil || second.Operation.OperationID == frozen.Operation.OperationID || second.Operation.BaseRevision != 1 || second.Operation.Payload != newer {
		t.Fatal("new edit not independently frozen", err)
	}
	if _, err = e.ProcessOne(ctx, key); err != nil {
		t.Fatal(err)
	}
	current, err = r.WorkingPage(ctx, brain, page)
	if err != nil || current.Version != current.SyncedVersion || current.Local != newer {
		t.Fatal(err)
	}
}

func TestWorkingCASRetryAndDirtyRemoteBasePreserved(t *testing.T) {
	ctx := context.Background()
	r, _, _ := realReplica(t)
	e := r.Engine(nil)
	key := r.key(brain)
	if err := e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	base := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: "Base", State: v1.Active}}
	put := func(s v1.Snapshot) error {
		return r.Transaction(ctx, func(tx Tx) error { raw, _ := SQLTransaction(tx); return cacheSnapshot(ctx, raw, key, page, s) })
	}
	if err := put(base); err != nil {
		t.Fatal(err)
	}
	local := base.Content
	local.Body = "Unsent"
	if _, err := r.SaveWorking(ctx, brain, page, op1, 0, local); err != nil {
		t.Fatal(err)
	}
	if _, err := r.SaveWorking(ctx, brain, page, op1, 0, local); err != nil {
		t.Fatal("exact retry rejected", err)
	}
	if _, err := r.SaveWorking(ctx, brain, page, op2, 0, local); !errors.Is(err, ErrLocalVersion) {
		t.Fatal("stale tab overwrote writing", err)
	}
	remote := base
	remote.RevisionID = event
	remote.Revision = 2
	remote.Content.Body = "Concurrent"
	if err := put(remote); err != nil {
		t.Fatal(err)
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil || current.Local != local || current.WorkingBase == nil || *current.WorkingBase != base {
		t.Fatal("dirty refresh lost local/base", err)
	}
	frozen, err := r.FreezeWorking(ctx, e, brain, page)
	if err != nil || frozen.Operation.BaseRevision != 1 {
		t.Fatal("blindly advanced base after refresh", err)
	}
}
