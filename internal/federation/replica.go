package federation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
	_ "github.com/mattn/go-sqlite3"
)

var ErrDraftPending = errors.New("page has an unresolved local operation; send or explicitly resolve it first")

// ReplicaIdentity permanently binds a separate replica file to one account,
// organization, device and service origin. No owner database is imported.
type ReplicaIdentity struct {
	OrganizationID v1.ID
	UserID         v1.ID
	DeviceID       v1.ID
	Origin         string
}

type Replica struct {
	db       *sql.DB
	identity ReplicaIdentity
}

// OpenReplica creates only a new explicit private file when create is true.
// Reopen fails closed unless the stored identity exactly matches the selection.
func OpenReplica(ctx context.Context, path string, identity ReplicaIdentity, create bool) (*Replica, error) {
	for _, id := range []v1.ID{identity.OrganizationID, identity.UserID, identity.DeviceID} {
		if v1.ValidateID(id) != nil {
			return nil, ErrAccessDenied
		}
	}
	u, err := url.Parse(identity.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || (net.ParseIP(u.Hostname()) != nil && net.ParseIP(u.Hostname()).IsLoopback())))) {
		return nil, ErrAccessDenied
	}
	if !filepath.IsAbs(path) {
		return nil, errors.New("replica path must be absolute")
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(path))
	if err != nil || parent != filepath.Dir(path) {
		return nil, errors.New("replica directory must exist without symlinks")
	}
	info, err := os.Stat(parent)
	if err != nil || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("replica directory must be private (0700)")
	}
	if create {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return nil, err
		}
		if err = file.Close(); err != nil {
			return nil, err
		}
	} else {
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
			return nil, errors.New("existing replica must be a private regular file")
		}
	}
	fileURL := url.URL{Scheme: "file", Path: path}
	if !create {
		// Read identity before opening a writable connection or applying PRAGMAs.
		readURL := fileURL
		readURL.RawQuery = "mode=ro"
		check, err := sql.Open("sqlite3", readURL.String())
		if err != nil {
			return nil, err
		}
		var stored ReplicaIdentity
		err = check.QueryRowContext(ctx, "SELECT organization_id,user_id,device_id,origin FROM replica_identity WHERE singleton=1").Scan(&stored.OrganizationID, &stored.UserID, &stored.DeviceID, &stored.Origin)
		_ = check.Close()
		if err != nil || stored != identity {
			return nil, ErrAccessDenied
		}
	}
	q := url.Values{"_foreign_keys": {"on"}, "_journal_mode": {"WAL"}, "_synchronous": {"FULL"}, "_busy_timeout": {"5000"}, "_txlock": {"immediate"}}
	fileURL.RawQuery = q.Encode()
	db, err := sql.Open("sqlite3", fileURL.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	r := &Replica{db: db, identity: identity}
	ok := false
	defer func() {
		if !ok {
			_ = db.Close()
		}
	}()
	if err = (SQLiteStore{DB: db}).Migrate(ctx); err != nil {
		return nil, err
	}
	if err = r.migrate(ctx, create); err != nil {
		return nil, err
	}
	ok = true
	return r, nil
}

func (r *Replica) Close() error              { return r.db.Close() }
func (r *Replica) Identity() ReplicaIdentity { return r.identity }

func (r *Replica) Transaction(ctx context.Context, change func(Tx) error) error {
	return (SQLiteStore{DB: r.db}).Transaction(ctx, func(tx Tx) error { return change(replicaTx{Tx: tx, ctx: ctx, identity: r.identity}) })
}

type replicaTx struct {
	Tx
	ctx      context.Context
	identity ReplicaIdentity
}

func (tx replicaTx) allowed(key Key) bool {
	return key.OrganizationID == tx.identity.OrganizationID && key.UserID == tx.identity.UserID
}
func (tx replicaTx) Brain(key Key) (BrainState, error) {
	if !tx.allowed(key) {
		return BrainState{}, ErrAccessDenied
	}
	state, err := tx.Tx.Brain(key)
	if err != nil {
		return state, err
	}
	if tx.workspace() {
		raw, _ := SQLTransaction(tx.Tx)
		err = raw.QueryRowContext(tx.ctx, `SELECT generation_id FROM replica_sync_state WHERE organization_id=? AND brain_id=? AND user_id=?`, keyArgs(key)...).Scan(&state.GenerationID)
		if errors.Is(err, sql.ErrNoRows) {
			err = nil
		}
	}
	return state, err
}
func (tx replicaTx) PutBrain(key Key, state BrainState) error {
	if !tx.allowed(key) {
		return ErrAccessDenied
	}
	return tx.Tx.PutBrain(key, state)
}
func (tx replicaTx) Entry(key Key, id v1.ID) (Entry, error) {
	if !tx.allowed(key) {
		return Entry{}, ErrAccessDenied
	}
	entry, err := tx.Tx.Entry(key, id)
	if err == nil {
		err = tx.hydrateGeneration(&entry)
	}
	return entry, err
}
func (tx replicaTx) Entries(key Key) ([]Entry, error) {
	if !tx.allowed(key) {
		return nil, ErrAccessDenied
	}
	entries, err := tx.Tx.Entries(key)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		if err = tx.hydrateGeneration(&entries[i]); err != nil {
			return nil, err
		}
	}
	return entries, nil
}
func (tx replicaTx) Insert(entry Entry) error {
	if !tx.allowed(entry.Key) || entry.Operation.DeviceID != tx.identity.DeviceID {
		return ErrAccessDenied
	}
	if err := tx.Tx.Insert(entry); err != nil {
		return err
	}
	if tx.workspace() {
		raw, _ := SQLTransaction(tx.Tx)
		args := append(keyArgs(entry.Key), string(entry.Operation.OperationID), string(entry.GenerationID))
		_, err := raw.ExecContext(tx.ctx, `INSERT INTO replica_operation_generations VALUES(?,?,?,?,?)`, args...)
		return err
	}
	return nil
}

