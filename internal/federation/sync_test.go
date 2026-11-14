package federation

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

const (
	org      v1.ID = "11111111-1111-4111-8111-111111111111"
	brain    v1.ID = "22222222-2222-4222-8222-222222222222"
	user     v1.ID = "33333333-3333-4333-8333-333333333333"
	device   v1.ID = "44444444-4444-4444-8444-444444444444"
	page     v1.ID = "55555555-5555-4555-8555-555555555555"
	op1      v1.ID = "66666666-6666-4666-8666-666666666666"
	op2      v1.ID = "77777777-7777-4777-8777-777777777777"
	revision v1.ID = "88888888-8888-4888-8888-888888888888"
	event    v1.ID = "99999999-9999-4999-8999-999999999999"
)

var testKey = Key{org, brain, user}

func operation(id v1.ID, base int64, body string) v1.Operation {
	return v1.Operation{SchemaVersion: v1.SchemaVersion, OrganizationID: org, BrainID: brain, OperationID: id, DeviceID: device, PageID: page, BaseRevision: base, Payload: v1.PageContent{Title: "Synthetic writing", Body: body, State: v1.Active}}
}
func accepted(op v1.Operation) v1.Receipt {
	hash, _ := v1.OperationDigest(op)
	rid, eid := revision, event
	return v1.Receipt{SchemaVersion: v1.SchemaVersion, OrganizationID: op.OrganizationID, BrainID: op.BrainID, OperationID: op.OperationID, DeviceID: op.DeviceID, PageID: op.PageID, RequestSHA256: hash, Outcome: v1.Accepted, RevisionID: &rid, Revision: op.BaseRevision + 1, EventID: &eid}
}

type transportFunc func(context.Context, v1.Operation) (v1.Receipt, error)

func (f transportFunc) Apply(c context.Context, o v1.Operation) (v1.Receipt, error) { return f(c, o) }
func engine(store Store, transport Transport) *Engine {
	return &Engine{Store: store, Transport: transport, UserID: user, DeviceID: device}
}
func enable(t *testing.T, e *Engine) {
	t.Helper()
	if err := e.Enable(context.Background(), testKey, 1); err != nil {
		t.Fatal(err)
	}
}

func TestDisabledSyncSendsNothing(t *testing.T) {
	store := newMemoryStore()
	var calls atomic.Int64
	e := engine(store, transportFunc(func(context.Context, v1.Operation) (v1.Receipt, error) { calls.Add(1); return v1.Receipt{}, nil }))
	if _, err := e.Queue(context.Background(), testKey, operation(op1, 0, "private writing")); !errors.Is(err, ErrDisabled) {
		t.Fatal(err)
	}
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrDisabled) {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatal("disabled sync reached transport")
	}
	if len(store.brains) != 0 || len(store.entries) != 0 {
		t.Fatal("disabled sync mutated storage")
	}
}

func TestTimeoutAndRestartReusePersistedOperation(t *testing.T) {
	store := newMemoryStore()
	var sent []v1.Operation
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		sent = append(sent, op)
		if len(sent) == 1 {
			return accepted(op), context.DeadlineExceeded
		}
		return accepted(op), nil
	}))
	enable(t, e)
	op := operation(op1, 0, "Exact العربية\r\n日本語 👩🏽‍💻 e\u0301 writing")
	if _, err := e.Queue(context.Background(), testKey, op); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrUncertain) {
		t.Fatal(err)
	}
	pending, _ := e.Entry(context.Background(), testKey, op1)
	if pending.Status != Pending || pending.Receipt != nil || pending.Operation != op {
		t.Fatal("uncertainty changed pending writing")
	}
	restarted := engine(store, e.Transport)
	if _, err := restarted.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	saved, _ := e.Entry(context.Background(), testKey, op1)
	if saved.Status != Accepted || len(sent) != 2 || sent[0] != sent[1] || saved.Attempt != 2 {
		t.Fatal("restart did not replay the exact operation")
	}
	changed := op
	changed.Payload.Body = "different"
	if _, err := e.Queue(context.Background(), testKey, changed); !errors.Is(err, ErrKeyReuse) {
		t.Fatal(err)
	}
}

