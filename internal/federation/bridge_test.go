package federation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestBridgeLocalSessionOriginCSRFAndStrictWritingBoundary(t *testing.T) {
	r, _, _ := realReplica(t)
	h, err := NewHTTPTransport(HTTPTransportConfig{Origin: "https://synthetic.invalid", UserID: user, RequireGeneration: true, Credentials: credentialFunc(func(_ context.Context, origin string) (Credential, error) {
		return Credential{Origin: origin, UserID: user, BearerToken: "synthetic"}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.CloseIdleConnections()
	origin := "http://127.0.0.1:19876"
	b, code, err := NewBridge(BridgeConfig{Origin: origin, Accounts: []BridgeAccount{{ID: "alice", Name: "Synthetic Alice", Replica: r, Transport: h}}, Assets: fstest.MapFS{"workspace.html": {Data: []byte("synthetic asset")}, "private.json": {Data: []byte("never serve")}}})
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body, selectedOrigin, csrf string, cookie *http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, origin+path, strings.NewReader(body))
		if selectedOrigin != "" {
			req.Header.Set("Origin", selectedOrigin)
		}
		req.Header.Set("Content-Type", "application/json")
		if csrf != "" {
			req.Header.Set("X-Atlas-CSRF", csrf)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		b.ServeHTTP(w, req)
		return w
	}
	if w := call("GET", "/api/collaboration/profiles", "", "", "", nil); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := call("POST", "/api/collaboration/session", `{"code":"`+code+`"}`, "http://other.invalid", "", nil); w.Code != 403 {
		t.Fatal("cross-origin setup accepted", w.Code)
	}
	w := call("POST", "/api/collaboration/session", `{"code":"`+code+`"}`, origin, "", nil)
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("local cookie boundary weakened")
	}
	var session struct {
		CSRF string `json:"csrf"`
	}
	if json.Unmarshal(w.Body.Bytes(), &session) != nil || session.CSRF == "" {
		t.Fatal("session missing memory CSRF")
	}
	if w = call("POST", "/api/collaboration/session", `{"code":"`+code+`"}`, origin, "", nil); w.Code != 401 {
		t.Fatal("setup code replay accepted")
	}
	if w = call("POST", "/api/collaboration/accounts/alice/brains/"+string(brain)+"/sync", "{}", origin, "", cookie); w.Code != 403 {
		t.Fatal("missing CSRF accepted")
	}
	if w = call("GET", "/private.json", "", "", "", nil); w.Code != 404 {
		t.Fatal("runtime-like static file exposed")
	}
	e := r.Engine(h)
	if err = e.Enable(context.Background(), r.key(brain), 1); err != nil {
		t.Fatal(err)
	}
	if _, err = r.db.Exec(`INSERT INTO replica_selected_authority VALUES(?,?,?,1)`, string(org), string(brain), string(user)); err != nil {
		t.Fatal(err)
	}
	path := "/api/collaboration/accounts/alice/brains/" + string(brain) + "/pages/" + string(page) + "/edit"
	for _, body := range []string{`{"edit_id":"` + string(op1) + `","expected_version":0,"content":{"title":"Synthetic","state":"active"}}`, `{"edit_id":"` + string(op1) + `","expected_version":0,"content":{"title":"Synthetic","body":"\ud800","state":"active"}}`} {
		if w = call("POST", path, body, origin, session.CSRF, cookie); w.Code != 400 {
			t.Fatal("malformed writing accepted", w.Code)
		}
	}
	if w = call("POST", path, `{"edit_id":"`+string(op1)+`","expected_version":0,"content":{"title":"Synthetic","body":"Exact 日本語\r\n","state":"active"}}`, origin, session.CSRF, cookie); w.Code != 200 {
		t.Fatal("valid atomic local save rejected", w.Code)
	}
	if w = call("GET", "/api/collaboration/accounts/unknown/brains/"+string(brain)+"/state", "", "", "", cookie); w.Code != 404 {
		t.Fatal("unknown account accepted", w.Code)
	}
}
