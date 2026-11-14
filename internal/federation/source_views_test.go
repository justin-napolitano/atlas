package federation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func sourceFixture() SourceRecord {
	at := time.Now().UTC().Truncate(time.Second)
	return SourceRecord{Source: v1.SourceIdentity{Provider: "servicenow", Instance: "https://synthetic.invalid", Table: "incident", SourceID: strings.Repeat("a", 32)}, SourceVersion: "source-v1", Ordinal: 1, SourceModifiedAt: at, ObservedAt: at, IngestedAt: at, ACLValidUntil: at.Add(time.Hour), Fields: map[string]string{"description": "Exact العربية\r\n日本語 é <b>plain text</b>", "number": "SYN-001"}, ContentSHA256: strings.Repeat("b", 64)}
}
func TestSourceTransportExactVersionAndCredentialBoundary(t *testing.T) {
	fixture := sourceFixture()
	var selected map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer synthetic-test-token" || r.Header.Get("Cookie") != "" {
			t.Error("source request widened credential or URL boundary")
		}
		data, _ := io.ReadAll(r.Body)
		if json.Unmarshal(data, &selected) != nil {
			t.Error("source body invalid")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(fixture)
	}))
	defer server.Close()
	h := transportFor(t, server.URL, 0)
	version := fixture.SourceVersion
	got, err := h.SourceRead(context.Background(), org, brain, op1, fixture.Source.SourceID, &version)
	if err != nil || got.Fields["description"] != fixture.Fields["description"] || got.SourceVersion != version {
		t.Fatal("exact source writing changed", err)
	}
	if string(selected["source_version"]) != `"source-v1"` {
		t.Fatal("version was not frozen in POST body")
	}
}
func TestSourceTransportRejectsAmbiguousOrWrongRecords(t *testing.T) {
	fixture := sourceFixture()
	raw, _ := json.Marshal(fixture)
	for name, change := range map[string]func(map[string]json.RawMessage){
		"missing fields":     func(m map[string]json.RawMessage) { delete(m, "fields") },
		"null field writing": func(m map[string]json.RawMessage) { m["fields"] = json.RawMessage(`{"description":null}`) },
		"missing ordinal":    func(m map[string]json.RawMessage) { delete(m, "ordinal") },
		"wrong version":      func(m map[string]json.RawMessage) { m["source_version"] = json.RawMessage(`"other"`) },
		"expired proof":      func(m map[string]json.RawMessage) { m["acl_valid_until"] = json.RawMessage(`"2000-01-01T00:00:00Z"`) },
		"unexpected field":   func(m map[string]json.RawMessage) { m["actor"] = json.RawMessage(`"untrusted"`) },
	} {
		t.Run(name, func(t *testing.T) {
			var m map[string]json.RawMessage
			json.Unmarshal(raw, &m)
			change(m)
			data, _ := json.Marshal(m)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Write(data)
			}))
			defer server.Close()
			version := fixture.SourceVersion
			if _, err := transportFor(t, server.URL, 0).SourceRead(context.Background(), org, brain, op1, fixture.Source.SourceID, &version); !errors.Is(err, ErrInvalidReceipt) {
				t.Fatal("malformed source response accepted", err)
			}
		})
	}
}
func TestSourceSearchStrictScopePartialCoverageAndDisabledBridge(t *testing.T) {
	fixture := sourceFixture()
	at := fixture.ObservedAt
	result := SourceSearchResult{Items: []SourceHit{{BrainID: brain, ConnectionID: op1, Source: fixture.Source, SourceVersion: fixture.SourceVersion, Ordinal: 1, Title: "Synthetic incident", Snippet: "permitted", SourceModifiedAt: at, ObservedAt: at, ACLValidUntil: fixture.ACLValidUntil}}, Total: 1, Coverage: SourceCoverage{Scope: "permitted_source_records", LatestObservedAt: &at, LatestSourceModifiedAt: &at}}
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var body map[string]json.RawMessage
		json.NewDecoder(r.Body).Decode(&body)
		if r.URL.RawQuery != "" || string(body["query"]) != `"private query"` {
			t.Error("source query escaped POST boundary")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(result)
	}))
	defer server.Close()
	h := transportFor(t, server.URL, 0)
	selectedBrain := brain
	if _, err := h.SourceSearch(context.Background(), org, "private query", &selectedBrain, 20, 0); err != nil {
		t.Fatal(err)
	}
	result.Items[0].BrainID = op2
	if _, err := h.SourceSearch(context.Background(), org, "private query", &selectedBrain, 20, 0); !errors.Is(err, ErrInvalidReceipt) {
		t.Fatal("cross-selected-brain hit accepted", err)
	}
	before := calls
	b := &Bridge{}
	w := httptest.NewRecorder()
	request := httptest.NewRequest("POST", "http://127.0.0.1/api/collaboration/accounts/alice/sources/search", strings.NewReader(`{"query":"private query","brain_id":null,"limit":20,"offset":0}`))
	if !b.sourceRequest(context.Background(), w, request, BridgeAccount{Transport: h}, []string{"accounts", "alice", "sources", "search"}) || w.Code != 404 || calls != before {
		t.Fatal("disabled source profile reached remote")
	}
}
