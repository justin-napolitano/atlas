package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"

	rv1 "github.com/justin-napolitano/atlas/contracts/research/v1"
	"github.com/justin-napolitano/atlas/internal/federation"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
	"github.com/justin-napolitano/atlas/internal/researchsync"
)

// Research uses separate, identity-bound sidecars. No owner library database or
// note replica is opened by this adapter. Only trusted launcher paths are used.
type researchBridge struct {
	mu        sync.Mutex
	accounts  map[string]accountConfig
	databases map[string]*sql.DB
}

func newResearchBridge(config []accountConfig) *researchBridge {
	b := &researchBridge{accounts: map[string]accountConfig{}, databases: map[string]*sql.DB{}}
	for _, account := range config {
		b.accounts[account.ID] = account
	}
	return b
}
func (b *researchBridge) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, database := range b.databases {
		_ = database.Close()
	}
}
func researchError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code})
}
func (b *researchBridge) serve(ctx context.Context, w http.ResponseWriter, r *http.Request, account federation.BridgeAccount, brain v1.ID) {
	config, ok := b.accounts[account.ID]
	if !ok || !config.ResearchEnabled || v1.ValidateID(brain) != nil {
		researchError(w, 404, "research_unavailable")
		return
	}
	prefix := "/api/collaboration/accounts/" + account.ID + "/brains/" + string(brain) + "/research/"
	if !(r.Method == http.MethodGet && r.URL.Path == prefix+"state" || r.Method == http.MethodPost && (r.URL.Path == prefix+"operations" || r.URL.Path == prefix+"resolve")) {
		researchError(w, 404, "research_unavailable")
		return
	}
	httpClient, err := account.Transport.ResearchHTTPClient(config.OrganizationID, brain)
	if err != nil {
		researchError(w, 403, "research_unavailable")
		return
	}
	key := account.ID + "/" + string(brain)
	b.mu.Lock()
	database := b.databases[key]
	if database == nil {
		if len(b.databases) >= 128 {
			b.mu.Unlock()
			researchError(w, 503, "research_store_budget")
			return
		}
		database, err = researchsync.Open(config.DBPath + ".research-" + string(brain) + ".sqlite")
		if err == nil {
			b.databases[key] = database
		}
	}
	b.mu.Unlock()
	if err != nil {
		researchError(w, 503, "research_store_unavailable")
		return
	}
	client := researchsync.Client{BaseURL: account.Transport.Origin(), OrganizationID: string(config.OrganizationID), BrainID: string(brain), UserID: string(account.Transport.AccountID()), HTTP: httpClient, DB: database}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == prefix+"resolve" {
		var request struct {
			OperationID string `json:"operation_id"`
		}
		decoder := json.NewDecoder(io.LimitReader(r.Body, 1025))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || !rv1.ValidID(request.OperationID) {
			researchError(w, 400, "invalid_research_operation")
			return
		}
		if err := client.ResolveConflict(ctx, request.OperationID); err != nil {
			researchError(w, 409, "research_review_required")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"operation_id": request.OperationID, "resolved": true})
		return
	}
	if r.Method == http.MethodGet {
		snapshot, err := client.Refresh(ctx)
		offline := false
		if err != nil {
			var remote *researchsync.HTTPError
			unavailable := errors.Is(err, federation.ErrUncertain) || errors.As(err, &remote) && remote.Status >= 500 && remote.Status <= 599
			if !unavailable {
				researchError(w, 503, "research_refresh_unavailable")
				return
			}
			snapshot, err = client.Cached(ctx)
			if err != nil {
				researchError(w, 503, "research_refresh_unavailable")
				return
			}
			offline = true
		}
		pending, err := client.Pending(ctx)
		if err != nil {
			researchError(w, 503, "research_recovery_unavailable")
			return
		}
		_ = json.NewEncoder(w).Encode(struct {
			rv1.Snapshot
			Pending []researchsync.PendingItem `json:"pending"`
			Offline bool                       `json:"offline"`
		}{snapshot, pending, offline})
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 512*1024+1))
	var operation rv1.Operation
	if err != nil || len(data) > 512*1024 || decodeResearchOperation(data, &operation) != nil || operation.Validate() != nil {
		researchError(w, 400, "invalid_research_operation")
		return
	}
	if err = client.Queue(ctx, operation); err != nil {
		if errors.Is(err, rv1.ErrInvalid) {
			researchError(w, 400, "invalid_research_operation")
			return
		}
		researchError(w, 503, "research_queue_unavailable")
		return
	}
	receipt, err := client.Send(ctx, operation.OperationID)
	if err != nil && !errors.Is(err, researchsync.ErrConflict) {
		researchError(w, 503, "research_confirmation_unavailable")
		return
	}
	_ = json.NewEncoder(w).Encode(receipt)
}

func decodeResearchOperation(data []byte, operation *rv1.Operation) error {
	if err := v1.DecodeStrict(data, operation); err != nil {
		return rv1.ErrInvalid
	}
	check := func(raw []byte, keys []string) (map[string]json.RawMessage, error) {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil || len(fields) != len(keys) {
			return nil, rv1.ErrInvalid
		}
		for _, key := range keys {
			if fields[key] == nil {
				return nil, rv1.ErrInvalid
			}
		}
		return fields, nil
	}
	fields, err := check(data, []string{"operation_id", "generation_id", "base_revision", "record"})
	if err != nil {
		return err
	}
	record, err := check(fields["record"], []string{"id", "revision", "kind", "visibility", "deleted", "title", "source_id", "document_version", "sha256", "collection_id", "document", "selector", "body", "position"})
	if err != nil {
		return err
	}
	if operation.Record.Selector != nil {
		_, err = check(record["selector"], []string{"exact", "prefix", "suffix", "start", "end"})
	}
	return err
}