func (tx replicaTx) Update(entry Entry) error {
	if !tx.allowed(entry.Key) || entry.Operation.DeviceID != tx.identity.DeviceID {
		return ErrAccessDenied
	}
	if tx.workspace() {
		stored := entry
		if err := tx.hydrateGeneration(&stored); err != nil {
			return err
		}
		if stored.GenerationID != entry.GenerationID {
			return ErrKeyReuse
		}
		if stored.GenerationBlocked && entry.Receipt != nil {
			return ErrStaleResponse
		}
	}
	if err := tx.Tx.Update(entry); err != nil {
		return err
	}
	if entry.Receipt == nil {
		return nil
	}
	raw, _ := SQLTransaction(tx.Tx)
	if handled, err := workingReceipt(tx.ctx, raw, entry); handled || err != nil {
		return err
	}
	if entry.Status == Accepted {
		snapshot := v1.Snapshot{RevisionID: *entry.Receipt.RevisionID, Revision: entry.Receipt.Revision, Content: entry.Operation.Payload}
		if err := cacheSnapshot(tx.ctx, raw, entry.Key, entry.Operation.PageID, snapshot); err != nil {
			return err
		}
		page, err := readPage(tx.ctx, raw, entry.Key, entry.Operation.PageID)
		if err != nil {
			return err
		}
		content, _ := json.Marshal(page.Remote.Content)
		args := append([]any{content}, keyArgs(entry.Key)...)
		args = append(args, string(entry.Operation.PageID), string(entry.Operation.OperationID))
		_, err = raw.ExecContext(tx.ctx, `UPDATE replica_pages SET local_json=?,draft_operation_id=NULL,draft_base_json=NULL WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=? AND draft_operation_id=?`, args...)
		return err
	}
	if entry.Status == Conflicted && entry.Receipt.Conflict.Server != nil {
		return cacheSnapshot(tx.ctx, raw, entry.Key, entry.Operation.PageID, *entry.Receipt.Conflict.Server)
	}
	return nil
}

type ReplicaPage struct {
	PageID           v1.ID
	Local            v1.PageContent
	Remote           *v1.Snapshot
	Base             *v1.Snapshot
	DraftOperationID v1.ID
}

func (r *Replica) key(brain v1.ID) Key {
	return Key{OrganizationID: r.identity.OrganizationID, BrainID: brain, UserID: r.identity.UserID}
}
func (r *Replica) Engine(transport Transport) *Engine {
	return &Engine{Store: r, Transport: transport, UserID: r.identity.UserID, DeviceID: r.identity.DeviceID}
}

func (r *Replica) Edit(ctx context.Context, engine *Engine, op v1.Operation) (Entry, error) {
	if engine.Store != r || engine.UserID != r.identity.UserID || engine.DeviceID != r.identity.DeviceID || op.OrganizationID != r.identity.OrganizationID {
		return Entry{}, ErrAccessDenied
	}
	key := r.key(op.BrainID)
	return engine.queue(ctx, key, op, func(tx Tx) error { return saveDraft(ctx, tx, key, op, false) })
}

func (r *Replica) Resolve(ctx context.Context, engine *Engine, oldID v1.ID, op v1.Operation) (Entry, error) {
	if engine.Store != r || op.OrganizationID != r.identity.OrganizationID {
		return Entry{}, ErrAccessDenied
	}
	key := r.key(op.BrainID)
	return engine.resolve(ctx, key, oldID, op, func(tx Tx) error { return saveDraft(ctx, tx, key, op, true) })
}

