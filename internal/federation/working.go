package federation

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

//go:embed replica_working.sql
var workingSchema string
var ErrLocalVersion = errors.New("local writing changed; inspect the current version before saving")
var ErrWorkspaceUpgrade = errors.New("workspace schema needs an explicit verified snapshot and upgrade")

func (r *Replica) WorkspaceReady(ctx context.Context) error {
	var version int
	if err := r.db.QueryRowContext(ctx, "SELECT version FROM replica_schema_version WHERE singleton=1").Scan(&version); err != nil {
		return err
	}
	if version != 2 {
		return ErrWorkspaceUpgrade
	}
	return nil
}

func NewID() (v1.ID, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return v1.ID(fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])), nil
}

func (r *Replica) UpgradeWorkspace(ctx context.Context, snapshotPath string) error {
	var version int
	if err := r.db.QueryRowContext(ctx, "SELECT version FROM replica_schema_version WHERE singleton=1").Scan(&version); err != nil {
		return err
	}
	if version == 2 {
		return nil
	}
	if version != 1 {
		return ErrWorkspaceUpgrade
	}
	if err := r.Snapshot(ctx, snapshotPath); err != nil {
		return err
	}
	return r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		_, err := raw.ExecContext(ctx, workingSchema)
		return err
	})
}

type WorkingPage struct {
	ReplicaPage
	Version       int64
	SyncedVersion int64
	WorkingBase   *v1.Snapshot
	GenerationID  v1.ID
}

func workingPage(ctx context.Context, tx *sql.Tx, key Key, page v1.ID) (WorkingPage, error) {
	var out WorkingPage
	var err error
	out.ReplicaPage, err = readPage(ctx, tx, key, page)
	if err != nil {
		return out, err
	}
	var base []byte
	err = tx.QueryRowContext(ctx, `SELECT version,synced_version,base_json,generation_id FROM replica_working_pages WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, append(keyArgs(key), string(page))...).Scan(&out.Version, &out.SyncedVersion, &base, &out.GenerationID)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if base != nil && json.Unmarshal(base, &out.WorkingBase) != nil {
		return out, ErrInvalidReceipt
	}
	return out, nil
}
func (r *Replica) WorkingPage(ctx context.Context, brain, page v1.ID) (WorkingPage, error) {
	var out WorkingPage
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		var err error
		out, err = workingPage(ctx, raw, r.key(brain), page)
		return err
	})
	return out, err
}

// SaveWorking atomically commits exact writing and an immutable local edit intent.
// Wire operations are frozen only for transfer; edits made while one is in flight
// remain durable and cannot be acknowledged by that older operation's receipt.
func (r *Replica) SaveWorking(ctx context.Context, brain, page, editID v1.ID, expected int64, content v1.PageContent) (WorkingPage, error) {
	var out WorkingPage
	if v1.ValidateID(page) != nil || v1.ValidateID(editID) != nil || expected < 0 || expected >= v1.MaxRevision || content.Validate() != nil {
		return out, ErrInvalidReceipt
	}
	data, _ := json.Marshal(content)
	key := r.key(brain)
	err := r.Transaction(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil {
			return err
		}
		if state.Revoked {
			return ErrRevoked
		}
		if !state.Enabled {
			return ErrDisabled
		}
		raw, _ := SQLTransaction(tx)
		var stored []byte
		var canWrite bool
		authorityErr := raw.QueryRowContext(ctx, `SELECT can_write FROM replica_selected_authority WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...).Scan(&canWrite)
		if authorityErr == nil && !canWrite {
			return ErrAccessDenied
		}
		if authorityErr != nil && !errors.Is(authorityErr, sql.ErrNoRows) {
			return authorityErr
		}
		var storedKey Key
		var storedPage v1.ID
		var previous int64
		err = raw.QueryRowContext(ctx, `SELECT organization_id,brain_id,user_id,page_id,expected_version,content_json FROM replica_working_edits WHERE edit_id=?`, string(editID)).Scan(&storedKey.OrganizationID, &storedKey.BrainID, &storedKey.UserID, &storedPage, &previous, &stored)
		if err == nil {
			if storedKey != key || storedPage != page || previous != expected || !bytes.Equal(data, stored) {
				return ErrKeyReuse
			}
			out, err = workingPage(ctx, raw, key, page)
			return err
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		current, err := workingPage(ctx, raw, key, page)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if current.Version != expected {
			return ErrLocalVersion
		}
		var base any
		baseSnapshot := current.WorkingBase
		baseGeneration := current.GenerationID
		if current.Version == current.SyncedVersion {
			baseSnapshot = current.Remote
			baseGeneration = state.GenerationID
		}
		if baseSnapshot != nil {
			encoded, _ := json.Marshal(baseSnapshot)
			base = encoded
		}
		args := append(keyArgs(key), string(page), data)
		if _, err = raw.ExecContext(ctx, `INSERT INTO replica_pages(organization_id,brain_id,user_id,page_id,local_json) VALUES(?,?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id,page_id) DO UPDATE SET local_json=excluded.local_json`, args...); err != nil {
			return err
		}
		args = append(keyArgs(key), string(page), expected+1, data, base, string(baseGeneration))
		if _, err = raw.ExecContext(ctx, `INSERT INTO replica_working_pages(organization_id,brain_id,user_id,page_id,version,content_json,base_json,generation_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id,page_id) DO UPDATE SET version=excluded.version,content_json=excluded.content_json,base_json=excluded.base_json,generation_id=excluded.generation_id`, args...); err != nil {
			return err
		}
		args = append([]any{string(editID)}, keyArgs(key)...)
		args = append(args, string(page), expected, expected+1, data, base, string(baseGeneration))
		if _, err = raw.ExecContext(ctx, `INSERT INTO replica_working_edits(edit_id,organization_id,brain_id,user_id,page_id,expected_version,version,content_json,base_json,generation_id) VALUES(?,?,?,?,?,?,?,?,?,?)`, args...); err != nil {
			return err
		}
		out, err = workingPage(ctx, raw, key, page)
		return err
	})
	return out, err
}

