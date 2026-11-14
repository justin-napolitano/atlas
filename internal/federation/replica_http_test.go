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

func TestReplicaReadRequiresExactKnownFieldsAndPreservesWriting(t *testing.T) {
	ctx := context.Background()
	snapshot := v1.Snapshot{RevisionID: revision, Revision: 1, Content: v1.PageContent{Title: "Synthetic", Body: "Remote", State: v1.Active}}
	valid, _ := json.Marshal(snapshot)
	for _, kind := range []string{"missing_body", "null_body", "duplicate_body", "malformed_unicode", "missing_revision", "wrong_user", "missing_write", "duplicate_authority"} {
		t.Run(kind, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if strings.HasSuffix(req.URL.Path, "/operations") {
					t.Error("unexpected write")
					return
				}
				if !strings.Contains(req.URL.Path, "/pages/") {
					authority := BrainAuthority{OrganizationID: org, BrainID: brain, UserID: user, MembershipEpoch: 1, CanWrite: true}
					if kind == "wrong_user" {
						authority.UserID = device
					}
					data, _ := json.Marshal(authority)
					if kind == "missing_write" {
						data = []byte(strings.Replace(string(data), `,"can_write":true`, "", 1))
					}
					if kind == "duplicate_authority" {
						data = append(data[:len(data)-1], []byte(`,"can_write":false}`)...)
					}
					_, _ = w.Write(data)
					return
				}
				data := string(valid)
				switch kind {
				case "missing_body":
					data = strings.Replace(data, `,"body":"Remote"`, "", 1)
				case "null_body":
					data = strings.Replace(data, `"body":"Remote"`, `"body":null`, 1)
				case "duplicate_body":
					data = strings.Replace(data, `"body":"Remote"`, `"body":"Remote","body":"Replaced"`, 1)
				case "malformed_unicode":
					data = strings.Replace(data, `"body":"Remote"`, `"body":"\ud800"`, 1)
				case "missing_revision":
					data = strings.Replace(data, `,"revision":1`, "", 1)
				}
				_, _ = w.Write([]byte(data))
			}))
			defer server.Close()
			r, _, _ := realReplica(t, server.URL)
			h := transportFor(t, server.URL, 0)
			e := r.Engine(h)
			if err := e.Enable(ctx, r.key(brain), 1); err != nil {
				t.Fatal(err)
			}
			op := operation(op1, 0, "Unsent exact 日本語\r\n")
			if _, err := r.Edit(ctx, e, op); err != nil {
				t.Fatal(err)
			}
			if err := r.RefreshPage(ctx, e, h, brain, page); !errors.Is(err, ErrInvalidReceipt) {
				t.Fatal("malformed read accepted", err)
			}
			local, err := r.Page(ctx, brain, page)
			if err != nil || local.Local != op.Payload || local.Remote != nil {
				t.Fatal("malformed read replaced writing", err)
			}
		})
	}
}

func TestReplicaReadDenialStopsFutureTransfersAndRetainsDraft(t *testing.T) {
	ctx := context.Background()
	for _, status := range []int{401, 403, 404} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(status) }))
			defer server.Close()
			r, path, id := realReplica(t, server.URL)
			h := transportFor(t, server.URL, 0)
			e := r.Engine(h)
			key := r.key(brain)
			if err := e.Enable(ctx, key, 1); err != nil {
				t.Fatal(err)
			}
			op := operation(op1, 0, "Retained pending writing")
			if _, err := r.Edit(ctx, e, op); err != nil {
				t.Fatal(err)
			}
			want := ErrRevoked
			if status == 401 {
				want = ErrAuthenticationRequired
			}
			if err := r.RefreshPage(ctx, e, h, brain, page); !errors.Is(err, want) {
				t.Fatal(err)
			}
			if err := r.Close(); err != nil {
				t.Fatal(err)
			}
			r, err := OpenReplica(ctx, path, id, false)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			e = r.Engine(h)
			if _, err = e.ProcessOne(ctx, key); err == nil {
				t.Fatal("denied transfer resumed")
			}
			if calls != 1 {
				t.Fatal("future network transfer after denial", calls)
			}
			entry, err := e.Entry(ctx, key, op1)
			if err != nil || entry.Status != Suspended || entry.Operation != op {
				t.Fatal("denial lost pending operation", err)
			}
		})
	}
}
