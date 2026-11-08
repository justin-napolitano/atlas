package federation

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"
	"unicode/utf8"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

var ErrCursorReset = errors.New("server checkpoint expired or changed; a new bootstrap is required")

type SyncItem struct {
	PageID   v1.ID
	Snapshot v1.Snapshot
	Event    *v1.ChangeEvent
}
type SyncBatch struct {
	SchemaVersion                                             string
	OrganizationID, BrainID, UserID, GenerationID, SnapshotID v1.ID
	MembershipEpoch                                           int64
	ExpiresAt, NextCursor                                     string
	Items                                                     []SyncItem
	Complete, HasMore                                         bool
}

func (h *HTTPTransport) syncBatch(ctx context.Context, org, brain v1.ID, mode, cursor string) (SyncBatch, error) {
	var out SyncBatch
	var checkpoint any
	if cursor != "" {
		checkpoint = cursor
	}
	data, _ := json.Marshal(map[string]any{"cursor": checkpoint, "limit": 4})
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	credential, err := h.credentials.Credential(ctx, h.origin)
	if err != nil {
		if errors.Is(err, ErrAuthenticationRequired) {
			return out, ErrAuthenticationRequired
		}
		return out, ErrUncertain
	}
	if credential.Origin != h.origin || credential.UserID != h.userID || len(credential.BearerToken) == 0 || len(credential.BearerToken) > 16384 {
		return out, ErrAuthenticationRequired
	}
	for _, b := range []byte(credential.BearerToken) {
		if b < 0x21 || b > 0x7e {
			return out, ErrAuthenticationRequired
		}
	}
	u := h.base
	u.Path = brainPath(org, brain) + "/sync/" + mode
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(data))
	if err != nil {
		return out, ErrUncertain
	}
	req.Header.Set("Authorization", "Bearer "+credential.BearerToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	response, err := h.client.Do(req)
	if err != nil {
		return out, ErrUncertain
	}
	defer response.Body.Close()
	if response.StatusCode == 401 {
		return out, ErrAuthenticationRequired
	}
	if response.StatusCode == 403 || response.StatusCode == 404 {
		return out, ErrAccessDenied
	}
	if response.StatusCode != 200 && response.StatusCode != 409 {
		return out, ErrUncertain
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return out, ErrInvalidReceipt
	}
	const max = 4 * v1.MaxRequestBytes
	body, err := io.ReadAll(io.LimitReader(response.Body, max+1))
	if err != nil {
		return out, ErrUncertain
	}
	if len(body) > max {
		return out, ErrInvalidReceipt
	}
	if response.StatusCode == 409 {
		var failure v1.APIError
		if v1.DecodeStrict(body, &failure) == nil && failure.Code == "cursor_reset" {
			return out, ErrCursorReset
		}
		return out, ErrInvalidReceipt
	}
	return decodeSyncBatch(body, mode, org, brain, h.userID)
}

