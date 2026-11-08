package federation

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

//go:embed sqlite.sql
var SQLiteSchema string

// SQLiteStore uses a caller-supplied SQLite driver. No driver is imported or
// registered here. Integrating and approving that driver is a separate milestone.
type SQLiteStore struct{ DB *sql.DB }

func enableSQLiteForeignKeys(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
		return err
	}
	var enabled int
	if err := conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&enabled); err != nil {
		return err
	}
	if enabled != 1 {
		return errors.New("SQLite foreign-key enforcement is required")
	}
	return nil
}

func (s SQLiteStore) Migrate(ctx context.Context) error {
	if s.DB == nil {
		return errors.New("SQLite database is required")
	}
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err = enableSQLiteForeignKeys(ctx, conn); err != nil {
		return err
	}
	var exists int
	if err = conn.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='federation_schema_version'").Scan(&exists); err != nil {
		return err
	}
	if exists != 0 {
		var version int
		if err = conn.QueryRowContext(ctx, "SELECT version FROM federation_schema_version WHERE singleton=1").Scan(&version); err != nil {
			return err
		}
		if version != 1 {
			return errors.New("unsupported federation SQLite schema version")
		}
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, SQLiteSchema); err != nil {
		return err
	}
	return tx.Commit()
}

func (s SQLiteStore) Transaction(ctx context.Context, change func(Tx) error) error {
	if s.DB == nil {
		return errors.New("SQLite database is required")
	}
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	// Foreign-key enforcement is per connection, not a one-time migration setting.
	if err = enableSQLiteForeignKeys(ctx, conn); err != nil {
		return err
	}
	if _, err = conn.ExecContext(ctx, "PRAGMA busy_timeout=5000"); err != nil {
		return err
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = change(sqliteTx{ctx, tx}); err != nil {
		return err
	}
	return tx.Commit()
}

type sqliteTx struct {
	ctx context.Context
	tx  *sql.Tx
}

// SQLTransaction exposes the active SQLite transaction to a future replica adapter.
// Use it only for statements inside a Store callback; the Store owns commit/rollback.
func SQLTransaction(tx Tx) (*sql.Tx, bool) {
	if replica, ok := tx.(replicaTx); ok {
		tx = replica.Tx
	}
	sqlite, ok := tx.(sqliteTx)
	return sqlite.tx, ok
}

func keyArgs(key Key) []any {
	return []any{string(key.OrganizationID), string(key.BrainID), string(key.UserID)}
}
func (s sqliteTx) Brain(key Key) (BrainState, error) {
	var state BrainState
	err := s.tx.QueryRowContext(s.ctx, "SELECT enabled,revoked,membership_epoch,access_generation,cursor_version,cursor FROM federation_brains WHERE organization_id=? AND brain_id=? AND user_id=?", keyArgs(key)...).Scan(&state.Enabled, &state.Revoked, &state.MembershipEpoch, &state.AccessGeneration, &state.CursorVersion, &state.Cursor)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return state, err
}
func (s sqliteTx) PutBrain(key Key, state BrainState) error {
	args := append(keyArgs(key), state.Enabled, state.Revoked, state.MembershipEpoch, state.AccessGeneration, state.CursorVersion, state.Cursor)
	_, err := s.tx.ExecContext(s.ctx, `INSERT INTO federation_brains(organization_id,brain_id,user_id,enabled,revoked,membership_epoch,access_generation,cursor_version,cursor) VALUES(?,?,?,?,?,?,?,?,?)
 ON CONFLICT(organization_id,brain_id,user_id) DO UPDATE SET enabled=excluded.enabled,revoked=excluded.revoked,membership_epoch=excluded.membership_epoch,access_generation=excluded.access_generation,cursor_version=excluded.cursor_version,cursor=excluded.cursor`, args...)
	return err
}

const entryColumns = "operation_json,request_sha256,status,attempt,receipt_json,resolution_operation_id,error_code"

func scanEntry(key Key, scan func(...any) error) (Entry, error) {
	var entry Entry
	entry.Key = key
	var operation, receipt []byte
	var resolution sql.NullString
	err := scan(&operation, &entry.RequestSHA256, &entry.Status, &entry.Attempt, &receipt, &resolution, &entry.LastError)
	if errors.Is(err, sql.ErrNoRows) {
		return entry, ErrNotFound
	}
	if err != nil {
		return entry, err
	}
	entry.Operation, err = v1.DecodeOperation(operation)
	if err != nil {
		return entry, errors.New("stored federation operation failed contract validation")
	}
	if entry.Operation.OrganizationID != key.OrganizationID || entry.Operation.BrainID != key.BrainID {
		return entry, ErrAccessDenied
	}
	digest, err := v1.OperationDigest(entry.Operation)
	if err != nil || digest != entry.RequestSHA256 {
		return entry, ErrKeyReuse
	}
	if resolution.Valid {
		entry.ResolutionOperationID = v1.ID(resolution.String)
	}
	if receipt != nil {
		var r v1.Receipt
		if json.Unmarshal(receipt, &r) != nil || r.Validate() != nil || !r.Matches(entry.Operation) {
			return entry, ErrInvalidReceipt
		}
		entry.Receipt = &r
	}
	return entry, nil
}
func (s sqliteTx) Entry(key Key, id v1.ID) (Entry, error) {
	args := append(keyArgs(key), string(id))
	return scanEntry(key, s.tx.QueryRowContext(s.ctx, "SELECT "+entryColumns+" FROM federation_outbox WHERE organization_id=? AND brain_id=? AND user_id=? AND operation_id=?", args...).Scan)
}
func (s sqliteTx) Entries(key Key) ([]Entry, error) {
	rows, err := s.tx.QueryContext(s.ctx, "SELECT "+entryColumns+" FROM federation_outbox WHERE organization_id=? AND brain_id=? AND user_id=? ORDER BY enqueue_order", keyArgs(key)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []Entry
	for rows.Next() {
		entry, err := scanEntry(key, rows.Scan)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}
func entryArgs(entry Entry) ([]any, error) {
	operation, err := v1.EncodeOperation(entry.Operation)
	if err != nil {
		return nil, err
	}
	var receipt any
	if entry.Receipt != nil {
		encoded, err := json.Marshal(entry.Receipt)
		if err != nil {
			return nil, err
		}
		receipt = encoded
	}
	var resolution any
	if entry.ResolutionOperationID != "" {
		resolution = string(entry.ResolutionOperationID)
	}
	return []any{operation, entry.RequestSHA256, string(entry.Status), entry.Attempt, receipt, resolution, entry.LastError}, nil
}
func (s sqliteTx) Insert(entry Entry) error {
	values, err := entryArgs(entry)
	if err != nil {
		return err
	}
	args := append(keyArgs(entry.Key), string(entry.Operation.OperationID))
	args = append(args, values...)
	_, err = s.tx.ExecContext(s.ctx, "INSERT INTO federation_outbox(organization_id,brain_id,user_id,operation_id,"+entryColumns+") VALUES(?,?,?,?,?,?,?,?,?,?,?)", args...)
	return err
}
func (s sqliteTx) Update(entry Entry) error {
	values, err := entryArgs(entry)
	if err != nil {
		return err
	}
	args := append(values, keyArgs(entry.Key)...)
	args = append(args, string(entry.Operation.OperationID))
	result, err := s.tx.ExecContext(s.ctx, "UPDATE federation_outbox SET operation_json=?,request_sha256=?,status=?,attempt=?,receipt_json=?,resolution_operation_id=?,error_code=? WHERE organization_id=? AND brain_id=? AND user_id=? AND operation_id=?", args...)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("%w: update affected unexpected row count", ErrNotFound)
	}
	return nil
}