func TestAcknowledgmentWaitsForLocalCommit(t *testing.T) {
	store := newMemoryStore()
	var calls int
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		calls++
		if calls == 1 {
			store.failNext = true
		}
		return accepted(op), nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "Synthetic"))
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, errCommit) {
		t.Fatal(err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != InFlight || entry.Receipt != nil {
		t.Fatal("failed local commit acknowledged remote work")
	}
	if _, err := engine(store, e.Transport).ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	entry, _ = e.Entry(context.Background(), testKey, op1)
	if entry.Status != Accepted || calls != 2 {
		t.Fatal("in-flight restart lost its operation")
	}
}

func TestConflictPreservesVersionsAndRequiresExplicitNewOperation(t *testing.T) {
	store := newMemoryStore()
	op := operation(op1, 1, "Local exact\r\nالعربية")
	base := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Base", Body: "Base body", State: v1.Active}}
	server := v1.Snapshot{RevisionID: event, Revision: 2, Content: v1.PageContent{Title: "Server", Body: "Other writer", State: v1.Active}}
	e := engine(store, transportFunc(func(_ context.Context, o v1.Operation) (v1.Receipt, error) {
		if o.OperationID == op2 {
			return accepted(o), nil
		}
		hash, _ := v1.OperationDigest(o)
		return v1.Receipt{SchemaVersion: v1.SchemaVersion, OrganizationID: org, BrainID: brain, OperationID: o.OperationID, DeviceID: device, PageID: page, RequestSHA256: hash, Outcome: v1.Conflicted, Conflict: &v1.Conflict{Base: &base, Local: o.Payload, Server: &server}}, nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, op)
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	old, _ := e.Entry(context.Background(), testKey, op1)
	if old.Status != Conflicted || old.Operation != op || !reflect.DeepEqual(old.Receipt.Conflict, &v1.Conflict{Base: &base, Local: op.Payload, Server: &server}) {
		t.Fatal("conflict versions were not preserved")
	}
	if found, err := e.ProcessOne(context.Background(), testKey); found || err != nil {
		t.Fatal("conflict was retried without a decision", err)
	}
	next := operation(op2, 1, "Merged")
	if _, err := e.Resolve(context.Background(), testKey, op1, next); !errors.Is(err, ErrConflict) {
		t.Fatal("uninspected base accepted", err)
	}
	next.BaseRevision = 2
	if _, err := e.Resolve(context.Background(), testKey, op1, next); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Resolve(context.Background(), testKey, op1, next); err != nil {
		t.Fatal("resolution replay not idempotent", err)
	}
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	old, _ = e.Entry(context.Background(), testKey, op1)
	resolved, _ := e.Entry(context.Background(), testKey, op2)
	if old.Status != Resolved || old.Receipt.Conflict.Local != op.Payload || old.ResolutionOperationID != op2 || resolved.Status != Accepted {
		t.Fatal("resolution rewrote conflict evidence")
	}
}

func TestRevocationSuspendsPendingAndRequiresNewEpoch(t *testing.T) {
	store := newMemoryStore()
	var calls int
	e := engine(store, transportFunc(func(context.Context, v1.Operation) (v1.Receipt, error) { calls++; return v1.Receipt{}, ErrAccessDenied }))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "one"))
	_, _ = e.Queue(context.Background(), testKey, operation(op2, 0, "two"))
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrRevoked) {
		t.Fatal(err)
	}
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrRevoked) || calls != 1 {
		t.Fatal("revoked client sent another request", err)
	}
	for _, id := range []v1.ID{op1, op2} {
		entry, _ := e.Entry(context.Background(), testKey, id)
		if entry.Status != Suspended || entry.Receipt != nil {
			t.Fatal("revocation deleted or acknowledged writing")
		}
	}
	if err := e.Enable(context.Background(), testKey, 1); !errors.Is(err, ErrRevoked) {
		t.Fatal("stale membership resumed", err)
	}
	if err := e.Enable(context.Background(), testKey, 2); err != nil {
		t.Fatal(err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != Pending || entry.Operation.OperationID != op1 {
		t.Fatal("reauthorization changed operation identity")
	}
}

func TestRevocationFencesDelayedReceipt(t *testing.T) {
	store := newMemoryStore()
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int64
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return accepted(op), nil
		}
		return v1.Receipt{}, ErrAccessDenied
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "retain me"))
	first := make(chan error, 1)
	go func() { _, err := e.ProcessOne(context.Background(), testKey); first <- err }()
	<-started
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrRevoked) {
		t.Fatal(err)
	}
	close(release)
	if err := <-first; !errors.Is(err, ErrStaleResponse) {
		t.Fatal("delayed receipt survived revocation", err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != Suspended || entry.Receipt != nil {
		t.Fatal("stale reply advanced state")
	}
}

func TestNewerAttemptFencesDelayedDuplicateReceipt(t *testing.T) {
	store := newMemoryStore()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
		}
		return accepted(op), nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "exact operation"))
	first := make(chan error, 1)
	go func() { _, err := e.ProcessOne(context.Background(), testKey); first <- err }()
	<-started
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-first; !errors.Is(err, ErrStaleResponse) {
		t.Fatal("superseded response was applied", err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != Accepted || entry.Attempt != 2 || entry.Receipt == nil {
		t.Fatal("newer acknowledgment was replaced")
	}
}

func TestOldAccessDenialCannotRevokeNewMembershipGeneration(t *testing.T) {
	store := newMemoryStore()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return v1.Receipt{}, ErrAccessDenied
		}
		return accepted(op), nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "retained writing"))
	first := make(chan error, 1)
	go func() { _, err := e.ProcessOne(context.Background(), testKey); first <- err }()
	<-started
	if err := e.Enable(context.Background(), testKey, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-first; !errors.Is(err, ErrStaleResponse) {
		t.Fatal("old denial affected reauthorized state", err)
	}
	state, _ := e.State(context.Background(), testKey)
	if !state.Enabled || state.Revoked || state.MembershipEpoch != 2 {
		t.Fatal("old denial revoked new membership")
	}
}

