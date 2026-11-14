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
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
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

func TestRefreshPersistsLatestStartedReadAcrossHandles(t *testing.T) {
	for _, newerSucceeds := range []bool{true, false} {
		t.Run(fmt.Sprintf("newer_succeeds_%t", newerSucceeds), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			snapshot := func(generation int, revision int64, title string) v1.Snapshot {
				return v1.Snapshot{OrganizationID: org, BrainID: brain, UserID: alice, GenerationID: ident(generation), Total: 1, Items: []v1.Record{{ID: ident(980), Kind: "collection", Visibility: "shared", Title: title, Revision: revision}}}
			}
			baseline := snapshot(981, 5, "Synthetic cached baseline")
			stale := snapshot(982, 1, "Synthetic old generation and revision")
			newest := snapshot(983, 9, "Synthetic newest generation and revision")
			oldStarted := make(chan struct{})
			releaseOld := make(chan struct{})
			var request atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch request.Add(1) {
				case 1:
					_ = json.NewEncoder(w).Encode(baseline)
				case 2:
					close(oldStarted)
					select {
					case <-releaseOld:
						_ = json.NewEncoder(w).Encode(stale)
					case <-r.Context().Done():
					}
				case 3:
					if newerSucceeds {
						_ = json.NewEncoder(w).Encode(newest)
					} else {
						w.WriteHeader(503)
					}
				default:
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			defer func() {
				select {
				case <-releaseOld:
				default:
					close(releaseOld)
				}
			}()
			path := filepath.Join(t.TempDir(), "research.sqlite")
			firstDB, e := Open(path)
			if e != nil {
				t.Fatal(e)
			}
			defer firstDB.Close()
			first := Client{BaseURL: server.URL, OrganizationID: org, BrainID: brain, UserID: alice, DB: firstDB, HTTP: server.Client()}
			if _, e = first.Refresh(ctx); e != nil {
				t.Fatal(e)
			}
			// Independent handles exercise SQLite CAS rather than an in-process mutex.
			secondDB, e := Open(path)
			if e != nil {
				t.Fatal(e)
			}
			defer secondDB.Close()
			second := first
			second.DB = secondDB
			type result struct {
				snapshot v1.Snapshot
				err      error
			}
			oldResult := make(chan result, 1)
			go func() { s, e := first.Refresh(ctx); oldResult <- result{s, e} }()
			select {
			case <-oldStarted:
			case <-ctx.Done():
				t.Fatal("older request never started")
			}
			latest, e := second.Refresh(ctx)
			if newerSucceeds {
				if e != nil || latest.GenerationID != newest.GenerationID {
					t.Fatal("newer refresh failed", e)
				}
			} else {
				var status *HTTPError
				if !errors.As(e, &status) || status.Status != 503 {
					t.Fatal("newer failure not surfaced", e)
				}
			}
			close(releaseOld)
			var old result
			select {
			case old = <-oldResult:
			case <-ctx.Done():
				t.Fatal("older request never finished")
			}
			expected := baseline
			if newerSucceeds {
				expected = newest
				if old.err != nil || old.snapshot.GenerationID != newest.GenerationID || old.snapshot.Items[0].Revision != 9 {
					t.Fatal("superseded read returned stale body", old.err)
				}
			} else if !errors.Is(old.err, ErrSuperseded) || old.snapshot.GenerationID != "" {
				t.Fatal("uncommitted successor allowed stale return", old.err)
			}
			cached, e := first.Cached(ctx)
			if e != nil || cached.GenerationID != expected.GenerationID || cached.Items[0].Revision != expected.Items[0].Revision {
				t.Fatal("durable cache regressed", e)
			}
			var requested, committed int64
			if e = secondDB.QueryRow(`SELECT requested,committed FROM research_read_epoch WHERE scope=?`, first.scope()).Scan(&requested, &committed); e != nil {
				t.Fatal(e)
			}
			expectedCommitted := int64(1)
			if newerSucceeds {
				expectedCommitted = 3
			}
			if requested != 3 || committed != expectedCommitted {
				t.Fatalf("read epoch not durable: %d/%d", requested, committed)
			}
		})
	}
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
	if e = json.Unmarshal(payload, &op); e != nil {
		t.Fatal(e)
	}
	op.Record.Title = "Synthetic tampered operation"
	if e = a.Queue(ctx, op); e == nil {
		t.Fatal("local immutable operation ID reused")
	}
	tampered, _ := json.Marshal(op)
	if e = a.call(ctx, "POST", "operations", tampered, &v1.Receipt{}); e == nil {
		t.Fatal("server accepted operation-key tamper")
	}
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
		if r.Kind == "progress" && (r.ID != ident(8) || r.Position != 20) {
			t.Fatal("Bob reading progress overwritten")
		}
	}
	for _, r := range sa.Items {
		if r.Kind == "progress" && (r.ID != ident(7) || r.Position != 7) {
			t.Fatal("Alice reading progress overwritten")
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

func TestWrongAcknowledgementRetainsPending(t *testing.T) {
	ctx := context.Background()
	db, e := Open(filepath.Join(t.TempDir(), "research.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	op := v1.Operation{OperationID: ident(950), GenerationID: ident(951), Record: v1.Record{ID: ident(952), Kind: "collection", Visibility: "shared", Title: "Synthetic exact intent"}}
	response := v1.Receipt{OrganizationID: org, BrainID: brain, UserID: alice, GenerationID: op.GenerationID, OperationID: op.OperationID, Outcome: "accepted", Record: op.Record}
	response.Record.Revision = 1
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = json.NewEncoder(w).Encode(response) }))
	defer server.Close()
	c := Client{BaseURL: server.URL, OrganizationID: org, BrainID: brain, UserID: alice, DB: db, HTTP: server.Client()}
	if e = c.Queue(ctx, op); e != nil {
		t.Fatal(e)
	}
	exact := response
	for _, mutate := range []func(){func() { response.OperationID = ident(999) }, func() { response.UserID = bob }, func() { response.GenerationID = ident(999) }, func() { response.Record.Title = "Synthetic wrong content" }, func() { response.Record.Revision = 9 }} {
		response = exact
		mutate()
		if _, e = c.Send(ctx, op.OperationID); e == nil {
			t.Fatal("wrong acknowledgement accepted")
		}
		pending, e := c.Pending(ctx)
		if e != nil || len(pending) != 1 || pending[0].Receipt != nil {
			t.Fatal("uncertain operation lost after wrong acknowledgement", e)
		}
	}
}
