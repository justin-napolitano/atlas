// Package researchsync provides an explicitly selected research replica.
package researchsync

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	v1 "github.com/justin-napolitano/atlas/contracts/research/v1"
	_ "github.com/mattn/go-sqlite3"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
)

var ErrConflict = errors.New("research conflict requires review")

type Client struct {
	BaseURL, OrganizationID, BrainID, UserID string
	HTTP                                     *http.Client
	DB                                       *sql.DB
}

// Open creates a real SQLite store. Caller supplies an isolated workspace path.
func Open(path string) (*sql.DB, error) {
	if !filepath.IsAbs(path) || strings.Contains(path, "?") {
		return nil, v1.ErrInvalid
	}
	info, e := os.Lstat(path)
	exists := e == nil
	if e != nil && !os.IsNotExist(e) {
		return nil, e
	}
	if exists && (!info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0) {
		return nil, errors.New("research sidecar requires private regular file")
	}
	if !exists {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
		if err != nil {
			return nil, err
		}
		if err = f.Close(); err != nil {
			return nil, err
		}
	}
	d, e := sql.Open("sqlite3", path)
	if e != nil {
		return nil, e
	}
	d.SetMaxOpenConns(1)
	var application int
	if e = d.QueryRow(`PRAGMA application_id`).Scan(&application); e != nil {
		d.Close()
		return nil, e
	}
	if exists && application != 1095914323 {
		d.Close()
		return nil, errors.New("existing database is not an Atlas research sidecar")
	}
	_, e = d.Exec(`PRAGMA application_id=1095914323; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS research_identity(slot INTEGER PRIMARY KEY CHECK(slot=1),scope TEXT NOT NULL); CREATE TABLE IF NOT EXISTS research_state(scope TEXT PRIMARY KEY,generation TEXT NOT NULL,snapshot BLOB NOT NULL); CREATE TABLE IF NOT EXISTS research_pending(scope TEXT NOT NULL,operation_id TEXT NOT NULL,payload BLOB NOT NULL,receipt BLOB,PRIMARY KEY(scope,operation_id));`)
	if e != nil {
		d.Close()
		return nil, e
	}
	return d, nil
}
func (c Client) scope() string {
	return c.BaseURL + "|" + c.OrganizationID + "|" + c.BrainID + "|" + c.UserID
}
func (c Client) endpoint(action string) (string, error) {
	u, e := url.Parse(c.BaseURL)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !v1.ValidID(c.OrganizationID) || !v1.ValidID(c.BrainID) || !v1.ValidID(c.UserID) || c.DB == nil || c.HTTP == nil {
		return "", v1.ErrInvalid
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1")) {
		return "", v1.ErrInvalid
	}
	if _, e = c.DB.Exec(`INSERT INTO research_identity(slot,scope) VALUES(1,?) ON CONFLICT(slot) DO NOTHING`, c.scope()); e != nil {
		return "", e
	}
	var bound string
	if e = c.DB.QueryRow(`SELECT scope FROM research_identity WHERE slot=1`).Scan(&bound); e != nil {
		return "", e
	}
	if bound != c.scope() {
		return "", errors.New("research identity mismatch")
	}
	return strings.TrimRight(c.BaseURL, "/") + "/v1/organizations/" + c.OrganizationID + "/brains/" + c.BrainID + "/research/" + action, nil
}
func (c Client) call(ctx context.Context, method, action string, payload []byte, out any) error {
	endpoint, e := c.endpoint(action)
	if e != nil {
		return e
	}
	r, e := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(payload))
	if e != nil {
		return e
	}
	r.Header.Set("Content-Type", "application/json")
	transport := *c.HTTP
	transport.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, e := transport.Do(r)
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("research HTTP %d", resp.StatusCode)
	}
	data, e := io.ReadAll(io.LimitReader(resp.Body, 4<<20+1))
	if e != nil || len(data) > 4<<20 {
		return errors.New("research response too large")
	}
	return json.Unmarshal(data, out)
}

// Refresh replaces only the server snapshot, preserving all pending operations.
func (c Client) Refresh(ctx context.Context) (v1.Snapshot, error) {
	var s v1.Snapshot
	e := c.call(ctx, "GET", "state", nil, &s)
	if e != nil {
		return s, e
	}
	if s.OrganizationID != c.OrganizationID || s.BrainID != c.BrainID || s.UserID != c.UserID || !v1.ValidID(s.GenerationID) || s.Items == nil || s.Total != len(s.Items) || len(s.Items) > 1000 {
		return s, v1.ErrInvalid
	}
	seen := map[string]bool{}
	for _, r := range s.Items {
		if seen[r.ID] || r.Revision < 1 {
			return s, v1.ErrInvalid
		}
		seen[r.ID] = true
		r.Revision = 0
		o := v1.Operation{OperationID: r.ID, GenerationID: s.GenerationID, Record: r}
		if o.Validate() != nil {
			return s, v1.ErrInvalid
		}
	}
	b, e := json.Marshal(s)
	if e != nil {
		return s, e
	}
	_, e = c.DB.ExecContext(ctx, `INSERT INTO research_state VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET generation=excluded.generation,snapshot=excluded.snapshot`, c.scope(), s.GenerationID, b)
	return s, e
}
func (c Client) Cached(ctx context.Context) (v1.Snapshot, error) {
	var s v1.Snapshot
	if _, e := c.endpoint("state"); e != nil {
		return s, e
	}
	var b []byte
	e := c.DB.QueryRowContext(ctx, `SELECT snapshot FROM research_state WHERE scope=?`, c.scope()).Scan(&b)
	if e == nil {
		e = json.Unmarshal(b, &s)
	}
	return s, e
}