func checkpoint(e *Engine, ctx context.Context, key Key, version int64, binding v1.Cursor, opaque string) error {
	return e.CommitPullBatch(ctx, key, version, binding, opaque, func(Tx) error { return nil })
}

func TestCursorBindingExpiryAndCompareAndSet(t *testing.T) {
	store := newMemoryStore()
	e := engine(store, nil)
	now := time.Date(2026, 11, 7, 2, 0, 0, 0, time.UTC)
	e.Now = func() time.Time { return now }
	enable(t, e)
	state, _ := e.State(context.Background(), testKey)
	cursor := v1.Cursor{SchemaVersion: v1.SchemaVersion, OrganizationID: org, BrainID: brain, UserID: user, MembershipEpoch: 1, ExpiresAt: now.Add(time.Hour).Format(time.RFC3339)}
	if err := checkpoint(e, context.Background(), testKey, state.CursorVersion, cursor, "opaque-A"); err != nil {
		t.Fatal(err)
	}
	if err := checkpoint(e, context.Background(), testKey, state.CursorVersion, cursor, "stale"); !errors.Is(err, ErrCursorConflict) {
		t.Fatal(err)
	}
	state, _ = e.State(context.Background(), testKey)
	wrong := cursor
	wrong.UserID = device
	if err := checkpoint(e, context.Background(), testKey, state.CursorVersion, wrong, "wrong-user"); !errors.Is(err, ErrCursorConflict) {
		t.Fatal(err)
	}
	wrong = cursor
	wrong.MembershipEpoch = 2
	if err := checkpoint(e, context.Background(), testKey, state.CursorVersion, wrong, "wrong-epoch"); !errors.Is(err, ErrCursorConflict) {
		t.Fatal(err)
	}
	wrong = cursor
	wrong.ExpiresAt = now.Format(time.RFC3339)
	if err := checkpoint(e, context.Background(), testKey, state.CursorVersion, wrong, "expired"); !errors.Is(err, ErrCursorConflict) {
		t.Fatal(err)
	}
	unchanged, _ := e.State(context.Background(), testKey)
	if unchanged.Cursor != "opaque-A" || unchanged.CursorVersion != state.CursorVersion {
		t.Fatal("invalid cursor advanced checkpoint")
	}
	if err := e.Enable(context.Background(), testKey, 2); err != nil {
		t.Fatal(err)
	}
	state, _ = e.State(context.Background(), testKey)
	if state.Cursor != "" {
		t.Fatal("membership change retained cursor")
	}
	if err := checkpoint(e, context.Background(), testKey, state.CursorVersion, cursor, "old-epoch"); !errors.Is(err, ErrCursorConflict) {
		t.Fatal(err)
	}
}

func TestWrongReceiptAndAccountCannotAcknowledge(t *testing.T) {
	store := newMemoryStore()
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		r := accepted(op)
		r.OperationID = op2
		return r, nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "keep exact"))
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrInvalidReceipt) {
		t.Fatal(err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != InFlight || entry.Receipt != nil {
		t.Fatal("mismatched receipt was applied")
	}
	other := *e
	other.UserID = device
	if _, err := other.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrAccessDenied) {
		t.Fatal("switched account touched another outbox", err)
	}
}

