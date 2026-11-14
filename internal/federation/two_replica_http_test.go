package federation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

// The coordinator here is deliberately synthetic; the executable replica probe
// exercises the same clients against the independent MU PostgreSQL HTTP fixture.
func TestTwoIndependentSQLiteReplicasHTTPRetryConflictRestartAndRevoke(t *testing.T) {
	ctx := context.Background()
	var mu sync.Mutex
	var current *v1.Snapshot
	var history = map[int64]v1.Snapshot{}
	var receipts = map[v1.ID]v1.Receipt{}
	var attempts = map[v1.ID]int{}
	revoked, loseFirst := false, true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if revoked {
			w.WriteHeader(403)
			return
		}
		if r.Method == "GET" {
			if strings.Contains(r.URL.Path, "/pages/") {
				_ = json.NewEncoder(w).Encode(current)
			} else {
				_ = json.NewEncoder(w).Encode(BrainAuthority{OrganizationID: org, BrainID: brain, UserID: user, MembershipEpoch: 1, CanWrite: true})
			}
			return
		}
		var op v1.Operation
		if err := json.NewDecoder(r.Body).Decode(&op); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		attempts[op.OperationID]++
		receipt, found := receipts[op.OperationID]
		if !found {
			if current != nil && current.Revision != op.BaseRevision {
				receipt = conflictReceipt(op)
				receipt.Conflict.Server = current
				if base, ok := history[op.BaseRevision]; ok {
					receipt.Conflict.Base = &base
				}
			} else {
				receipt = accepted(op)
				snapshot := v1.Snapshot{RevisionID: *receipt.RevisionID, Revision: receipt.Revision, Content: op.Payload}
				current = &snapshot
				history[snapshot.Revision] = snapshot
			}
			receipts[op.OperationID] = receipt
		}
		if loseFirst {
			loseFirst = false
			w.WriteHeader(503)
			return
		}
		if receipt.Outcome == v1.Conflicted {
			w.WriteHeader(409)
		}
		_ = json.NewEncoder(w).Encode(receipt)
	}))
	defer server.Close()
	a, path, id := realReplica(t, server.URL)
	b, otherPath, _ := realReplica(t, server.URL)
	if path == otherPath {
		t.Fatal("replicas share storage")
	}
	h := transportFor(t, server.URL, 0)
	ea, err := a.Select(ctx, h, brain)
	if err != nil {
		t.Fatal(err)
	}
	eb, err := b.Select(ctx, h, brain)
	if err != nil {
		t.Fatal(err)
	}
	initial := operation(op1, 0, "Exact العربية\r\n日本語 👩🏽‍💻 é\t")
	if _, err = a.Edit(ctx, ea, initial); err != nil {
		t.Fatal(err)
	}
	if _, err = ea.ProcessOne(ctx, a.key(brain)); !errors.Is(err, ErrUncertain) {
		t.Fatal("lost receipt did not remain uncertain", err)
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	a, err = OpenReplica(ctx, path, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	ea = a.Engine(h)
	if _, err = ea.ProcessOne(ctx, a.key(brain)); err != nil {
		t.Fatal(err)
	}
	if err = b.RefreshPage(ctx, eb, h, brain, page); err != nil {
		t.Fatal(err)
	}
	bob := operation(op2, 1, initial.Payload.Body+"\nBob offline")
	if _, err = b.Edit(ctx, eb, bob); err != nil {
		t.Fatal(err)
	}
	alice := operation(v1.ID("90000000-0000-4000-8000-000000000201"), 1, initial.Payload.Body+"\nAlice concurrent")
	if _, err = a.Edit(ctx, ea, alice); err != nil {
		t.Fatal(err)
	}
	if _, err = ea.ProcessOne(ctx, a.key(brain)); err != nil {
		t.Fatal(err)
	}
	if _, err = eb.ProcessOne(ctx, b.key(brain)); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	entry, err := eb.Entry(ctx, b.key(brain), bob.OperationID)
	if err != nil || entry.Receipt == nil || entry.Receipt.Conflict == nil {
		t.Fatal(err)
	}
	c := entry.Receipt.Conflict
	if c.Base == nil || c.Base.Content != initial.Payload || c.Local != bob.Payload || c.Server == nil || c.Server.Content != alice.Payload {
		t.Fatal("three-way writing changed")
	}
	merged := operation(v1.ID("90000000-0000-4000-8000-000000000202"), 2, alice.Payload.Body+"\nReviewed Bob offline")
	if _, err = b.Resolve(ctx, eb, bob.OperationID, merged); err != nil {
		t.Fatal(err)
	}
	if _, err = eb.ProcessOne(ctx, b.key(brain)); err != nil {
		t.Fatal(err)
	}
	if err = a.RefreshPage(ctx, ea, h, brain, page); err != nil {
		t.Fatal(err)
	}
	converged, err := a.Page(ctx, brain, page)
	if err != nil || converged.Local != merged.Payload {
		t.Fatal("replicas did not converge", err)
	}
	tombstone := operation(v1.ID("90000000-0000-4000-8000-000000000203"), 3, merged.Payload.Body)
	tombstone.Payload.State = v1.Deleted
	if _, err = a.Edit(ctx, ea, tombstone); err != nil {
		t.Fatal(err)
	}
	if _, err = ea.ProcessOne(ctx, a.key(brain)); err != nil {
		t.Fatal(err)
	}
	if err = b.RefreshPage(ctx, eb, h, brain, page); err != nil {
		t.Fatal(err)
	}
	pending := operation(v1.ID("90000000-0000-4000-8000-000000000204"), 4, "Retained unsent after revoke")
	if _, err = b.Edit(ctx, eb, pending); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	revoked = true
	mu.Unlock()
	if err = b.RefreshPage(ctx, eb, h, brain, page); !errors.Is(err, ErrRevoked) {
		t.Fatal(err)
	}
	if sent, err := eb.ProcessOne(ctx, b.key(brain)); sent || !errors.Is(err, ErrRevoked) {
		t.Fatal("revoked transfer continued", err)
	}
	retained, err := b.Page(ctx, brain, page)
	if err != nil || retained.Local != pending.Payload {
		t.Fatal("revocation lost writing", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if attempts[op1] != 2 || len(receipts) != 5 || attempts[pending.OperationID] != 0 {
		t.Fatal("retry/revocation changed logical writes", attempts, len(receipts))
	}
}
