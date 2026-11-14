package federation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type credentialFunc func(context.Context, string) (Credential, error)

func (f credentialFunc) Credential(ctx context.Context, origin string) (Credential, error) {
	return f(ctx, origin)
}
func transportFor(t *testing.T, origin string, timeout time.Duration) *HTTPTransport {
	t.Helper()
	transport, err := NewHTTPTransport(HTTPTransportConfig{Origin: origin, UserID: user, Timeout: timeout, Credentials: credentialFunc(func(_ context.Context, selected string) (Credential, error) {
		return Credential{Origin: selected, UserID: user, BearerToken: "synthetic-test-token"}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(transport.CloseIdleConnections)
	return transport
}
func writeReceipt(w http.ResponseWriter, status int, r v1.Receipt) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(r)
}
func conflictReceipt(op v1.Operation) v1.Receipt {
	hash, _ := v1.OperationDigest(op)
	return v1.Receipt{SchemaVersion: v1.SchemaVersion, OrganizationID: op.OrganizationID, BrainID: op.BrainID, OperationID: op.OperationID, DeviceID: op.DeviceID, PageID: op.PageID, RequestSHA256: hash, Outcome: v1.Conflicted, Conflict: &v1.Conflict{Local: op.Payload, Server: &v1.Snapshot{RevisionID: revision, Revision: op.BaseRevision + 2, Content: v1.PageContent{Title: "Server synthetic", Body: "different writing", State: v1.Active}}}}
}

func TestHTTPTransportUsesSelectedOriginAccountAndCanonicalBody(t *testing.T) {
	op := operation(op1, 0, "Exact العربية\r\n日本語 👩🏽‍💻")
	requests := make(chan *http.Request, 1)
	bodies := make(chan []byte, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests <- r
		bodies <- body
		writeReceipt(w, http.StatusOK, accepted(op))
	}))
	defer server.Close()
	transport := transportFor(t, server.URL, 0)
	receipt, err := transport.Apply(context.Background(), op)
	if err != nil {
		t.Fatal(err)
	}
	if !receipt.Matches(op) {
		t.Fatal("receipt mismatch")
	}
	req := <-requests
	body := <-bodies
	canonical, _ := v1.EncodeOperation(op)
	if req.Method != http.MethodPost || req.URL.Path != "/v1/organizations/"+string(org)+"/brains/"+string(brain)+"/operations" || req.URL.RawQuery != "" || req.Header.Get("Authorization") != "Bearer synthetic-test-token" || req.Header.Get("Content-Type") != "application/json" || req.Header.Get("Cookie") != "" || !bytes.Equal(body, canonical) {
		t.Fatal("request changed origin, account credential or exact operation")
	}
}

func TestReceiptIgnoresUnicodeAliasesOfKnownFields(t *testing.T) {
	op := operation(op1, 0, "Synthetic writing")
	data, err := json.Marshal(accepted(op))
	if err != nil {
		t.Fatal(err)
	}
	data = append(data[:len(data)-1], []byte(",\"ſchema_version\":\"untrusted-addition\"}")...)
	if err := validateReceiptJSON(data); err != nil {
		t.Fatal(err)
	}
	receipt, err := decodeReceiptExact(data)
	if err != nil || !receipt.Matches(op) {
		t.Fatal("unknown Unicode alias overrode canonical field", err)
	}
}

func TestHTTPTransportRequiresExplicitSafeOrigin(t *testing.T) {
	for _, origin := range []string{"", "http://example.invalid", "http://127.0.0.1:1234/prefix", "https://user:password@example.invalid", "https://example.invalid?token=x", "https://example.invalid#fragment"} {
		t.Run(origin, func(t *testing.T) {
			_, err := NewHTTPTransport(HTTPTransportConfig{Origin: origin, UserID: user, Credentials: credentialFunc(func(context.Context, string) (Credential, error) {
				t.Fatal("configuration reached credentials")
				return Credential{}, nil
			})})
			if err == nil {
				t.Fatal("unsafe origin accepted")
			}
		})
	}
}

func TestHTTPTransportDoesNotForwardCredentialsOnRedirect(t *testing.T) {
	var forwarded atomic.Int64
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded.Add(1) }))
	defer destination.Close()
	var requests atomic.Int64
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	_, err := transportFor(t, source.URL, 0).Apply(context.Background(), operation(op1, 0, "Synthetic"))
	if !errors.Is(err, ErrUncertain) || forwarded.Load() != 0 || requests.Load() != 1 {
		t.Fatal("redirect followed or write retried", err)
	}
}