// Queue durably records an immutable operation before any HTTP request.
func (c Client) Queue(ctx context.Context, o v1.Operation) error {
	if e := o.Validate(); e != nil {
		return e
	}
	if _, e := c.endpoint("operations"); e != nil {
		return e
	}
	b, e := json.Marshal(o)
	if e != nil {
		return e
	}
	if len(b) > 512<<10 {
		return v1.ErrInvalid
	}
	_, e = c.DB.ExecContext(ctx, `INSERT INTO research_pending(scope,operation_id,payload) VALUES(?,?,?) ON CONFLICT(scope,operation_id) DO NOTHING`, c.scope(), o.OperationID, b)
	if e != nil {
		return e
	}
	var old []byte
	e = c.DB.QueryRowContext(ctx, `SELECT payload FROM research_pending WHERE scope=? AND operation_id=?`, c.scope(), o.OperationID).Scan(&old)
	if e == nil && !bytes.Equal(b, old) {
		return v1.ErrInvalid
	}
	return e
}
func (c Client) Send(ctx context.Context, id string) (v1.Receipt, error) {
	var out v1.Receipt
	if _, e := c.endpoint("operations"); e != nil {
		return out, e
	}
	var b, receipt []byte
	e := c.DB.QueryRowContext(ctx, `SELECT payload,receipt FROM research_pending WHERE scope=? AND operation_id=?`, c.scope(), id).Scan(&b, &receipt)
	if e != nil {
		return out, e
	}
	if receipt != nil {
		e = json.Unmarshal(receipt, &out)
	} else {
		e = c.call(ctx, "POST", "operations", b, &out)
	}
	if e != nil {
		return out, e
	}
	var op v1.Operation
	if json.Unmarshal(b, &op) != nil {
		return out, v1.ErrInvalid
	}
	if out.OrganizationID != c.OrganizationID || out.BrainID != c.BrainID || out.UserID != c.UserID || out.GenerationID != op.GenerationID || out.OperationID != id || (out.Outcome != "accepted" && out.Outcome != "conflict") || out.Record.ID != op.Record.ID || out.Record.Kind != op.Record.Kind {
		return out, v1.ErrInvalid
	}
	if out.Outcome == "accepted" {
		expected := op.Record
		expected.Revision = op.BaseRevision + 1
		if !reflect.DeepEqual(out.Record, expected) {
			return out, v1.ErrInvalid
		}
	}
	receipt, e = json.Marshal(out)
	if e != nil {
		return out, e
	}
	_, e = c.DB.ExecContext(ctx, `UPDATE research_pending SET receipt=? WHERE scope=? AND operation_id=?`, receipt, c.scope(), id)
	if e == nil && out.Outcome == "conflict" {
		e = ErrConflict
	}
	return out, e
}

type PendingItem struct {
	Operation v1.Operation `json:"operation"`
	Receipt   *v1.Receipt  `json:"receipt"`
}

// Pending keeps uncertain operations and explicit conflicts visible after restart.
func (c Client) Pending(ctx context.Context) ([]PendingItem, error) {
	if _, e := c.endpoint("state"); e != nil {
		return nil, e
	}
	rows, e := c.DB.QueryContext(ctx, `SELECT payload,receipt FROM research_pending WHERE scope=? AND (receipt IS NULL OR json_extract(receipt,'$.outcome')='conflict') ORDER BY rowid LIMIT 101`, c.scope())
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []PendingItem{}
	for rows.Next() {
		var b, r []byte
		var item PendingItem
		if e = rows.Scan(&b, &r); e != nil {
			return nil, e
		}
		if json.Unmarshal(b, &item.Operation) != nil {
			return nil, v1.ErrInvalid
		}
		if r != nil {
			item.Receipt = &v1.Receipt{}
			if json.Unmarshal(r, item.Receipt) != nil {
				return nil, v1.ErrInvalid
			}
		}
		out = append(out, item)
	}
	if len(out) > 100 {
		return nil, errors.New("research pending review exceeds 100 operations")
	}
	return out, rows.Err()
}
