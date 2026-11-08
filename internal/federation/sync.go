// Package federation implements an opt-in, storage-independent sync state machine.
// It is not wired to the existing owner workspace or desktop launchers.
package federation

import (
	"context"
	"errors"
	"time"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

var (
	ErrNotFound               = errors.New("federation record not found")
	ErrDisabled               = errors.New("sync is disabled for this brain and account")
	ErrRevoked                = errors.New("sync authority was revoked; reauthorization is required")
	ErrUncertain              = errors.New("remote outcome is uncertain; retry the same persisted operation")
	ErrStaleResponse          = errors.New("response belongs to a superseded local attempt or access generation")
	ErrInvalidReceipt         = errors.New("receipt does not match the persisted operation")
	ErrKeyReuse               = errors.New("operation ID was reused with different content")
	ErrConflict               = errors.New("operation needs explicit conflict resolution")
	ErrCursorConflict         = errors.New("cursor checkpoint changed or is not bound to current membership")
	ErrAccessDenied           = errors.New("remote access denied")
	ErrAuthenticationRequired = errors.New("fresh authentication and write-authority readback are required")
	ErrGenerationReview       = errors.New("server generation changed; inspect the retained writing before creating a new operation")
)

// Key is local routing metadata. UserID is not serialized into a remote operation
// and cannot grant authority; the transport must use that account's delegated identity.
type Key struct {
	OrganizationID v1.ID
	BrainID        v1.ID
	UserID         v1.ID
}

type Status string

const (
	Pending    Status = "pending"
	InFlight   Status = "in_flight"
	Accepted   Status = "accepted"
	Conflicted Status = "conflict"
	Suspended  Status = "suspended"
	Resolved   Status = "resolved"
)

// Entry retains the exact operation through retries and conflict resolution.
type Entry struct {
	Key                   Key
	Operation             v1.Operation
	RequestSHA256         string
	Status                Status
	Attempt               int64
	Receipt               *v1.Receipt
	ResolutionOperationID v1.ID
	LastError             string
	GenerationID          v1.ID
	GenerationBlocked     bool
}

type BrainState struct {
	Enabled          bool
	Revoked          bool
	MembershipEpoch  int64
	AccessGeneration int64
	CursorVersion    int64
	Cursor           string
	GenerationID     v1.ID
}

// Store transactions must be atomic and serialize overlapping local updates.
// A successful transaction means durable storage, not merely an in-memory cache.
type Store interface {
	Transaction(context.Context, func(Tx) error) error
}
type Tx interface {
	Brain(Key) (BrainState, error)
	PutBrain(Key, BrainState) error
	Entry(Key, v1.ID) (Entry, error)
	Entries(Key) ([]Entry, error)
	Insert(Entry) error
	Update(Entry) error
}

type Transport interface {
	Apply(context.Context, v1.Operation) (v1.Receipt, error)
}

type Engine struct {
	Store     Store
	Transport Transport
	UserID    v1.ID
	DeviceID  v1.ID
	Now       func() time.Time
}

func (e *Engine) persistOutcome(ctx context.Context, change func(Tx) error) error {
	// A caller cancellation must not discard an observed receipt, but cleanup is bounded.
	persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	return e.Store.Transaction(persistCtx, change)
}

func (e *Engine) validateKey(key Key) error {
	if e.Store == nil || key.UserID != e.UserID {
		return ErrAccessDenied
	}
	if bound, ok := e.Transport.(interface{ AccountID() v1.ID }); ok && bound.AccountID() != e.UserID {
		return ErrAccessDenied
	}
	for _, id := range []v1.ID{key.OrganizationID, key.BrainID, key.UserID, e.DeviceID} {
		if err := v1.ValidateID(id); err != nil {
			return err
		}
	}
	return nil
}

// Enable must be called only after explicit selection and authenticated membership
// readback. Reauthorizing a revoked brain requires a strictly newer server epoch.
func (e *Engine) Enable(ctx context.Context, key Key, epoch int64) error {
	return e.enable(ctx, key, epoch, nil)
}
func (e *Engine) enable(ctx context.Context, key Key, epoch int64, persist func(Tx) error) error {
	if err := e.validateKey(key); err != nil {
		return err
	}
	if epoch < 1 || epoch > v1.MaxRevision {
		return ErrRevoked
	}
	return e.Store.Transaction(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if epoch < state.MembershipEpoch || (state.Revoked && epoch <= state.MembershipEpoch) {
			return ErrRevoked
		}
		if epoch != state.MembershipEpoch || state.Revoked || !state.Enabled {
			state.Cursor = ""
			state.CursorVersion++
			state.AccessGeneration++
		}
		state.Enabled = true
		state.Revoked = false
		state.MembershipEpoch = epoch
		if err = tx.PutBrain(key, state); err != nil {
			return err
		}
		entries, err := tx.Entries(key)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Status == Suspended && !entry.GenerationBlocked {
				entry.Status = Pending
				entry.LastError = ""
				if err = tx.Update(entry); err != nil {
					return err
				}
			}
		}
		if persist != nil {
			return persist(tx)
		}
		return nil
	})
}

