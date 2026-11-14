package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	rv1 "github.com/justin-napolitano/atlas/contracts/research/v1"
	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

// Exercise the launcher's actual SQLite/HTTP boundary, including response loss
// and process-style restart. No existing workspace or provider is contacted.
func TestResearchLauncherRestart(t *testing.T) {
	const org = "00000000-0000-0000-0000-000000000001"
	const user = "10000000-0000-0000-0000-000000000001"
	const brain = "30000000-0000-0000-0000-000000000001"
	const generation = "90000000-0000-0000-0000-000000000001"
	const operationID = "70000000-0000-0000-0000-000000000001"
	const recordID = "80000000-0000-0000-0000-000000000001"
	writes, requests, refreshStatus := 0, 0, 0
	var frozen rv1.Operation
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-only" || r.Header.Get("Cookie") != "" {
			t.Error("credential boundary")
			w.WriteHeader(403)
			return
		}
		if r.Method == http.MethodGet {
			if refreshStatus != 0 {
				w.WriteHeader(refreshStatus)
				return
			}
			_ = json.NewEncoder(w).Encode(rv1.Snapshot{OrganizationID: org, BrainID: brain, UserID: user, GenerationID: generation, Items: []rv1.Record{}})
			return
		}
		var operation rv1.Operation
		if json.NewDecoder(r.Body).Decode(&operation) != nil {
			t.Error("operation decode")
			w.WriteHeader(400)
			return
		}
		requests++
		if requests == 1 {
			frozen = operation
			writes++
			w.WriteHeader(503)
			return
		}
		a, _ := json.Marshal(operation)
		b, _ := json.Marshal(frozen)
		if string(a) != string(b) {
			t.Error("retry changed immutable operation")
		}
		record := operation.Record
		record.Revision = 1
		_ = json.NewEncoder(w).Encode(rv1.Receipt{OrganizationID: org, BrainID: brain, UserID: user, GenerationID: generation, OperationID: operation.OperationID, Outcome: "accepted", Record: record})
	}))
	defer server.Close()
	transport, err := federation.NewHTTPTransport(federation.HTTPTransportConfig{Origin: server.URL, UserID: user, Credentials: credentials{user, "synthetic-only"}, RequireGeneration: true})
	if err != nil {
		t.Fatal(err)
	}
	defer transport.CloseIdleConnections()
	owner := filepath.Join(t.TempDir(), "owner.sqlite")
	if err = os.WriteFile(owner, []byte("synthetic owner sentinel"), 0600); err != nil {
		t.Fatal(err)
	}
	config := []accountConfig{{ID: "alice", DBPath: owner, OrganizationID: org, UserID: user, ResearchEnabled: true}}
	account := federation.BridgeAccount{ID: "alice", Transport: transport, ResearchEnabled: true}
	prefix := "/api/collaboration/accounts/alice/brains/" + brain + "/research/"
	call := func(b *researchBridge, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		r := httptest.NewRequest(method, prefix+path, strings.NewReader(body))
		r.Header.Set("Authorization", "browser credential must not pass")
		r.Header.Set("Cookie", "browser=private")
		b.serve(context.Background(), w, r, account, v1.ID(brain))
		return w
	}
	b := newResearchBridge(config)
	if w := call(b, "GET", "state", ""); w.Code != 200 {
		t.Fatalf("snapshot %d", w.Code)
	}
	op := rv1.Operation{OperationID: operationID, GenerationID: generation, Record: rv1.Record{ID: recordID, Kind: "collection", Visibility: "shared", Title: "Synthetic group"}}
	data, _ := json.Marshal(op)
	if w := call(b, "POST", "operations", string(data)); w.Code != 503 {
		t.Fatalf("lost confirmation %d", w.Code)
	}
	b.close()
	b = newResearchBridge(config)
	defer b.close()
	refreshStatus = 503
	w := call(b, "GET", "state", "")
	var state struct {
		Offline bool `json:"offline"`
		Pending []struct {
			Operation rv1.Operation `json:"operation"`
		} `json:"pending"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &state) != nil || !state.Offline || len(state.Pending) != 1 || state.Pending[0].Operation.OperationID != operationID {
		t.Fatal("restart lost pending intent")
	}
	refreshStatus = 403
	if blocked := call(b, "GET", "state", ""); blocked.Code == 200 {
		t.Fatal("denied refresh exposed cached content")
	}
	refreshStatus = 0
	if w = call(b, "POST", "operations", string(data)); w.Code != 200 {
		t.Fatalf("retry %d", w.Code)
	}
	if writes != 1 || requests != 2 {
		t.Fatal("duplicate mutation")
	}
	if w = call(b, "POST", "resolve", `{"operation_id":"`+operationID+`"}`); w.Code != 409 {
		t.Fatal("accepted receipt can be abandoned")
	}
	// Canonical Go JSON expands HTML-sensitive text. A definite pre-queue
	// rejection must leave the proposal editable rather than look uncertain.
	text := strings.Repeat("<", 100000)
	digest := sha256.Sum256([]byte(text))
	large := rv1.Operation{OperationID: "70000000-0000-0000-0000-000000000002", GenerationID: generation, Record: rv1.Record{ID: recordID, Kind: "source", Visibility: "shared", Title: "Synthetic excerpt", SourceID: recordID, DocumentVersion: generation, SHA256: hex.EncodeToString(digest[:]), Document: text}}
	if large.Validate() != nil {
		t.Fatal("invalid size fixture")
	}
	var body strings.Builder
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(large)
	if rejected := call(b, "POST", "operations", body.String()); rejected.Code != 400 {
		t.Fatalf("definite pre-queue rejection %d", rejected.Code)
	}
	if content, err := os.ReadFile(owner); err != nil || string(content) != "synthetic owner sentinel" {
		t.Fatal("owner database touched")
	}
}
