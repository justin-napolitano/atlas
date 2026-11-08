package researchsync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	v1 "github.com/justin-napolitano/atlas/contracts/research/v1"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

const org = "00000000-0000-0000-0000-000000000001"
const brain = "30000000-0000-0000-0000-000000000003"
const alice = "10000000-0000-0000-0000-000000000001"
const bob = "10000000-0000-0000-0000-000000000002"

func ident(n int) string { return fmt.Sprintf("70000000-0000-0000-0000-%012d", n) }
func TestDedicatedSidecar(t *testing.T) {
	ctx := context.Background()
	p := filepath.Join(t.TempDir(), "research.sqlite")
	db, e := Open(p)
	if e != nil {
		t.Fatal(e)
	}
	c := Client{BaseURL: "https://synthetic.invalid", OrganizationID: org, BrainID: brain, UserID: alice, DB: db, HTTP: http.DefaultClient}
	if _, e = c.endpoint("state"); e != nil {
		t.Fatal(e)
	}
	other := c
	other.UserID = bob
	if _, e = other.endpoint("state"); e == nil {
		t.Fatal("cross-user cache allowed")
	}
	db.Close()
	db, e = Open(p)
	if e != nil {
		t.Fatal(e)
	}
	db.Close()
	unrelated := filepath.Join(t.TempDir(), "owner.sqlite")
	if os.WriteFile(unrelated, []byte("unrelated owner data"), 0600) != nil {
		t.Fatal("fixture")
	}
	if db, e = Open(unrelated); e == nil {
		db.Close()
		t.Fatal("owner database accepted")
	}
	_ = ctx
}