func TestHTTPTransportRejectsUnboundCredentialWithoutRequest(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	for _, kind := range []string{"origin", "account", "header"} {
		t.Run(kind, func(t *testing.T) {
			transport, err := NewHTTPTransport(HTTPTransportConfig{Origin: server.URL, UserID: user, Credentials: credentialFunc(func(_ context.Context, origin string) (Credential, error) {
				credential := Credential{Origin: origin, UserID: user, BearerToken: "synthetic"}
				switch kind {
				case "origin":
					credential.Origin = "https://other.invalid"
				case "account":
					credential.UserID = device
				case "header":
					credential.BearerToken = "bad\r\nheader"
				}
				return credential, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer transport.CloseIdleConnections()
			if _, err = transport.Apply(context.Background(), operation(op1, 0, "Synthetic")); !errors.Is(err, ErrAuthenticationRequired) {
				t.Fatal(err)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("unbound credential reached network")
	}
}

func TestHTTPTransportMapsAuthorityAndUncertainStatuses(t *testing.T) {
	for _, status := range []int{400, 401, 403, 404, 429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var calls atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls.Add(1)
				w.WriteHeader(status)
				_, _ = w.Write([]byte("synthetic-private-response"))
			}))
			defer server.Close()
			_, err := transportFor(t, server.URL, 0).Apply(context.Background(), operation(op1, 0, "Synthetic"))
			want := ErrUncertain
			if status == 401 {
				want = ErrAuthenticationRequired
			} else if status == 403 || status == 404 {
				want = ErrAccessDenied
			}
			if !errors.Is(err, want) || calls.Load() != 1 {
				t.Fatal("incorrect mapping or implicit retry", err)
			}
			if strings.Contains(err.Error(), "synthetic-private-response") {
				t.Fatal("response body leaked in error")
			}
		})
	}
}

func TestHTTPTransportAcceptsConflictReceiptAndAdditiveResponseFields(t *testing.T) {
	op := operation(op1, 0, "Synthetic")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		r := conflictReceipt(op)
		data, _ := json.Marshal(r)
		data = append(data[:len(data)-1], []byte(`,"future_metadata":{"supported":true}}`)...)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write(data)
	}))
	defer server.Close()
	r, err := transportFor(t, server.URL, 0).Apply(context.Background(), op)
	if err != nil || r.Outcome != v1.Conflicted || r.Conflict.Local != op.Payload {
		t.Fatal("valid conflict not preserved", err)
	}
}

