package federation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

const generation v1.ID = "70000000-0000-4000-8000-000000000001"
const bootstrapSnapshot v1.ID = "70000000-0000-4000-8000-000000000002"

func envelope(items any, cursor string, complete bool) map[string]any {
	return map[string]any{"schema_version": v1.SchemaVersion, "organization_id": org, "brain_id": brain, "user_id": user, "membership_epoch": 1, "generation_id": generation, "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339), "items": items, "next_cursor": cursor, "snapshot_id": bootstrapSnapshot, "complete": complete, "has_more": false}
}

func TestFeedBootstrapStagesBeforePublishAndRestartsAtExactCheckpoint(t *testing.T) {
	ctx := context.Background()
	requests := []string{}
	snapshot := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: "Exact 日本語\r\n", State: v1.Active}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		var body struct {
			Cursor *string `json:"cursor"`
		}
		_ = json.NewDecoder(req.Body).Decode(&body)
		cursor := ""
		if body.Cursor != nil {
			cursor = *body.Cursor
		}
		requests = append(requests, cursor)
		w.Header().Set("Content-Type", "application/json")
		var value map[string]any
		if strings.HasSuffix(req.URL.Path, "/bootstrap") {
			if cursor == "" {
				value = envelope([]any{map[string]any{"page_id": page, "snapshot": snapshot}}, "continue-bootstrap", false)
			} else {
				value = envelope([]any{}, "feed-start", true)
			}
		} else {
			value = envelope([]any{}, "feed-next", true)
		}
		_ = json.NewEncoder(w).Encode(value)
	}))
	defer server.Close()
	r, path, id := realReplica(t, server.URL)
	h := transportFor(t, server.URL, 0)
	e := r.Engine(h)
	if err := e.Enable(ctx, r.key(brain), 1); err != nil {
		t.Fatal(err)
	}
	complete, err := r.PullBrain(ctx, e, h, brain, 1)
	if err != nil || complete {
		t.Fatal(complete, err)
	}
	pages, err := r.WorkingPages(ctx, brain)
	if err != nil || len(pages) != 0 {
		t.Fatal("partial bootstrap published", err)
	}
	if err = r.Close(); err != nil {
		t.Fatal(err)
	}
	r, err = OpenReplica(ctx, path, id, false)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	e = r.Engine(h)
	complete, err = r.PullBrain(ctx, e, h, brain, 5)
	if err != nil || !complete {
		t.Fatal(complete, err)
	}
	got, err := r.Page(ctx, brain, page)
	if err != nil || got.Local != snapshot.Content || got.Remote == nil || *got.Remote != snapshot {
		t.Fatal("committed bootstrap lost writing", err)
	}
	if len(requests) != 3 || requests[1] != "continue-bootstrap" || requests[2] != "feed-start" {
		t.Fatal("restart did not retain checkpoint", requests)
	}
}

func TestFeedLargeEscapedEnvelopeAndRequiredBody(t *testing.T) {
	snapshot := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: strings.Repeat("\x01", v1.MaxBodyBytes), State: v1.Active}}
	data, err := json.Marshal(envelope([]any{map[string]any{"page_id": page, "snapshot": snapshot}, map[string]any{"page_id": op2, "snapshot": snapshot}}, "opaque", true))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) <= v1.MaxRequestBytes {
		t.Fatal("fixture did not cross request bound")
	}
	batch, err := decodeSyncBatch(data, "bootstrap", org, brain, user)
	if err != nil || len(batch.Items) != 2 || batch.Items[1].Snapshot.Content != snapshot.Content {
		t.Fatal("valid bounded large envelope rejected", err)
	}
	data = []byte(strings.Replace(string(data), `"body":"`+strings.Repeat(`\u0001`, v1.MaxBodyBytes)+`",`, "", 1))
	if _, err = decodeSyncBatch(data, "bootstrap", org, brain, user); err == nil {
		t.Fatal("missing snapshot body accepted")
	}
}

func TestFeedCheckpointFailureRollsBackPublishedPages(t *testing.T) {
	ctx := context.Background()
	snapshot := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: "Must remain staged", State: v1.Active}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(envelope([]any{map[string]any{"page_id": page, "snapshot": snapshot}}, "checkpoint", true))
	}))
	defer server.Close()
	r, _, _ := realReplica(t, server.URL)
	h := transportFor(t, server.URL, 0)
	e := r.Engine(h)
	if err := e.Enable(ctx, r.key(brain), 1); err != nil {
		t.Fatal(err)
	}
	if _, err := r.db.Exec(`CREATE TRIGGER synthetic_checkpoint_failure BEFORE UPDATE ON federation_brains WHEN NEW.cursor<>'' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := r.PullBrain(ctx, e, h, brain, 1); err == nil {
		t.Fatal("checkpoint failure acknowledged")
	}
	pages, err := r.WorkingPages(ctx, brain)
	if err != nil || len(pages) != 0 {
		t.Fatal("pages escaped failed checkpoint", err)
	}
	state, err := e.State(ctx, r.key(brain))
	if err != nil || state.Cursor != "" {
		t.Fatal("checkpoint advanced", err)
	}
}
