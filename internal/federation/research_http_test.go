package federation

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func TestResearchAdapterFixedScopeCredentialAndDedicatedBounds(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer synthetic-test-token" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Browser-Actor") != "" {
			t.Error("caller credentials leaked")
		}
		data, _ := io.ReadAll(r.Body)
		if r.Method == "POST" && len(data) < 65536 {
			t.Error("research request truncated to unrelated route bound")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"synthetic":"` + strings.Repeat("x", 262144) + `"}`))
	}))
	defer server.Close()
	h := transportFor(t, server.URL, 0)
	client, err := h.ResearchHTTPClient(org, brain)
	if err != nil {
		t.Fatal(err)
	}
	base := server.URL + brainPath(org, brain) + "/research"
	for _, path := range []string{base + "/state?actor=other", base + "/other", server.URL + brainPath(org, v1.ID(device)) + "/research/state", "https://other.invalid" + brainPath(org, brain) + "/research/state"} {
		if _, err := client.Get(path); err == nil {
			t.Fatal("scope escaped", path)
		}
	}
	if calls != 0 {
		t.Fatal("invalid scope made network request")
	}
	req, _ := http.NewRequestWithContext(context.Background(), "POST", base+"/operations", strings.NewReader(strings.Repeat("x", 300000)))
	req.Header.Set("Authorization", "Bearer browser-secret")
	req.Header.Set("Cookie", "browser=secret")
	req.Header.Set("X-Browser-Actor", "other")
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || len(data) < 262144 || calls != 1 {
		t.Fatal("research document response rejected", err)
	}
	if _, err = client.Post(base+"/operations", "application/json", strings.NewReader(strings.Repeat("x", 512*1024+1))); err == nil || calls != 1 {
		t.Fatal("oversized research request sent")
	}
}

func TestResearchBridgeRequiresFeatureSessionSelectionAndCSRF(t *testing.T) {
	r, _, _ := realReplica(t)
	h, err := NewHTTPTransport(HTTPTransportConfig{Origin: r.Identity().Origin, UserID: user, RequireGeneration: true, Credentials: credentialFunc(func(_ context.Context, origin string) (Credential, error) {
		return Credential{Origin: origin, UserID: user, BearerToken: "synthetic"}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	calls := 0
	config := BridgeConfig{Origin: "http://127.0.0.1:19877", Accounts: []BridgeAccount{{ID: "alice", Replica: r, Transport: h}}, ResearchHandler: func(_ context.Context, w http.ResponseWriter, _ *http.Request, a BridgeAccount, selected v1.ID) {
		calls++
		if a.Replica.Identity().UserID != user || selected != brain {
			t.Error("wrong verified scope")
		}
		w.WriteHeader(200)
	}}
	b, _, err := NewBridge(config)
	if err != nil {
		t.Fatal(err)
	}
	path := config.Origin + "/api/collaboration/accounts/alice/brains/" + string(brain) + "/research/state"
	call := func(method string, authenticated, csrf bool) int {
		req := httptest.NewRequest(method, path, nil)
		req.Header.Set("Origin", config.Origin)
		if authenticated {
			req.AddCookie(&http.Cookie{Name: "atlas_collaboration", Value: b.session})
		}
		if csrf {
			req.Header.Set("X-Atlas-CSRF", b.csrf)
		}
		w := httptest.NewRecorder()
		b.ServeHTTP(w, req)
		return w.Code
	}
	if call("GET", false, false) != 401 || call("GET", true, false) != 404 {
		t.Fatal("feature/session boundary")
	}
	a := b.accounts["alice"]
	a.ResearchEnabled = true
	b.accounts["alice"] = a
	if call("GET", true, false) != 403 {
		t.Fatal("unselected research scope opened")
	}
	if err := r.Engine(h).Enable(context.Background(), r.key(brain), 1); err != nil {
		t.Fatal(err)
	}
	if call("POST", true, false) != 403 || call("GET", true, false) != 200 || calls != 1 {
		t.Fatal("CSRF/selected scope boundary")
	}
	if err := r.Engine(h).Disable(context.Background(), r.key(brain)); err != nil {
		t.Fatal(err)
	}
	if call("GET", true, false) != 403 || calls != 1 {
		t.Fatal("disabled research scope resumed")
	}
}