func (r *Replica) FreezeWorking(ctx context.Context, e *Engine, brain, page v1.ID) (Entry, error) {
	if e.Store != r || e.UserID != r.identity.UserID || e.DeviceID != r.identity.DeviceID {
		return Entry{}, ErrAccessDenied
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil {
		return Entry{}, err
	}
	blocked, err := r.GenerationReview(ctx, brain, page)
	if err != nil {
		return Entry{}, err
	}
	if blocked {
		return Entry{}, ErrGenerationReview
	}
	if current.DraftOperationID != "" {
		return e.Entry(ctx, r.key(brain), current.DraftOperationID)
	}
	if current.Version == current.SyncedVersion {
		return Entry{}, ErrNotFound
	}
	id, err := NewID()
	if err != nil {
		return Entry{}, err
	}
	base := int64(0)
	if current.WorkingBase != nil {
		base = current.WorkingBase.Revision
	}
	op := v1.Operation{SchemaVersion: v1.SchemaVersion, OrganizationID: r.identity.OrganizationID, BrainID: brain, PageID: page, DeviceID: r.identity.DeviceID, OperationID: id, BaseRevision: base, Payload: current.Local}
	return e.queue(ctx, r.key(brain), op, func(tx Tx) error { return r.freezeVersion(ctx, tx, op, current.Version, false) })
}

func (r *Replica) ResolveWorking(ctx context.Context, e *Engine, brain, page, oldID v1.ID, version, inspectedRevision int64) (Entry, error) {
	if e.Store != r || e.UserID != r.identity.UserID || e.DeviceID != r.identity.DeviceID {
		return Entry{}, ErrAccessDenied
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil {
		return Entry{}, err
	}
	if current.Version != version || current.DraftOperationID != oldID {
		return Entry{}, ErrLocalVersion
	}
	id, err := NewID()
	if err != nil {
		return Entry{}, err
	}
	op := v1.Operation{SchemaVersion: v1.SchemaVersion, OrganizationID: r.identity.OrganizationID, BrainID: brain, PageID: page, DeviceID: r.identity.DeviceID, OperationID: id, BaseRevision: inspectedRevision, Payload: current.Local}
	return e.resolve(ctx, r.key(brain), oldID, op, func(tx Tx) error { return r.freezeVersion(ctx, tx, op, version, true) })
}

func (r *Replica) freezeVersion(ctx context.Context, tx Tx, op v1.Operation, version int64, resolving bool) error {
	raw, _ := SQLTransaction(tx)
	key := r.key(op.BrainID)
	current, err := workingPage(ctx, raw, key, op.PageID)
	if err != nil {
		return err
	}
	if current.Version != version || current.Local != op.Payload {
		return ErrLocalVersion
	}
	if current.DraftOperationID != "" && !resolving {
		return ErrDraftPending
	}
	base := current.WorkingBase
	if resolving {
		base = current.Remote
		if base == nil && op.BaseRevision != 0 || base != nil && base.Revision != op.BaseRevision {
			return ErrConflict
		}
	}
	var encoded any
	if base != nil {
		data, _ := json.Marshal(base)
		encoded = data
	}
	args := []any{string(op.OperationID), encoded}
	args = append(args, keyArgs(key)...)
	args = append(args, string(op.PageID))
	if _, err = raw.ExecContext(ctx, `UPDATE replica_pages SET draft_operation_id=?,draft_base_json=? WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, args...); err != nil {
		return err
	}
	args = append(keyArgs(key), string(op.OperationID), string(op.PageID), version)
	_, err = raw.ExecContext(ctx, `INSERT INTO replica_working_operations(organization_id,brain_id,user_id,operation_id,page_id,version) VALUES(?,?,?,?,?,?)`, args...)
	return err
}

func workingReceipt(ctx context.Context, raw *sql.Tx, entry Entry) (bool, error) {
	var schema int
	if err := raw.QueryRowContext(ctx, "SELECT version FROM replica_schema_version WHERE singleton=1").Scan(&schema); err != nil {
		return false, err
	}
	if schema < 2 {
		return false, nil
	}
	var submitted int64
	err := raw.QueryRowContext(ctx, `SELECT version FROM replica_working_operations WHERE organization_id=? AND brain_id=? AND user_id=? AND operation_id=?`, append(keyArgs(entry.Key), string(entry.Operation.OperationID))...).Scan(&submitted)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if entry.Status != Accepted {
		return false, nil
	}
	snapshot := v1.Snapshot{RevisionID: *entry.Receipt.RevisionID, Revision: entry.Receipt.Revision, Content: entry.Operation.Payload}
	if err = cacheSnapshot(ctx, raw, entry.Key, entry.Operation.PageID, snapshot); err != nil {
		return true, err
	}
	page, err := workingPage(ctx, raw, entry.Key, entry.Operation.PageID)
	if err != nil {
		return true, err
	}
	if submitted > page.Version {
		return true, ErrLocalVersion
	}
	local := page.Local
	if page.Version == submitted {
		local = page.Remote.Content
	}
	data, _ := json.Marshal(local)
	base, _ := json.Marshal(page.Remote)
	args := []any{submitted, base, string(entry.GenerationID)}
	args = append(args, keyArgs(entry.Key)...)
	args = append(args, string(entry.Operation.PageID))
	if _, err = raw.ExecContext(ctx, `UPDATE replica_working_pages SET synced_version=max(synced_version,?),base_json=?,generation_id=? WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, args...); err != nil {
		return true, err
	}
	args = []any{data}
	args = append(args, keyArgs(entry.Key)...)
	args = append(args, string(entry.Operation.PageID), string(entry.Operation.OperationID))
	_, err = raw.ExecContext(ctx, `UPDATE replica_pages SET local_json=?,draft_operation_id=NULL,draft_base_json=NULL WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=? AND draft_operation_id=?`, args...)
	return true, err
}
