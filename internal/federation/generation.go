package federation

import (
	"context"
	"database/sql"
	"errors"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func (tx replicaTx) workspace() bool {
	raw, _ := SQLTransaction(tx.Tx)
	var version int
	return raw.QueryRowContext(tx.ctx, "SELECT version FROM replica_schema_version WHERE singleton=1").Scan(&version) == nil && version >= 2
}
func (tx replicaTx) hydrateGeneration(entry *Entry) error {
	if !tx.workspace() {
		return nil
	}
	raw, _ := SQLTransaction(tx.Tx)
	err := raw.QueryRowContext(tx.ctx, `SELECT generation_id FROM replica_operation_generations WHERE organization_id=? AND brain_id=? AND user_id=? AND operation_id=?`, append(keyArgs(entry.Key), string(entry.Operation.OperationID))...).Scan(&entry.GenerationID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var count int
	if err = raw.QueryRowContext(tx.ctx, `SELECT count(*) FROM replica_blocked_operations WHERE organization_id=? AND brain_id=? AND user_id=? AND operation_id=?`, append(keyArgs(entry.Key), string(entry.Operation.OperationID))...).Scan(&count); err != nil {
		return err
	}
	entry.GenerationBlocked = count > 0
	return nil
}

func blockGeneration(ctx context.Context, tx *sql.Tx, key Key, generation v1.ID) error {
	args := append([]any{string(generation)}, keyArgs(key)...)
	if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO replica_generation_blocks SELECT p.organization_id,p.brain_id,p.user_id,p.page_id,? FROM replica_pages p LEFT JOIN replica_working_pages w USING(organization_id,brain_id,user_id,page_id) WHERE p.organization_id=? AND p.brain_id=? AND p.user_id=? AND (p.draft_operation_id IS NOT NULL OR w.version>w.synced_version)`, args...); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO replica_blocked_operations SELECT organization_id,brain_id,user_id,operation_id FROM federation_outbox WHERE organization_id=? AND brain_id=? AND user_id=? AND status IN ('pending','in_flight','suspended')`, keyArgs(key)...)
	return err
}

func (r *Replica) GenerationReview(ctx context.Context, brain, page v1.ID) (bool, error) {
	var count int
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		return raw.QueryRowContext(ctx, `SELECT count(*) FROM replica_generation_blocks WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, append(keyArgs(r.key(brain)), string(page))...).Scan(&count)
	})
	return count > 0, err
}

// ResolveGeneration is an explicit decision against the inspected new server
// snapshot. Old wire operations stay blocked and immutable; no retry is rebased.
func (r *Replica) ResolveGeneration(ctx context.Context, e *Engine, brain, page v1.ID, version, inspectedRevision int64) (Entry, error) {
	if e.Store != r || e.UserID != r.identity.UserID || e.DeviceID != r.identity.DeviceID {
		return Entry{}, ErrAccessDenied
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil {
		return Entry{}, err
	}
	if current.Version != version {
		return Entry{}, ErrLocalVersion
	}
	server := int64(0)
	if current.Remote != nil {
		server = current.Remote.Revision
	}
	if server != inspectedRevision {
		return Entry{}, ErrConflict
	}
	id, err := NewID()
	if err != nil {
		return Entry{}, err
	}
	op := v1.Operation{SchemaVersion: v1.SchemaVersion, OrganizationID: r.identity.OrganizationID, BrainID: brain, PageID: page, DeviceID: r.identity.DeviceID, OperationID: id, BaseRevision: server, Payload: current.Local}
	return e.queue(ctx, r.key(brain), op, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		var exists int
		if err := raw.QueryRowContext(ctx, `SELECT count(*) FROM replica_generation_blocks WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, append(keyArgs(r.key(brain)), string(page))...).Scan(&exists); err != nil {
			return err
		}
		if exists != 1 {
			return ErrConflict
		}
		if err := r.freezeVersion(ctx, tx, op, version, true); err != nil {
			return err
		}
		_, err := raw.ExecContext(ctx, `DELETE FROM replica_generation_blocks WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, append(keyArgs(r.key(brain)), string(page))...)
		return err
	})
}
