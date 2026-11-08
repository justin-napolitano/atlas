package federation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestWorkingGenerationIsFrozenThroughRestartAndRestoreNeedsExplicitNewOperation(t *testing.T) {
	ctx := context.Background()
	newGeneration := v1.ID("70000000-0000-4000-8000-000000000003")
	var headers []string
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		headers = append(headers, req.Header.Get("X-Muthur-Generation"))
		w.Header().Set("Content-Type", "application/json")
		if req.Header.Get("X-Muthur-Generation") != string(newGeneration) {
			w.WriteHeader(409)
			_ = json.NewEncoder(w).Encode(v1.APIError{Code: "cursor_reset", RequestID: event})
			return
		}
		var op v1.Operation
		_ = json.NewDecoder(req.Body).Decode(&op)
		writes++
		_ = json.NewEncoder(w).Encode(accepted(op))
	}))
	defer server.Close()
	r, path, identity := realReplica(t, server.URL)
	h, err := NewHTTPTransport(HTTPTransportConfig{Origin: server.URL, UserID: user, RequireGeneration: true, Credentials: credentialFunc(func(_ context.Context, origin string) (Credential, error) {
		return Credential{Origin: origin, UserID: user, BearerToken: "synthetic"}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	e := r.Engine(h)
	key := r.key(brain)
	if err = e.Enable(ctx, key, 1); err != nil {
		t.Fatal(err)
	}
	if _, err = r.db.Exec(`INSERT INTO replica_sync_state VALUES(?,?,?,'feed','',?,'old-checkpoint')`, string(org), string(brain), string(user), string(generation)); err != nil {
		t.Fatal(err)
	}
	base := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: "Before restore", State: v1.Active}}
	if err = r.Transaction(ctx, func(tx Tx) error { raw, _ := SQLTransaction(tx); return cacheSnapshot(ctx, raw, key, page, base) }); err != nil {
		t.Fatal(err)
	}
	local := base.Content
	local.Body = "Unsent exact 日本語\r\n"
	if _, err = r.SaveWorking(ctx, brain, page, op1, 0, local); err != nil {
		t.Fatal(err)
	}
	frozen, err := r.FreezeWorking(ctx, e, brain, page)
	if err != nil {
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
	e = r.Engine(h)
	if _, err = e.ProcessOne(ctx, key); !errors.Is(err, ErrCursorReset) {
		t.Fatal("server generation mismatch not retained", err)
	}
	if len(headers) != 1 || headers[0] != string(generation) || writes != 0 {
		t.Fatal("retry did not keep original generation")
	}
	retained, err := e.Entry(ctx, key, frozen.Operation.OperationID)
	if err != nil || retained.GenerationID != generation || retained.Operation != frozen.Operation || retained.Status != Pending {
		t.Fatal("generation or operation changed after uncertain restart", err)
	}
	restored := base
	restored.RevisionID = event
	restored.Content.Body = "Restored different revision with reused counter"
	if err = r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		if err := archiveGeneration(ctx, raw, key, generation); err != nil {
			return err
		}
		if err := cacheSnapshot(ctx, raw, key, page, restored); err != nil {
			return err
		}
		_, err := raw.ExecContext(ctx, `UPDATE replica_sync_state SET generation_id=? WHERE organization_id=? AND brain_id=? AND user_id=?`, append([]any{string(newGeneration)}, keyArgs(key)...)...)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if sent, err := e.ProcessOne(ctx, key); err != nil || sent {
		t.Fatal("restored old operation was transferred", err)
	}
	if _, err = r.FreezeWorking(ctx, e, brain, page); !errors.Is(err, ErrGenerationReview) {
		t.Fatal("old intent silently rebound", err)
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil || current.Local != local || current.WorkingBase == nil || *current.WorkingBase != base || current.Remote == nil || *current.Remote != restored {
		t.Fatal("restore lost three-way writing", err)
	}
	merged := local
	merged.Body += "Reviewed restored server"
	if _, err = r.SaveWorking(ctx, brain, page, op2, 1, merged); err != nil {
		t.Fatal(err)
	}
	replacement, err := r.ResolveGeneration(ctx, e, brain, page, 2, 1)
	if err != nil || replacement.Operation.OperationID == frozen.Operation.OperationID {
		t.Fatal(err)
	}
	if _, err = e.ProcessOne(ctx, key); err != nil {
		t.Fatal(err)
	}
	if writes != 1 || len(headers) != 2 || headers[1] != string(newGeneration) {
		t.Fatal("reviewed operation did not use new generation")
	}
	retained, err = e.Entry(ctx, key, frozen.Operation.OperationID)
	if err != nil || !retained.GenerationBlocked || retained.Operation != frozen.Operation || retained.GenerationID != generation {
		t.Fatal("old frozen operation mutated", err)
	}
}