func (e *Engine) Disable(ctx context.Context, key Key) error {
	if err := e.validateKey(key); err != nil {
		return err
	}
	return e.Store.Transaction(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		state.Enabled = false
		return tx.PutBrain(key, state)
	})
}

// Queue acknowledges only the store transaction. UI adapters must arrange their
// local note update and this insert in the same SQLite transaction before autosave acknowledgment.
func (e *Engine) Queue(ctx context.Context, key Key, op v1.Operation) (Entry, error) {
	return e.queue(ctx, key, op, nil)
}

func (e *Engine) queue(ctx context.Context, key Key, op v1.Operation, edit func(Tx) error) (Entry, error) {
	if err := e.validateOperation(key, op); err != nil {
		return Entry{}, err
	}
	hash, err := v1.OperationDigest(op)
	if err != nil {
		return Entry{}, err
	}
	entry := Entry{Key: key, Operation: op, RequestSHA256: hash, Status: Pending}
	err = e.Store.Transaction(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if errors.Is(err, ErrNotFound) {
			return ErrDisabled
		}
		if err != nil {
			return err
		}
		if state.Revoked {
			return ErrRevoked
		}
		if !state.Enabled {
			return ErrDisabled
		}
		entry.GenerationID = state.GenerationID
		old, err := tx.Entry(key, op.OperationID)
		if err == nil {
			if old.RequestSHA256 != hash {
				return ErrKeyReuse
			}
			entry = old
			return nil
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		if err := tx.Insert(entry); err != nil {
			return err
		}
		if edit != nil {
			return edit(tx)
		}
		return nil
	})
	return entry, err
}

func (e *Engine) validateOperation(key Key, op v1.Operation) error {
	if err := e.validateKey(key); err != nil {
		return err
	}
	if err := op.Validate(); err != nil {
		return err
	}
	if _, err := v1.EncodeOperation(op); err != nil {
		return err
	}
	if op.OrganizationID != key.OrganizationID || op.BrainID != key.BrainID || op.DeviceID != e.DeviceID {
		return ErrAccessDenied
	}
	return nil
}

func (e *Engine) State(ctx context.Context, key Key) (BrainState, error) {
	if err := e.validateKey(key); err != nil {
		return BrainState{}, err
	}
	var state BrainState
	err := e.Store.Transaction(ctx, func(tx Tx) error {
		var err error
		state, err = tx.Brain(key)
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	})
	return state, err
}

func (e *Engine) Entry(ctx context.Context, key Key, id v1.ID) (Entry, error) {
	if err := e.validateKey(key); err != nil {
		return Entry{}, err
	}
	var entry Entry
	err := e.Store.Transaction(ctx, func(tx Tx) error { var err error; entry, err = tx.Entry(key, id); return err })
	return entry, err
}

