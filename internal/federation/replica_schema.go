package federation

import (
	"context"
	_ "embed"
	"errors"
)

//go:embed replica.sql
var replicaSchema string

func (r *Replica) migrate(ctx context.Context, create bool) error {
	if !create {
		var version int
		if err := r.db.QueryRowContext(ctx, "SELECT version FROM replica_schema_version WHERE singleton=1").Scan(&version); err != nil {
			return err
		}
		if version != 1 && version != 2 {
			return errors.New("unsupported replica schema version")
		}
		return nil
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, replicaSchema); err != nil {
		return err
	}
	i := r.identity
	if _, err = tx.ExecContext(ctx, "INSERT INTO replica_identity VALUES(1,?,?,?,?)", string(i.OrganizationID), string(i.UserID), string(i.DeviceID), i.Origin); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, workingSchema); err != nil {
		return err
	}
	return tx.Commit()
}