func TestHTTPTransportRejectsAmbiguousOrMismatchedReceipts(t *testing.T) {
	op := operation(op1, 0, "Synthetic \ufffd")
	for _, kind := range []string{"scope", "hash", "revision", "status", "api_error", "duplicate", "case_alias", "missing_field", "trailing", "unicode", "content_type"} {
		t.Run(kind, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				receipt := accepted(op)
				status := http.StatusOK
				switch kind {
				case "scope":
					receipt.BrainID = device
				case "hash":
					receipt.RequestSHA256 = strings.Repeat("a", 64)
				case "revision":
					receipt.Revision = 3
				case "status":
					status = http.StatusConflict
				case "unicode":
					receipt = conflictReceipt(op)
					status = http.StatusConflict
				}
				data, _ := json.Marshal(receipt)
				switch kind {
				case "api_error":
					data = []byte(`{"code":"idempotency_conflict","field":null,"request_id":"66666666-6666-4666-8666-666666666666"}`)
					status = http.StatusConflict
				case "duplicate":
					data = append(data[:len(data)-1], []byte(`,"outcome":"accepted"}`)...)
				case "case_alias":
					data = append(data[:len(data)-1], []byte(`,"Outcome":"accepted"}`)...)
				case "missing_field":
					var object map[string]json.RawMessage
					_ = json.Unmarshal(data, &object)
					delete(object, "conflict")
					data, _ = json.Marshal(object)
				case "trailing":
					data = append(data, []byte(" {}")...)
				case "unicode":
					data = bytes.ReplaceAll(data, []byte("\ufffd"), []byte(`\ud800`))
				}
				contentType := "application/json"
				if kind == "content_type" {
					contentType = "text/plain"
				}
				w.Header().Set("Content-Type", contentType)
				w.WriteHeader(status)
				_, _ = w.Write(data)
			}))
			defer server.Close()
			if _, err := transportFor(t, server.URL, 0).Apply(context.Background(), op); !errors.Is(err, ErrInvalidReceipt) {
				t.Fatal("invalid receipt accepted", err)
			}
		})
	}
}

type spaceReader struct{}

func (spaceReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	return len(p), nil
}
func TestHTTPTransportBoundsStreamingResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.CopyN(w, spaceReader{}, MaxReceiptBytes+1)
	}))
	defer server.Close()
	if _, err := transportFor(t, server.URL, 0).Apply(context.Background(), operation(op1, 0, "Synthetic")); !errors.Is(err, ErrInvalidReceipt) {
		t.Fatal("oversize response accepted", err)
	}
}

func TestHTTPTransportCanSendLargestEscapedOperation(t *testing.T) {
	op := operation(op1, 0, strings.Repeat("\x01", v1.MaxBodyBytes))
	var valid atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(io.LimitReader(r.Body, v1.MaxRequestBytes+1))
		parsed, err := v1.DecodeOperation(data)
		valid.Store(err == nil && parsed == op)
		writeReceipt(w, http.StatusOK, accepted(op))
	}))
	defer server.Close()
	if _, err := transportFor(t, server.URL, 0).Apply(context.Background(), op); err != nil || !valid.Load() {
		t.Fatal("largest valid writing failed", err)
	}
}

func TestHTTPTimeoutRetainsExactOperationForExplicitRetry(t *testing.T) {
	op := operation(op1, 0, "Synthetic retry")
	var mu sync.Mutex
	var bodies [][]byte
	applied := map[v1.ID]v1.Receipt{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, _ := io.ReadAll(r.Body)
		parsed, err := v1.DecodeOperation(data)
		if err != nil {
			w.WriteHeader(400)
			return
		}
		mu.Lock()
		bodies = append(bodies, append([]byte(nil), data...))
		first := len(bodies) == 1
		receipt, ok := applied[parsed.OperationID]
		if !ok {
			receipt = accepted(parsed)
			applied[parsed.OperationID] = receipt
		}
		mu.Unlock()
		if first {
			<-r.Context().Done()
			return
		}
		writeReceipt(w, http.StatusOK, receipt)
	}))
	defer server.Close()
	store := newMemoryStore()
	e := engine(store, transportFor(t, server.URL, 20*time.Millisecond))
	enable(t, e)
	_, _ = e.Queue(context.Background(), testKey, op)
	if _, err := e.ProcessOne(context.Background(), testKey); !errors.Is(err, ErrUncertain) {
		t.Fatal(err)
	}
	entry, _ := e.Entry(context.Background(), testKey, op1)
	if entry.Status != Pending || entry.Operation != op {
		t.Fatal("timeout lost original operation")
	}
	e = engine(store, transportFor(t, server.URL, time.Second))
	if _, err := e.ProcessOne(context.Background(), testKey); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 || len(applied) != 1 || !bytes.Equal(bodies[0], bodies[1]) {
		t.Fatal("transport retried implicitly or changed operation")
	}
}