// Large feed envelopes have their own bound. Each content item still uses the
// canonical Unicode/JSON checks and exact known-key snapshot decoding.
func documentJSON(data []byte) error {
	if !utf8.Valid(data) {
		return ErrInvalidReceipt
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var read func(int) error
	read = func(depth int) error {
		if depth > 16 {
			return ErrInvalidReceipt
		}
		token, err := d.Token()
		if err != nil {
			return ErrInvalidReceipt
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				token, err := d.Token()
				name, ok := token.(string)
				if err != nil || !ok || seen[name] {
					return ErrInvalidReceipt
				}
				seen[name] = true
				if err = read(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for d.More() {
				if err = read(depth + 1); err != nil {
					return err
				}
			}
		default:
			return ErrInvalidReceipt
		}
		_, err = d.Token()
		return err
	}
	if err := read(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return ErrInvalidReceipt
	}
	return nil
}

func decodeSyncBatch(data []byte, mode string, org, brain, user v1.ID) (SyncBatch, error) {
	var out SyncBatch
	if documentJSON(data) != nil {
		return out, ErrInvalidReceipt
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return out, ErrInvalidReceipt
	}
	known := map[string]any{"schema_version": &out.SchemaVersion, "organization_id": &out.OrganizationID, "brain_id": &out.BrainID, "user_id": &out.UserID, "membership_epoch": &out.MembershipEpoch, "generation_id": &out.GenerationID, "expires_at": &out.ExpiresAt, "next_cursor": &out.NextCursor}
	if mode == "bootstrap" {
		known["snapshot_id"] = &out.SnapshotID
		known["complete"] = &out.Complete
	} else {
		known["has_more"] = &out.HasMore
	}
	for name, target := range known {
		if len(fields[name]) == 0 || jsonNull(fields[name]) || json.Unmarshal(fields[name], target) != nil {
			return out, ErrInvalidReceipt
		}
	}
	if out.SchemaVersion != v1.SchemaVersion || out.OrganizationID != org || out.BrainID != brain || out.UserID != user || v1.ValidateID(out.GenerationID) != nil || out.MembershipEpoch < 1 || out.MembershipEpoch > v1.MaxRevision || len(out.NextCursor) == 0 || len(out.NextCursor) > 8192 {
		return out, ErrInvalidReceipt
	}
	expiry, err := time.Parse(time.RFC3339Nano, out.ExpiresAt)
	if err != nil || !expiry.After(time.Now()) {
		return out, ErrCursorReset
	}
	if mode == "bootstrap" && v1.ValidateID(out.SnapshotID) != nil {
		return out, ErrInvalidReceipt
	}
	var items []json.RawMessage
	if len(fields["items"]) == 0 || jsonNull(fields["items"]) || json.Unmarshal(fields["items"], &items) != nil || len(items) > 4 {
		return out, ErrInvalidReceipt
	}
	seen := map[v1.ID]bool{}
	for _, raw := range items {
		var f map[string]json.RawMessage
		if json.Unmarshal(raw, &f) != nil {
			return out, ErrInvalidReceipt
		}
		item := SyncItem{}
		if mode == "bootstrap" {
			if json.Unmarshal(f["page_id"], &item.PageID) != nil || v1.ValidateID(item.PageID) != nil || seen[item.PageID] {
				return out, ErrInvalidReceipt
			}
			seen[item.PageID] = true
		} else {
			var event v1.ChangeEvent
			if v1.DecodeStrict(f["event"], &event) != nil || event.Validate() != nil || event.OrganizationID != org || event.BrainID != brain || seen[event.EventID] {
				return out, ErrInvalidReceipt
			}
			item.PageID = event.PageID
			item.Event = &event
			seen[event.EventID] = true
		}
		item.Snapshot, err = decodeSnapshot(f["snapshot"])
		if err != nil {
			return out, err
		}
		if item.Event != nil && (item.Event.RevisionID != item.Snapshot.RevisionID || item.Event.Revision != item.Snapshot.Revision) {
			return out, ErrInvalidReceipt
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

type syncState struct {
	Mode, Cursor             string
	SnapshotID, GenerationID v1.ID
}

func readSyncState(ctx context.Context, tx *sql.Tx, key Key) (syncState, error) {
	var s syncState
	err := tx.QueryRowContext(ctx, `SELECT mode,cursor,snapshot_id,generation_id FROM replica_sync_state WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...).Scan(&s.Mode, &s.Cursor, &s.SnapshotID, &s.GenerationID)
	if errors.Is(err, sql.ErrNoRows) {
		return syncState{Mode: "bootstrap"}, nil
	}
	return s, err
}

// PullBrain stages an entire bootstrap before publishing it and commits each
// feed batch with its durable opaque checkpoint. It never overwrites dirty text.
func (r *Replica) PullBrain(ctx context.Context, e *Engine, h *HTTPTransport, brain v1.ID, maxBatches int) (bool, error) {
	if e.Store != r || e.Transport != h || h.Origin() != r.identity.Origin || h.AccountID() != r.identity.UserID {
		return false, ErrAccessDenied
	}
	if maxBatches < 1 || maxBatches > 1000 {
		return false, ErrInvalidReceipt
	}
	key := r.key(brain)
	for i := 0; i < maxBatches; i++ {
		state, err := e.State(ctx, key)
		if err != nil {
			return false, err
		}
		if state.Revoked {
			return false, ErrRevoked
		}
		if !state.Enabled {
			return false, ErrDisabled
		}
		var checkpoint syncState
		err = r.Transaction(ctx, func(tx Tx) error {
			raw, _ := SQLTransaction(tx)
			var err error
			checkpoint, err = readSyncState(ctx, raw, key)
			return err
		})
		if err != nil {
			return false, err
		}
		if checkpoint.Cursor != state.Cursor {
			checkpoint.Mode = "bootstrap"
			checkpoint.Cursor = ""
			checkpoint.SnapshotID = ""
		}
		mode := checkpoint.Mode
		if mode == "feed" {
			mode = "pull"
		}
		batch, err := h.syncBatch(ctx, key.OrganizationID, brain, mode, checkpoint.Cursor)
		if errors.Is(err, ErrCursorReset) {
			if err = r.resetCheckpoint(ctx, key, state.CursorVersion); err != nil {
				return false, err
			}
			continue
		}
		if err != nil {
			return false, r.authorityError(ctx, e, key, state.AccessGeneration, err)
		}
		if batch.MembershipEpoch != state.MembershipEpoch {
			return false, e.revoke(ctx, key, state.AccessGeneration)
		}
		if (mode == "bootstrap" && !batch.Complete || mode == "pull" && batch.HasMore) && (len(batch.Items) == 0 || batch.NextCursor == checkpoint.Cursor) {
			return false, ErrInvalidReceipt
		}
		binding := v1.Cursor{SchemaVersion: v1.SchemaVersion, OrganizationID: batch.OrganizationID, BrainID: batch.BrainID, UserID: batch.UserID, MembershipEpoch: batch.MembershipEpoch, ExpiresAt: batch.ExpiresAt}
		err = e.CommitPullBatch(ctx, key, state.CursorVersion, binding, batch.NextCursor, func(tx Tx) error {
			raw, _ := SQLTransaction(tx)
			if mode == "bootstrap" {
				if checkpoint.Cursor != "" && checkpoint.SnapshotID != batch.SnapshotID {
					return ErrCursorConflict
				}
				if checkpoint.SnapshotID != batch.SnapshotID {
					if _, err := raw.ExecContext(ctx, `DELETE FROM replica_bootstrap_pages WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...); err != nil {
						return err
					}
				}
				for _, item := range batch.Items {
					data, _ := json.Marshal(item.Snapshot)
					args := append(keyArgs(key), string(batch.SnapshotID), string(item.PageID), data)
					if _, err := raw.ExecContext(ctx, `INSERT INTO replica_bootstrap_pages VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id,snapshot_id,page_id) DO UPDATE SET snapshot_json=excluded.snapshot_json`, args...); err != nil {
						return err
					}
				}
				if batch.Complete {
					if checkpoint.GenerationID == "" {
						var old int
						if err := raw.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM replica_snapshots WHERE organization_id=? AND brain_id=? AND user_id=?)+(SELECT count(*) FROM federation_outbox WHERE organization_id=? AND brain_id=? AND user_id=? AND status IN ('pending','in_flight','suspended'))`, append(keyArgs(key), keyArgs(key)...)...).Scan(&old); err != nil {
							return err
						}
						if old > 0 {
							if err := archiveGeneration(ctx, raw, key, "legacy-unbound"); err != nil {
								return err
							}
						}
					}
					if checkpoint.GenerationID != "" && checkpoint.GenerationID != batch.GenerationID {
						if err := archiveGeneration(ctx, raw, key, checkpoint.GenerationID); err != nil {
							return err
						}
					}
					rows, err := raw.QueryContext(ctx, `SELECT page_id,snapshot_json FROM replica_bootstrap_pages WHERE organization_id=? AND brain_id=? AND user_id=? AND snapshot_id=? ORDER BY page_id`, append(keyArgs(key), string(batch.SnapshotID))...)
					if err != nil {
						return err
					}
					var staged []SyncItem
					for rows.Next() {
						var id v1.ID
						var data []byte
						if err = rows.Scan(&id, &data); err != nil {
							rows.Close()
							return err
						}
						snapshot, err := decodeSnapshot(data)
						if err != nil {
							rows.Close()
							return err
						}
						staged = append(staged, SyncItem{PageID: id, Snapshot: snapshot})
					}
					err = rows.Err()
					rows.Close()
					if err != nil {
						return err
					}
					for _, item := range staged {
						if err = cacheSnapshot(ctx, raw, key, item.PageID, item.Snapshot); err != nil {
							return err
						}
					}
					if _, err = raw.ExecContext(ctx, `DELETE FROM replica_bootstrap_pages WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...); err != nil {
						return err
					}
				}
			} else {
				if checkpoint.GenerationID != batch.GenerationID {
					return ErrCursorReset
				}
				for _, item := range batch.Items {
					if err := cacheSnapshot(ctx, raw, key, item.PageID, item.Snapshot); err != nil {
						return err
					}
				}
			}
			nextMode := "feed"
			if mode == "bootstrap" && !batch.Complete {
				nextMode = "bootstrap"
			}
			args := append(keyArgs(key), nextMode, string(batch.SnapshotID), string(batch.GenerationID), batch.NextCursor)
			_, err := raw.ExecContext(ctx, `INSERT INTO replica_sync_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id) DO UPDATE SET mode=excluded.mode,snapshot_id=excluded.snapshot_id,generation_id=excluded.generation_id,cursor=excluded.cursor`, args...)
			return err
		})
		if errors.Is(err, ErrCursorReset) {
			if err = r.resetCheckpoint(ctx, key, state.CursorVersion); err != nil {
				return false, err
			}
			continue
		}
		if err != nil {
			return false, err
		}
		if mode == "pull" && !batch.HasMore {
			return true, nil
		}
	}
	return false, nil
}