// TestSyntheticResearchAcceptance is launched only by the disposable MU fixture.
// It uploads literal synthetic text, never reads owner files or arbitrary URLs.
func TestSyntheticResearchAcceptance(t *testing.T) {
	endpoint := os.Getenv("ATLAS_SYNTHETIC_RESEARCH_URL")
	if endpoint == "" {
		t.Skip("requires disposable MU PostgreSQL/HTTP fixture")
	}
	u, e := url.Parse(endpoint)
	if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
		t.Fatal("synthetic loopback fixture required")
	}
	ctx := context.Background()
	mk := func(user, token string) Client {
		jar, _ := cookiejar.New(nil)
		jar.SetCookies(u, []*http.Cookie{{Name: "synthetic_session", Value: token}})
		db, e := Open(filepath.Join(t.TempDir(), "research.sqlite"))
		if e != nil {
			t.Fatal(e)
		}
		t.Cleanup(func() { db.Close() })
		return Client{BaseURL: endpoint, OrganizationID: org, BrainID: brain, UserID: user, HTTP: &http.Client{Jar: jar}, DB: db}
	}
	a := mk(alice, os.Getenv("ATLAS_SYNTHETIC_ALICE"))
	b := mk(bob, os.Getenv("ATLAS_SYNTHETIC_BOB"))
	s, e := a.Refresh(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, e = b.Refresh(ctx)
	if e != nil {
		t.Fatal(e)
	}
	gen := s.GenerationID
	serial := 10
	send := func(c Client, r v1.Record, base int64) (v1.Receipt, error) {
		serial++
		r.Revision = 0
		o := v1.Operation{OperationID: ident(serial), GenerationID: gen, BaseRevision: base, Record: r}
		if e := c.Queue(ctx, o); e != nil {
			return v1.Receipt{}, e
		}
		return c.Send(ctx, o.OperationID)
	}
	doc := "Synthetic exact Ω document."
	sum := sha256.Sum256([]byte(doc))
	hash := hex.EncodeToString(sum[:])
	source := v1.Record{ID: ident(1), Kind: "source", Visibility: "shared", Title: "Synthetic source", SourceID: ident(1), DocumentVersion: ident(2), SHA256: hash, Document: doc}
	r, e := send(a, source, 0)
	if e != nil || r.Outcome != "accepted" {
		t.Fatalf("source: %v", e)
	}
	// Durable receipt replay and immutable payload identity.
	replay, e := a.Send(ctx, r.OperationID)
	if e != nil || replay != r {
		t.Fatal("receipt replay changed")
	}
	var op v1.Operation
	payload := []byte{}
	if e = a.DB.QueryRow(`SELECT payload FROM research_pending WHERE operation_id=?`, r.OperationID).Scan(&payload); e != nil {
		t.Fatal(e)
	}
	_ = op
	changed := source
	changed.Title = "Synthetic overwrite"
	if _, e = send(a, changed, 1); e == nil {
		t.Fatal("immutable source updated")
	}
	stale := source
	stale.Deleted = true
	if r, e = send(a, stale, 0); !errors.Is(e, ErrConflict) || r.Outcome != "conflict" {
		t.Fatalf("stale CAS accepted: %v", e)
	}
	annotation := v1.Record{ID: ident(3), Kind: "annotation", SourceID: source.ID, DocumentVersion: source.DocumentVersion, SHA256: hash, Selector: &v1.Selector{Exact: "exact", Prefix: "Synthetic ", Suffix: " Ω", Start: 10, End: 15}, Body: "Synthetic private annotation"}
	if _, e = send(a, annotation, 0); e != nil {
		t.Fatal(e)
	}
	annotation.ID = ident(4)
	annotation.Visibility = "shared"
	annotation.Body = "Synthetic explicitly shared annotation"
	if _, e = send(a, annotation, 0); e != nil {
		t.Fatal(e)
	}
	wrong := annotation
	wrong.ID = ident(5)
	wrong.DocumentVersion = ident(999)
	if _, e = send(a, wrong, 0); e == nil {
		t.Fatal("wrong version accepted")
	}
	wrong = annotation
	wrong.ID = ident(6)
	wrong.Selector = &v1.Selector{Exact: "wrong", Start: 10, End: 15}
	if _, e = send(a, wrong, 0); e == nil {
		t.Fatal("wrong exact selector accepted")
	}
	progress := v1.Record{ID: ident(7), Kind: "progress", SourceID: source.ID, DocumentVersion: source.DocumentVersion, SHA256: hash, Position: 7}
	if _, e = send(a, progress, 0); e != nil {
		t.Fatal(e)
	}
	progress.ID = ident(8)
	progress.Position = 20
	if _, e = send(b, progress, 0); e != nil {
		t.Fatal(e)
	}
	sa, e := a.Refresh(ctx)
	if e != nil {
		t.Fatal(e)
	}
	sb, e := b.Refresh(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if sa.Total != 4 || sb.Total != 3 {
		t.Fatalf("private count leaked: alice=%d bob=%d", sa.Total, sb.Total)
	}
	for _, r := range sb.Items {
		if r.ID == ident(3) || r.ID == ident(7) {
			t.Fatal("private record leaked")
		}
	}
	collection := v1.Record{ID: ident(20), Kind: "collection", Visibility: "shared", Title: "Synthetic collection"}
	if _, e = send(a, collection, 0); e != nil {
		t.Fatal(e)
	}
	collection.Title = "Synthetic Bob shared edit"
	if _, e = send(b, collection, 1); e != nil {
		t.Fatal("second writer cannot edit shared collection", e)
	}
	membership := v1.Record{ID: ident(21), Kind: "membership", Visibility: "shared", CollectionID: collection.ID, SourceID: source.ID}
	if _, e = send(a, membership, 0); e != nil {
		t.Fatal(e)
	}
	membership.Deleted = true
	if _, e = send(b, membership, 1); e != nil {
		t.Fatal(e)
	}
	pending, e := a.Pending(ctx)
	if e != nil || len(pending) < 3 {
		t.Fatal("uncertain/conflict operations lost", e)
	}
	// Reopen the SQLite file and recover exact pending/conflict IDs and cached scope.
	var dbfile string
	var ignored int
	var name string
	if e = a.DB.QueryRow(`PRAGMA database_list`).Scan(&ignored, &name, &dbfile); e != nil {
		t.Fatal(e)
	}
	a.DB.Close()
	a.DB, e = Open(dbfile)
	if e != nil {
		t.Fatal(e)
	}
	defer a.DB.Close()
	after, e := a.Pending(ctx)
	if e != nil || len(after) != len(pending) {
		t.Fatal("restart lost pending")
	}
	cached, e := a.Cached(ctx)
	if e != nil || cached.UserID != alice {
		t.Fatal("restart cache identity")
	}
	t.Log("PASS real PG+HTTP+SQLite two users; exact selectors; immutable source; CAS/replay; private counts; independent progress; membership tombstone; restart pending")
}

func TestResolveOnlyDurableConflicts(t *testing.T) {
	ctx := context.Background()
	db, e := Open(filepath.Join(t.TempDir(), "research.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	c := Client{BaseURL: "https://synthetic.invalid", OrganizationID: org, BrainID: brain, UserID: alice, DB: db, HTTP: http.DefaultClient}
	for n, outcome := range []string{"", "accepted", "conflict"} {
		o := v1.Operation{OperationID: ident(800 + n), GenerationID: ident(900), Record: v1.Record{ID: ident(810 + n), Kind: "collection", Visibility: "shared", Title: "Synthetic resolution"}}
		if e = c.Queue(ctx, o); e != nil {
			t.Fatal(e)
		}
		if outcome != "" {
			r := v1.Receipt{OrganizationID: org, BrainID: brain, UserID: alice, GenerationID: o.GenerationID, OperationID: o.OperationID, Outcome: outcome, Record: o.Record}
			r.Record.Revision = 1
			b, _ := json.Marshal(r)
			if _, e = db.Exec(`UPDATE research_pending SET receipt=? WHERE operation_id=?`, b, o.OperationID); e != nil {
				t.Fatal(e)
			}
		}
		e = c.ResolveConflict(ctx, o.OperationID)
		if outcome != "conflict" {
			if e == nil {
				t.Fatal("non-conflict resolved")
			}
		} else {
			if e != nil {
				t.Fatal(e)
			}
			if e = c.ResolveConflict(ctx, o.OperationID); e != nil {
				t.Fatal("resolution not idempotent", e)
			}
			r, e := c.Send(ctx, o.OperationID)
			if !errors.Is(e, ErrConflict) || r.OperationID != o.OperationID {
				t.Fatal("resolved immutable receipt no longer replayable", e)
			}
		}
	}
	pending, e := c.Pending(ctx)
	if e != nil || len(pending) != 1 || pending[0].Operation.OperationID != ident(800) {
		t.Fatal("pending resolution filter", e)
	}
	var count int
	if e = db.QueryRow(`SELECT count(*) FROM research_pending`).Scan(&count); e != nil || count != 3 {
		t.Fatal("resolution destroyed history")
	}
}
