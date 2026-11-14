package federation

import (
	"context"
	"database/sql"
	"errors"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

// SelectWorkspace permits explicit read-only replicas, keeping write controls
// separate. MU remains authoritative and rechecks every transferred operation.
func (r *Replica) SelectWorkspace(ctx context.Context, h *HTTPTransport, brain v1.ID) (*Engine, error) {
	if h.Origin() != r.identity.Origin || h.AccountID() != r.identity.UserID {
		return nil, ErrAccessDenied
	}
	e := r.Engine(h)
	key := r.key(brain)
	state, err := e.State(ctx, key)
	if err != nil {
		return nil, err
	}
	authority, err := h.ReadAuthority(ctx, key.OrganizationID, brain)
	if err != nil {
		if state.MembershipEpoch > 0 {
			return nil, r.authorityError(ctx, e, key, state.AccessGeneration, err)
		}
		return nil, err
	}
	err = e.enable(ctx, key, authority.MembershipEpoch, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		args := append(keyArgs(key), authority.CanWrite)
		_, err := raw.ExecContext(ctx, `INSERT INTO replica_selected_authority VALUES(?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id) DO UPDATE SET can_write=excluded.can_write`, args...)
		return err
	})
	return e, err
}
func (r *Replica) CanWrite(ctx context.Context, brain v1.ID) (bool, error) {
	var allowed bool
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		err := raw.QueryRowContext(ctx, `SELECT can_write FROM replica_selected_authority WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(r.key(brain))...).Scan(&allowed)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	})
	return allowed, err
}

func (r *Replica) CachedBrains(ctx context.Context) ([]map[string]any, error) {
	items := []map[string]any{}
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		rows, err := raw.QueryContext(ctx, `SELECT b.brain_id,b.membership_epoch,coalesce(a.can_write,0) FROM federation_brains b LEFT JOIN replica_selected_authority a USING(organization_id,brain_id,user_id) WHERE b.organization_id=? AND b.user_id=? ORDER BY b.brain_id`, string(r.identity.OrganizationID), string(r.identity.UserID))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id v1.ID
			var epoch int64
			var write bool
			if err = rows.Scan(&id, &epoch, &write); err != nil {
				return err
			}
			items = append(items, map[string]any{"organization_id": r.identity.OrganizationID, "brain_id": id, "user_id": r.identity.UserID, "name": "Saved brain " + string(id)[:8], "membership_epoch": epoch, "can_write": write})
		}
		return rows.Err()
	})
	return items, err
}