func (r *Replica) resetCheckpoint(ctx context.Context, key Key, version int64) error {
	return r.Transaction(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil {
			return err
		}
		if state.CursorVersion != version {
			return ErrCursorConflict
		}
		state.Cursor = ""
		state.CursorVersion++
		raw, _ := SQLTransaction(tx)
		if _, err = raw.ExecContext(ctx, `UPDATE replica_sync_state SET mode='bootstrap',cursor='',snapshot_id='' WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...); err != nil {
			return err
		}
		if _, err = raw.ExecContext(ctx, `DELETE FROM replica_bootstrap_pages WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...); err != nil {
			return err
		}
		return tx.PutBrain(key, state)
	})
}

func archiveGeneration(ctx context.Context, tx *sql.Tx, key Key, generation v1.ID) error {
	if err := blockGeneration(ctx, tx, key, generation); err != nil {
		return err
	}
	args := append([]any{string(generation)}, keyArgs(key)...)
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO replica_snapshot_archives SELECT organization_id,brain_id,user_id,page_id,?,revision,snapshot_json FROM replica_snapshots WHERE organization_id=? AND brain_id=? AND user_id=?`, args...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM replica_snapshots WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `UPDATE replica_pages SET remote_json=NULL WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...)
	return err
}

func (r *Replica) WorkingPages(ctx context.Context, brain v1.ID) ([]WorkingPage, error) {
	var out []WorkingPage
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		rows, err := raw.QueryContext(ctx, `SELECT page_id FROM replica_pages WHERE organization_id=? AND brain_id=? AND user_id=? ORDER BY page_id`, keyArgs(r.key(brain))...)
		if err != nil {
			return err
		}
		var ids []v1.ID
		for rows.Next() {
			var id v1.ID
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, id := range ids {
			page, err := workingPage(ctx, raw, r.key(brain), id)
			if err != nil {
				return err
			}
			out = append(out, page)
		}
		return nil
	})
	return out, err
}