// ProcessOne sends a persisted operation outside the local transaction. An uncertain
// or interrupted attempt is retried with the same ID/content, including after restart.
// Overlapping attempts may duplicate transport requests, never the logical remote operation;
// the newer local attempt fences stale replies. Server idempotency is mandatory.
func (e *Engine) ProcessOne(ctx context.Context, key Key) (bool, error) {
	if err := e.validateKey(key); err != nil {
		return false, err
	}
	if e.Transport == nil {
		return false, errors.New("sync transport is unavailable")
	}
	var selected Entry
	var generation int64
	var membershipEpoch int64
	found := false
	err := e.Store.Transaction(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if errors.Is(err, ErrNotFound) {
			return ErrDisabled
		}
		if err != nil {
			return err
		}
		if state.Revoked {
			return ErrRevoked
		}
		if !state.Enabled {
			return ErrDisabled
		}
		entries, err := tx.Entries(key)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if (entry.Status == Pending || entry.Status == InFlight) && !entry.GenerationBlocked {
				selected = entry
				found = true
				break
			}
		}
		if !found {
			return nil
		}
		if selected.Key != key {
			return ErrAccessDenied
		}
		if fenced, ok := e.Transport.(interface{ RequiresGeneration() bool }); ok && fenced.RequiresGeneration() && selected.GenerationID == "" {
			return ErrGenerationReview
		}
		if err = e.validateOperation(key, selected.Operation); err != nil {
			return err
		}
		digest, err := v1.OperationDigest(selected.Operation)
		if err != nil || digest != selected.RequestSHA256 {
			return ErrKeyReuse
		}
		if selected.Attempt >= v1.MaxRevision {
			return ErrStaleResponse
		}
		selected.Attempt++
		selected.Status = InFlight
		selected.LastError = ""
		generation = state.AccessGeneration
		membershipEpoch = state.MembershipEpoch
		return tx.Update(selected)
	})
	if err != nil || !found {
		return found, err
	}
	var receipt v1.Receipt
	var remoteErr error
	if fenced, ok := e.Transport.(interface {
		RequiresGeneration() bool
		ApplyWithGeneration(context.Context, v1.Operation, v1.ID) (v1.Receipt, error)
	}); ok && fenced.RequiresGeneration() {
		receipt, remoteErr = fenced.ApplyWithGeneration(ctx, selected.Operation, selected.GenerationID)
	} else {
		receipt, remoteErr = e.Transport.Apply(ctx, selected.Operation)
	}
	if errors.Is(remoteErr, ErrAuthenticationRequired) {
		return true, e.pauseAuthentication(ctx, key, selected, generation)
	}
	if errors.Is(remoteErr, ErrAccessDenied) {
		return true, e.revoke(ctx, key, generation)
	}
	if remoteErr != nil {
		err = e.persistOutcome(ctx, func(tx Tx) error {
			state, err := tx.Brain(key)
			if err != nil {
				return err
			}
			old, err := tx.Entry(key, selected.Operation.OperationID)
			if err != nil {
				return err
			}
			if state.AccessGeneration != generation || old.Attempt != selected.Attempt {
				return ErrStaleResponse
			}
			old.Status = Pending
			old.LastError = "transport_uncertain"
			return tx.Update(old)
		})
		if err != nil {
			return true, err
		}
		if errors.Is(remoteErr, ErrCursorReset) {
			return true, ErrCursorReset
		}
		return true, ErrUncertain
	}
	if receipt.Validate() != nil || !receipt.Matches(selected.Operation) || (receipt.Outcome == v1.Accepted && receipt.Revision != selected.Operation.BaseRevision+1) {
		return true, ErrInvalidReceipt
	}
	err = e.persistOutcome(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil {
			return err
		}
		old, err := tx.Entry(key, selected.Operation.OperationID)
		if err != nil {
			return err
		}
		if state.Revoked || old.Attempt != selected.Attempt {
			return ErrStaleResponse
		}
		// A historical accepted receipt carries no remote writing. Keep it across an
		// explicit same-membership re-enable so a known accepted operation is not lost.
		// Conflict content and changed-membership responses still require a fresh replay.
		historicalAccepted := receipt.Outcome == v1.Accepted && state.MembershipEpoch == membershipEpoch
		if state.AccessGeneration != generation && !historicalAccepted {
			return ErrStaleResponse
		}
		if old.Status != InFlight && !(historicalAccepted && (old.Status == Pending || old.Status == Suspended)) {
			return ErrStaleResponse
		}
		old.Receipt = &receipt
		old.LastError = ""
		if receipt.Outcome == v1.Accepted {
			old.Status = Accepted
		} else {
			old.Status = Conflicted
		}
		return tx.Update(old)
	})
	if err != nil {
		return true, err
	}
	if receipt.Outcome == v1.Conflicted {
		return true, ErrConflict
	}
	return true, nil
}