func TestCorruptStoredScopeCannotReachTransport(t *testing.T) {
	store := newMemoryStore()
	var calls int
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) { calls++; return accepted(op), nil }))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "keep private"))
	store.mu.Lock()
	entry := store.entries[testKey][op1]
	entry.Operation.BrainID = device
	store.entries[testKey][op1] = entry
	store.mu.Unlock()
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrAccessDenied) || calls != 0 {
		t.Fatal("corrupt local routing reached transport", err)
	}
}

func TestPullBatchFailureCannotAdvanceCursor(t *testing.T) {
	store := newMemoryStore()
	e := engine(store, nil)
	now := time.Date(2026, 11, 7, 2, 0, 0, 0, time.UTC)
	e.Now = func() time.Time { return now }
	enable(t, e)
	state, _ := e.State(context.Background(), testKey)
	cursor := v1.Cursor{SchemaVersion: v1.SchemaVersion, OrganizationID: org, BrainID: brain, UserID: user, MembershipEpoch: 1, ExpiresAt: now.Add(time.Hour).Format(time.RFC3339)}
	op := operation(op1, 0, "synthetic batch marker")
	hash, _ := v1.OperationDigest(op)
	err := e.CommitPullBatch(context.Background(), testKey, state.CursorVersion, cursor, "next", func(tx Tx) error {
		if err := tx.Insert(Entry{Key: testKey, Operation: op, RequestSHA256: hash, Status: Pending}); err != nil {
			return err
		}
		return errCommit
	})
	if !errors.Is(err, errCommit) {
		t.Fatal(err)
	}
	unchanged, _ := e.State(context.Background(), testKey)
	if unchanged.Cursor != "" || unchanged.CursorVersion != state.CursorVersion {
		t.Fatal("cursor advanced past uncommitted batch")
	}
	if _, err = e.Entry(context.Background(), testKey, op1); !errors.Is(err, ErrNotFound) {
		t.Fatal("failed batch mutation escaped transaction", err)
	}
}

func TestDisableStopsNewWorkButPersistsAlreadyAcceptedReceipt(t *testing.T) {
	store := newMemoryStore()
	var e *Engine
	e = engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		if err := e.Disable(context.Background(), testKey); err != nil {
			return v1.Receipt{}, err
		}
		return accepted(op), nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "one"))
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != Accepted {
		t.Fatal("disabling lost a committed remote receipt")
	}
	if _, err := e.Queue(context.Background(), testKey, operation(op2, 0, "two")); !errors.Is(err, ErrDisabled) {
		t.Fatal(err)
	}
}

func TestExpiredAuthenticationPausesAndExplicitlyResumesSameEpoch(t *testing.T) {
	store := newMemoryStore()
	var calls int
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		calls++
		if calls == 1 {
			return v1.Receipt{}, ErrAuthenticationRequired
		}
		return accepted(op), nil
	}))
	enable(t, e)
	op := operation(op1, 0, "preserve pending writing")
	_, _ = e.Queue(context.Background(), testKey, op)
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrAuthenticationRequired) {
		t.Fatal(err)
	}
	state, _ := e.State(context.Background(), testKey)
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if state.Enabled || state.Revoked || entry.Status != Suspended || entry.Operation != op || entry.LastError != "authentication_required" {
		t.Fatal("expired login was confused with revoked membership")
	}
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrDisabled) || calls != 1 {
		t.Fatal("paused authentication retried automatically", err)
	}
	if err := e.Enable(context.Background(), testKey, 1); err != nil {
		t.Fatal("fresh same-epoch authority could not explicitly resume", err)
	}
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	entry, _ = e.Entry(context.Background(), testKey, op1)
	if entry.Status != Accepted || entry.Operation != op || calls != 2 {
		t.Fatal("reauthentication changed pending operation")
	}
}

func TestStaleAuthenticationErrorCannotDisableNewerAttempt(t *testing.T) {
	store := newMemoryStore()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	e := engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-release
			return v1.Receipt{}, ErrAuthenticationRequired
		}
		return accepted(op), nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "exact"))
	first := make(chan error, 1)
	go func() { _, err := e.ProcessOne(context.Background(), testKey); first <- err }()
	<-started
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-first; !errors.Is(err, ErrStaleResponse) {
		t.Fatal("stale 401 paused newer attempt", err)
	}
	state, _ := e.State(context.Background(), testKey)
	if !state.Enabled || state.Revoked {
		t.Fatal("stale login response changed current authority")
	}
}

