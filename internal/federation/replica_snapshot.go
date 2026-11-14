package federation

import (
	"context"
	"errors"
	"os"
	"path/filepath"
)

// ReplicaPreview contains metadata only. No owner mapping/import is supported.
type ReplicaPreview struct {
	Identity   ReplicaIdentity
	Brains     int64
	Pages      int64
	Operations int64
	Conflicts  int64
}

func (r *Replica) Preview(ctx context.Context) (ReplicaPreview, error) {
	result := ReplicaPreview{Identity: r.identity}
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		for query, target := range map[string]*int64{"SELECT count(*) FROM federation_brains": &result.Brains, "SELECT count(*) FROM replica_pages": &result.Pages, "SELECT count(*) FROM federation_outbox": &result.Operations, "SELECT count(*) FROM federation_outbox WHERE status='conflict'": &result.Conflicts} {
			if err := raw.QueryRowContext(ctx, query).Scan(target); err != nil {
				return err
			}
		}
		return nil
	})
	return result, err
}

// Snapshot writes a consistent native SQLite snapshot to a NEW private file,
// verifies its integrity and identity, and disables transfers in that copy.
// Failure leaves the candidate file for inspection and never acknowledges success.
// Rollback uses OpenReplica on the snapshot (or Snapshot again to a new path),
// preserving the original file and requiring explicit fresh selection afterwards.
func (r *Replica) Snapshot(ctx context.Context, destination string) error {
	if !filepath.IsAbs(destination) {
		return errors.New("snapshot path must be absolute")
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(destination))
	if err != nil || parent != filepath.Dir(destination) {
		return errors.New("snapshot directory must exist without symlinks")
	}
	info, err := os.Stat(parent)
	if err != nil || info.Mode().Perm()&0077 != 0 {
		return errors.New("snapshot directory must be private")
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	// The destination is precreated mode0600, avoiding a transient public backup.
	if _, err = r.db.ExecContext(ctx, "VACUUM INTO ?", destination); err != nil {
		return err
	}
	copy, err := OpenReplica(ctx, destination, r.identity, false)
	if err != nil {
		return err
	}
	defer copy.Close()
	var integrity string
	if err = copy.db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil || integrity != "ok" {
		return errors.New("snapshot integrity verification failed")
	}
	if err = copy.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		_, err := raw.ExecContext(ctx, `UPDATE federation_brains SET enabled=0,access_generation=access_generation+1,cursor='',cursor_version=cursor_version+1`)
		return err
	}); err != nil {
		return err
	}
	// Make the acknowledged snapshot standalone, including its disabled state.
	var busy, log, checkpointed int
	if err = copy.db.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &log, &checkpointed); err != nil || busy != 0 || log != 0 {
		return errors.New("snapshot checkpoint verification failed")
	}
	return copy.Close()
}