func (e *Engine) pauseAuthentication(ctx context.Context, key Key, selected Entry, generation int64) error {
	err := e.persistOutcome(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil {
			return err
		}
		current, err := tx.Entry(key, selected.Operation.OperationID)
		if err != nil {
			return err
		}
		if state.AccessGeneration != generation || current.Attempt != selected.Attempt || current.Status != InFlight {
			return ErrStaleResponse
		}
		state.Enabled = false
		state.AccessGeneration++
		if err = tx.PutBrain(key, state); err != nil {
			return err
		}
		entries, err := tx.Entries(key)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Status == Pending || entry.Status == InFlight {
				entry.Status = Suspended
				entry.LastError = "authentication_required"
				if err = tx.Update(entry); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return ErrAuthenticationRequired
}

func (e *Engine) revoke(ctx context.Context, key Key, generation int64) error {
	err := e.persistOutcome(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil {
			return err
		}
		if state.AccessGeneration != generation {
			return ErrStaleResponse
		}
		state.Enabled = false
		state.Revoked = true
		state.Cursor = ""
		state.CursorVersion++
		state.AccessGeneration++
		if err = tx.PutBrain(key, state); err != nil {
			return err
		}
		entries, err := tx.Entries(key)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Status == Pending || entry.Status == InFlight {
				entry.Status = Suspended
				entry.LastError = "access_denied"
				if err = tx.Update(entry); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return ErrRevoked
}

// Resolve is an explicit user decision against the exact inspected server snapshot.
// The old operation and all conflict versions remain; resolution is a new operation.
func (e *Engine) Resolve(ctx context.Context, key Key, oldID v1.ID, next v1.Operation) (Entry, error) {
	return e.resolve(ctx, key, oldID, next, nil)
}

func (e *Engine) resolve(ctx context.Context, key Key, oldID v1.ID, next v1.Operation, edit func(Tx) error) (Entry, error) {
	if err := e.validateOperation(key, next); err != nil {
		return Entry{}, err
	}
	if oldID == next.OperationID {
		return Entry{}, ErrKeyReuse
	}
	hash, err := v1.OperationDigest(next)
	if err != nil {
		return Entry{}, err
	}
	created := Entry{Key: key, Operation: next, RequestSHA256: hash, Status: Pending}
	err = e.Store.Transaction(ctx, func(tx Tx) error {
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
		created.GenerationID = state.GenerationID
		old, err := tx.Entry(key, oldID)
		if err != nil {
			return err
		}
		if old.Status == Resolved && old.ResolutionOperationID == next.OperationID {
			existing, err := tx.Entry(key, next.OperationID)
			if err != nil {
				return err
			}
			if existing.RequestSHA256 != hash {
				return ErrKeyReuse
			}
			created = existing
			return nil
		}
		if old.Status != Conflicted || old.Receipt == nil || old.Receipt.Conflict == nil {
			return ErrConflict
		}
		serverRevision := int64(0)
		if old.Receipt.Conflict.Server != nil {
			serverRevision = old.Receipt.Conflict.Server.Revision
		}
		if next.PageID != old.Operation.PageID || next.BaseRevision != serverRevision {
			return ErrConflict
		}
		if err = tx.Insert(created); err != nil {
			return err
		}
		old.Status = Resolved
		old.ResolutionOperationID = next.OperationID
		if err := tx.Update(old); err != nil {
			return err
		}
		if edit != nil {
			return edit(tx)
		}
		return nil
	})
	return created, err
}

// CommitPullBatch persists replica changes and the checkpoint in one store transaction.
// The adapter callback must use the supplied transaction, not a separate connection.
// It never interprets an opaque cursor as authority or validates a server signature.
func (e *Engine) CommitPullBatch(ctx context.Context, key Key, expectedVersion int64, binding v1.Cursor, opaque string, persist func(Tx) error) error {
	if err := e.validateKey(key); err != nil {
		return err
	}
	if persist == nil {
		return errors.New("pull batch persistence callback is required")
	}
	if err := binding.Validate(); err != nil {
		return err
	}
	now := time.Now()
	if e.Now != nil {
		now = e.Now()
	}
	expiry, err := time.Parse(time.RFC3339Nano, binding.ExpiresAt)
	if err != nil || !expiry.After(now) || len(opaque) == 0 || len(opaque) > 8192 || binding.OrganizationID != key.OrganizationID || binding.BrainID != key.BrainID || binding.UserID != key.UserID {
		return ErrCursorConflict
	}
	return e.Store.Transaction(ctx, func(tx Tx) error {
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
		if state.CursorVersion != expectedVersion || state.MembershipEpoch != binding.MembershipEpoch {
			return ErrCursorConflict
		}
		if err = persist(tx); err != nil {
			return err
		}
		state.Cursor = opaque
		state.CursorVersion++
		return tx.PutBrain(key, state)
	})
}
