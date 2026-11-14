package federation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestWorkspaceReaderCanDownloadButCannotCreateLocalUploadIntent(t *testing.T) {
	ctx := context.Background()
	writes := 0
	snapshot := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic reader page", Body: "Readable exact 日本語\r\n", State: v1.Active}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasSuffix(req.URL.Path, "/bootstrap"):
			_ = json.NewEncoder(w).Encode(envelope([]any{map[string]any{"page_id": page, "snapshot": snapshot}}, "feed-cursor", true))
		case strings.HasSuffix(req.URL.Path, "/pull"):
			_ = json.NewEncoder(w).Encode(envelope([]any{}, "feed-renewed", true))
		case strings.HasSuffix(req.URL.Path, "/operations"):
			writes++
			w.WriteHeader(403)
		default:
			_ = json.NewEncoder(w).Encode(BrainAuthority{OrganizationID: org, BrainID: brain, UserID: user, MembershipEpoch: 1, CanWrite: false})
		}
	}))
	defer server.Close()
	r, _, _ := realReplica(t, server.URL)
	h := transportFor(t, server.URL, 0)
	e, err := r.SelectWorkspace(ctx, h, brain)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.Synchronize(ctx, e, h, brain); err != nil {
		t.Fatal(err)
	}
	current, err := r.WorkingPage(ctx, brain, page)
	if err != nil || current.Local != snapshot.Content {
		t.Fatal("reader could not inspect downloaded note", err)
	}
	if _, err = r.SaveWorking(ctx, brain, page, op1, 0, snapshot.Content); !errors.Is(err, ErrAccessDenied) {
		t.Fatal("reader created upload intent", err)
	}
	if writes != 0 {
		t.Fatal("reader made a remote write")
	}
}