func saveDraft(ctx context.Context, tx Tx, key Key, op v1.Operation, resolving bool) error {
	raw, ok := SQLTransaction(tx)
	if !ok {
		return errors.New("replica requires its SQLite transaction")
	}
	old, err := readPage(ctx, raw, key, op.PageID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if old.DraftOperationID != "" && !resolving {
		return ErrDraftPending
	}
	revision := int64(0)
	if old.Remote != nil {
		revision = old.Remote.Revision
	}
	if op.BaseRevision != revision {
		return ErrConflict
	}
	content, err := json.Marshal(op.Payload)
	if err != nil {
		return err
	}
	var base any
	if old.Remote != nil {
		encoded, _ := json.Marshal(old.Remote)
		base = encoded
	}
	args := append(keyArgs(key), string(op.PageID), content, string(op.OperationID), base)
	_, err = raw.ExecContext(ctx, `INSERT INTO replica_pages(organization_id,brain_id,user_id,page_id,local_json,draft_operation_id,draft_base_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id,page_id) DO UPDATE SET local_json=excluded.local_json,draft_operation_id=excluded.draft_operation_id,draft_base_json=excluded.draft_base_json`, args...)
	return err
}

func (r *Replica) Page(ctx context.Context, brain, page v1.ID) (ReplicaPage, error) {
	var result ReplicaPage
	err := r.Transaction(ctx, func(tx Tx) error {
		raw, _ := SQLTransaction(tx)
		var err error
		result, err = readPage(ctx, raw, r.key(brain), page)
		return err
	})
	return result, err
}

func readPage(ctx context.Context, tx *sql.Tx, key Key, page v1.ID) (ReplicaPage, error) {
	result := ReplicaPage{PageID: page}
	var local, remote, base []byte
	var draft sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT local_json,remote_json,draft_operation_id,draft_base_json FROM replica_pages WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, append(keyArgs(key), string(page))...).Scan(&local, &remote, &draft, &base)
	if errors.Is(err, sql.ErrNoRows) {
		return result, ErrNotFound
	}
	if err != nil {
		return result, err
	}
	if json.Unmarshal(local, &result.Local) != nil {
		return result, ErrInvalidReceipt
	}
	if remote != nil {
		if json.Unmarshal(remote, &result.Remote) != nil {
			return result, ErrInvalidReceipt
		}
	}
	if draft.Valid {
		result.DraftOperationID = v1.ID(draft.String)
	}
	if base != nil {
		if json.Unmarshal(base, &result.Base) != nil {
			return result, ErrInvalidReceipt
		}
	}
	return result, nil
}

func cacheSnapshot(ctx context.Context, tx *sql.Tx, key Key, page v1.ID, snapshot v1.Snapshot) error {
	if v1.ValidateID(page) != nil || snapshot.Validate() != nil {
		return ErrInvalidReceipt
	}
	encoded, _ := json.Marshal(snapshot)
	var previous []byte
	historyArgs := append(keyArgs(key), string(page), snapshot.Revision)
	err := tx.QueryRowContext(ctx, `SELECT snapshot_json FROM replica_snapshots WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=? AND revision=?`, historyArgs...).Scan(&previous)
	if err == nil {
		var stored v1.Snapshot
		if json.Unmarshal(previous, &stored) != nil || stored != snapshot {
			return ErrInvalidReceipt
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return err
	} else {
		if _, err = tx.ExecContext(ctx, `INSERT INTO replica_snapshots(organization_id,brain_id,user_id,page_id,revision,snapshot_json) VALUES(?,?,?,?,?,?)`, append(historyArgs, encoded)...); err != nil {
			return err
		}
	}
	old, err := readPage(ctx, tx, key, page)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if old.Remote != nil {
		if snapshot.Revision < old.Remote.Revision {
			return nil
		}
		if snapshot.Revision == old.Remote.Revision && snapshot != *old.Remote {
			return ErrInvalidReceipt
		}
	}
	remote, _ := json.Marshal(snapshot)
	local, _ := json.Marshal(snapshot.Content)
	preserve := old.DraftOperationID != ""
	var schema int
	if err = tx.QueryRowContext(ctx, "SELECT version FROM replica_schema_version WHERE singleton=1").Scan(&schema); err != nil {
		return err
	}
	if schema >= 2 {
		var dirty bool
		err = tx.QueryRowContext(ctx, `SELECT version>synced_version FROM replica_working_pages WHERE organization_id=? AND brain_id=? AND user_id=? AND page_id=?`, append(keyArgs(key), string(page))...).Scan(&dirty)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		preserve = preserve || dirty
	}
	args := append(keyArgs(key), string(page), local, remote, preserve)
	_, err = tx.ExecContext(ctx, `INSERT INTO replica_pages(organization_id,brain_id,user_id,page_id,local_json,remote_json) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,brain_id,user_id,page_id) DO UPDATE SET remote_json=excluded.remote_json,local_json=CASE WHEN ? THEN replica_pages.local_json ELSE excluded.local_json END`, args...)
	return err
}