func TestExplicitSameEpochReenableFencesOldAuthorityErrors(t *testing.T) {
	for _, denial := range []error{ErrAuthenticationRequired, ErrAccessDenied} {
		t.Run(denial.Error(), func(t *testing.T) {
			store := newMemoryStore()
			started, release := make(chan struct{}), make(chan struct{})
			e := engine(store, transportFunc(func(context.Context, v1.Operation) (v1.Receipt, error) {
				close(started)
				<-release
				return v1.Receipt{}, denial
			}))
			enable(t, e)
			_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "exact"))
			first := make(chan error, 1)
			go func() { _, err := e.ProcessOne(context.Background(), testKey); first <- err }()
			<-started
			if err := e.Disable(context.Background(), testKey); err != nil {
				t.Fatal(err)
			}
			if err := e.Enable(context.Background(), testKey, 1); err != nil {
				t.Fatal(err)
			}
			close(release)
			if err := <-first; !errors.Is(err, ErrStaleResponse) {
				t.Fatal("old authority error survived fresh selection", err)
			}
			state, _ := e.State(context.Background(), testKey)
			if !state.Enabled || state.Revoked {
				t.Fatal("fresh same-epoch authority was disabled")
			}
		})
	}
}

func TestHistoricalAcceptanceSurvivesExplicitSameEpochReenable(t *testing.T) {
	store := newMemoryStore()
	var e *Engine
	e = engine(store, transportFunc(func(_ context.Context, op v1.Operation) (v1.Receipt, error) {
		if err := e.Disable(context.Background(), testKey); err != nil {
			return v1.Receipt{}, err
		}
		if err := e.Enable(context.Background(), testKey, 1); err != nil {
			return v1.Receipt{}, err
		}
		return accepted(op), nil
	}))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, operation(op1, 0, "accepted remote writing"))
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal("known accepted receipt was discarded", err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != Accepted || entry.Receipt == nil {
		t.Fatal("known acceptance was not durably acknowledged")
	}
}

var errCommit = errors.New("synthetic local commit failure")

type memoryStore struct {
	mu       sync.Mutex
	brains   map[Key]BrainState
	entries  map[Key]map[v1.ID]Entry
	order    map[Key][]v1.ID
	failNext bool
}

func newMemoryStore() *memoryStore {
	return &memoryStore{brains: map[Key]BrainState{}, entries: map[Key]map[v1.ID]Entry{}, order: map[Key][]v1.ID{}}
}
func cloneEntry(e Entry) Entry {
	b, _ := json.Marshal(e)
	var clone Entry
	_ = json.Unmarshal(b, &clone)
	return clone
}
func (m *memoryStore) Transaction(ctx context.Context, f func(Tx) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	copy := newMemoryStore()
	for k, v := range m.brains {
		copy.brains[k] = v
	}
	for k, entries := range m.entries {
		copy.entries[k] = map[v1.ID]Entry{}
		for id, e := range entries {
			copy.entries[k][id] = cloneEntry(e)
		}
	}
	for k, ids := range m.order {
		copy.order[k] = append([]v1.ID(nil), ids...)
	}
	if err := f(memoryTx{copy}); err != nil {
		return err
	}
	if m.failNext {
		m.failNext = false
		return errCommit
	}
	m.brains, m.entries, m.order = copy.brains, copy.entries, copy.order
	return nil
}

type memoryTx struct{ m *memoryStore }

func (t memoryTx) Brain(k Key) (BrainState, error) {
	s, ok := t.m.brains[k]
	if !ok {
		return s, ErrNotFound
	}
	return s, nil
}
func (t memoryTx) PutBrain(k Key, s BrainState) error { t.m.brains[k] = s; return nil }
func (t memoryTx) Entry(k Key, id v1.ID) (Entry, error) {
	e, ok := t.m.entries[k][id]
	if !ok {
		return e, ErrNotFound
	}
	return cloneEntry(e), nil
}
func (t memoryTx) Entries(k Key) ([]Entry, error) {
	var out []Entry
	for _, id := range t.m.order[k] {
		out = append(out, cloneEntry(t.m.entries[k][id]))
	}
	return out, nil
}
func (t memoryTx) Insert(e Entry) error {
	if _, err := t.Entry(e.Key, e.Operation.OperationID); err == nil {
		return ErrKeyReuse
	}
	if t.m.entries[e.Key] == nil {
		t.m.entries[e.Key] = map[v1.ID]Entry{}
	}
	t.m.entries[e.Key][e.Operation.OperationID] = cloneEntry(e)
	t.m.order[e.Key] = append(t.m.order[e.Key], e.Operation.OperationID)
	return nil
}
func (t memoryTx) Update(e Entry) error {
	if _, err := t.Entry(e.Key, e.Operation.OperationID); err != nil {
		return err
	}
	t.m.entries[e.Key][e.Operation.OperationID] = cloneEntry(e)
	return nil
}