type SyncResult struct {
	Complete  bool `json:"complete"`
	Sent      int  `json:"sent"`
	Conflicts int  `json:"conflicts"`
	Pending   int  `json:"pending"`
}

func (r *Replica) Synchronize(ctx context.Context, e *Engine, h *HTTPTransport, brain v1.ID) (SyncResult, error) {
	var result SyncResult
	complete, err := r.PullBrain(ctx, e, h, brain, 100)
	if err != nil {
		return result, err
	}
	if !complete {
		return result, nil
	}
	canWrite, err := r.CanWrite(ctx, brain)
	if err != nil {
		return result, err
	}
	if !canWrite {
		result.Complete = true
		return result, nil
	}
	pages, err := r.WorkingPages(ctx, brain)
	if err != nil {
		return result, err
	}
	for _, page := range pages {
		blocked, blockErr := r.GenerationReview(ctx, brain, page.PageID)
		if blockErr != nil {
			return result, blockErr
		}
		if blocked {
			result.Conflicts++
			continue
		}
		if page.Version > page.SyncedVersion && page.DraftOperationID == "" {
			if _, err = r.FreezeWorking(ctx, e, brain, page.PageID); err != nil {
				return result, err
			}
		}
	}
	for i := 0; i < 100; i++ {
		sent, err := e.ProcessOne(ctx, r.key(brain))
		if !sent && err == nil {
			break
		}
		if errors.Is(err, ErrConflict) {
			result.Conflicts++
			continue
		}
		if err != nil {
			if errors.Is(err, ErrCursorReset) {
				state, stateErr := e.State(ctx, r.key(brain))
				if stateErr != nil {
					return result, stateErr
				}
				if resetErr := r.resetCheckpoint(ctx, r.key(brain), state.CursorVersion); resetErr != nil {
					return result, resetErr
				}
			}
			return result, err
		}
		if sent {
			result.Sent++
		}
	}
	result.Complete, err = r.PullBrain(ctx, e, h, brain, 100)
	if err != nil {
		return result, err
	}
	result.Conflicts = 0
	pages, err = r.WorkingPages(ctx, brain)
	if err != nil {
		return result, err
	}
	for _, page := range pages {
		blocked, err := r.GenerationReview(ctx, brain, page.PageID)
		if err != nil {
			return result, err
		}
		if blocked {
			result.Conflicts++
			continue
		}
		if page.DraftOperationID != "" {
			entry, err := e.Entry(ctx, r.key(brain), page.DraftOperationID)
			if err != nil {
				return result, err
			}
			if entry.Status == Conflicted {
				result.Conflicts++
				continue
			}
			if entry.Status == Pending || entry.Status == InFlight || entry.Status == Suspended {
				result.Pending++
				continue
			}
		}
		if page.Version > page.SyncedVersion {
			result.Pending++
		}
	}
	result.Complete = result.Complete && result.Pending == 0
	return result, nil
}
