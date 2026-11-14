package federation

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

const MaxReceiptBytes = 3*v1.MaxRequestBytes + 65536

// Credential must come from the selected account's verified, origin-bound login.
// It is never read from owner/browser credentials or global configuration here.
type Credential struct {
	Origin      string
	UserID      v1.ID
	BearerToken string
}
type CredentialSource interface {
	Credential(context.Context, string) (Credential, error)
}

type HTTPTransportConfig struct {
	Origin            string
	UserID            v1.ID
	Credentials       CredentialSource
	Timeout           time.Duration
	RequireGeneration bool
}

// HTTPTransport performs one application-level POST per Apply call. It does not
// refresh credentials, follow redirects, retry writes or enable an Engine.
type HTTPTransport struct {
	origin            string
	base              url.URL
	userID            v1.ID
	credentials       CredentialSource
	timeout           time.Duration
	client            *http.Client
	requireGeneration bool
}

func NewHTTPTransport(config HTTPTransportConfig) (*HTTPTransport, error) {
	u, err := url.Parse(config.Origin)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" || (u.Path != "" && u.Path != "/") || u.RawPath != "" {
		return nil, errors.New("an explicit service origin without credentials, path, query or fragment is required")
	}
	host := strings.ToLower(u.Hostname())
	loopback := host == "localhost" || (net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback())
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return nil, errors.New("remote service origins require HTTPS; HTTP is loopback-only")
	}
	if v1.ValidateID(config.UserID) != nil || config.Credentials == nil {
		return nil, errors.New("a verified account and explicit credential source are required")
	}
	timeout := config.Timeout
	if timeout == 0 {
		timeout = 15 * time.Second
	}
	if timeout < time.Millisecond || timeout > 30*time.Second {
		return nil, errors.New("transport timeout must be between one millisecond and thirty seconds")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Path = ""
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	if u.Scheme == "http" {
		// A localhost hosts-file override must not turn plaintext loopback transport
		// into a remote request. No environment proxy is used for this local path.
		transport.Proxy = nil
		dialer := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
		transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
			dialHost, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			if strings.EqualFold(dialHost, "localhost") {
				dialHost = "127.0.0.1"
			}
			ip := net.ParseIP(dialHost)
			if ip == nil || !ip.IsLoopback() {
				return nil, errors.New("plaintext transport destination is not loopback")
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(dialHost, port))
		}
	}
	return &HTTPTransport{origin: u.String(), base: *u, userID: config.UserID, credentials: config.Credentials, timeout: timeout, requireGeneration: config.RequireGeneration,
		client: &http.Client{Transport: transport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("service redirects are refused") }}}, nil
}

// Origin is the exact normalized origin a credential source must bind its token to.
func (h *HTTPTransport) Origin() string        { return h.origin }
func (h *HTTPTransport) AccountID() v1.ID      { return h.userID }
func (h *HTTPTransport) CloseIdleConnections() { h.client.CloseIdleConnections() }

func (h *HTTPTransport) Apply(ctx context.Context, op v1.Operation) (v1.Receipt, error) {
	if h.requireGeneration {
		return v1.Receipt{}, ErrGenerationReview
	}
	return h.apply(ctx, op, "")
}
func (h *HTTPTransport) RequiresGeneration() bool { return h.requireGeneration }
func (h *HTTPTransport) ApplyWithGeneration(ctx context.Context, op v1.Operation, generation v1.ID) (v1.Receipt, error) {
	if v1.ValidateID(generation) != nil {
		return v1.Receipt{}, ErrGenerationReview
	}
	return h.apply(ctx, op, generation)
}
func (h *HTTPTransport) apply(ctx context.Context, op v1.Operation, generation v1.ID) (v1.Receipt, error) {
	data, err := v1.EncodeOperation(op)
	if err != nil {
		return v1.Receipt{}, err
	}
	requestCtx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	credential, err := h.credentials.Credential(requestCtx, h.origin)
	if err != nil {
		if errors.Is(err, ErrAuthenticationRequired) {
			return v1.Receipt{}, ErrAuthenticationRequired
		}
		return v1.Receipt{}, ErrUncertain
	}
	if credential.Origin != h.origin || credential.UserID != h.userID || len(credential.BearerToken) == 0 || len(credential.BearerToken) > 16384 {
		return v1.Receipt{}, ErrAuthenticationRequired
	}
	for _, b := range []byte(credential.BearerToken) {
		if b < 0x21 || b > 0x7e {
			return v1.Receipt{}, ErrAuthenticationRequired
		}
	}
	u := h.base
	u.Path = "/v1/organizations/" + string(op.OrganizationID) + "/brains/" + string(op.BrainID) + "/operations"
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, u.String(), bytes.NewReader(data))
	if err != nil {
		return v1.Receipt{}, ErrUncertain
	}
	req.Header.Set("Authorization", "Bearer "+credential.BearerToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	req.Header.Set("User-Agent", "Atlas-federation/"+v1.SchemaVersion)
	if generation != "" {
		req.Header.Set("X-Muthur-Generation", string(generation))
	}
	response, err := h.client.Do(req)
	if err != nil {
		return v1.Receipt{}, ErrUncertain
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusUnauthorized:
		return v1.Receipt{}, ErrAuthenticationRequired
	case http.StatusForbidden, http.StatusNotFound:
		return v1.Receipt{}, ErrAccessDenied
	case http.StatusOK, http.StatusConflict:
	default:
		return v1.Receipt{}, ErrUncertain
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return v1.Receipt{}, ErrInvalidReceipt
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, MaxReceiptBytes+1))
	if err != nil {
		return v1.Receipt{}, ErrUncertain
	}
	if len(body) > MaxReceiptBytes {
		return v1.Receipt{}, ErrInvalidReceipt
	}
	if response.StatusCode == http.StatusConflict {
		var failure v1.APIError
		if v1.DecodeStrict(body, &failure) == nil && failure.Code == "cursor_reset" {
			return v1.Receipt{}, ErrCursorReset
		}
	}
	if validateReceiptJSON(body) != nil {
		return v1.Receipt{}, ErrInvalidReceipt
	}
	receipt, err := decodeReceiptExact(body)
	if err != nil || receipt.Validate() != nil || !receipt.Matches(op) {
		return v1.Receipt{}, ErrInvalidReceipt
	}
	if (response.StatusCode == http.StatusOK && receipt.Outcome != v1.Accepted) || (response.StatusCode == http.StatusConflict && receipt.Outcome != v1.Conflicted) {
		return v1.Receipt{}, ErrInvalidReceipt
	}
	return receipt, nil
}

// Decode only exact wire keys. encoding/json's case-insensitive struct matching
// must not let an unknown additive field override a canonical field.
func decodeReceiptExact(data []byte) (v1.Receipt, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return v1.Receipt{}, err
	}
	var result v1.Receipt
	for name, target := range map[string]any{
		"schema_version": &result.SchemaVersion, "organization_id": &result.OrganizationID,
		"brain_id": &result.BrainID, "operation_id": &result.OperationID,
		"device_id": &result.DeviceID, "page_id": &result.PageID,
		"request_sha256": &result.RequestSHA256, "outcome": &result.Outcome,
		"revision_id": &result.RevisionID, "revision": &result.Revision, "event_id": &result.EventID,
	} {
		if err := json.Unmarshal(fields[name], target); err != nil {
			return result, err
		}
	}
	if !jsonNull(fields["conflict"]) {
		var conflict map[string]json.RawMessage
		if err := json.Unmarshal(fields["conflict"], &conflict); err != nil {
			return result, err
		}
		result.Conflict = &v1.Conflict{}
		var err error
		if result.Conflict.Local, err = decodeContentExact(conflict["local"]); err != nil {
			return result, err
		}
		for name, target := range map[string]**v1.Snapshot{"base": &result.Conflict.Base, "server": &result.Conflict.Server} {
			if jsonNull(conflict[name]) {
				continue
			}
			var snapshot map[string]json.RawMessage
			if err := json.Unmarshal(conflict[name], &snapshot); err != nil {
				return result, err
			}
			value := &v1.Snapshot{}
			if err := json.Unmarshal(snapshot["revision_id"], &value.RevisionID); err != nil {
				return result, err
			}
			if err := json.Unmarshal(snapshot["revision"], &value.Revision); err != nil {
				return result, err
			}
			if value.Content, err = decodeContentExact(snapshot["content"]); err != nil {
				return result, err
			}
			*target = value
		}
	}
	return result, nil
}

func decodeContentExact(data []byte) (v1.PageContent, error) {
	var fields map[string]json.RawMessage
	var content v1.PageContent
	if err := json.Unmarshal(data, &fields); err != nil {
		return content, err
	}
	for name, target := range map[string]any{"title": &content.Title, "body": &content.Body, "state": &content.State} {
		if err := json.Unmarshal(fields[name], target); err != nil {
			return content, err
		}
	}
	return content, nil
}

// Response fields may be added compatibly, but ambiguous JSON is rejected. Reuse
// the canonical strict decoder for each content-bearing snapshot so malformed
// Unicode cannot be silently replaced while preserving base/local/server writing.
func validateReceiptJSON(data []byte) error {
	if !utf8.Valid(data) {
		return ErrInvalidReceipt
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var read func(int) error
	read = func(depth int) error {
		if depth > 16 {
			return ErrInvalidReceipt
		}
		token, err := decoder.Token()
		if err != nil {
			return ErrInvalidReceipt
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delimiter {
		case '{':
			seen := map[string]bool{}
			for decoder.More() {
				key, err := decoder.Token()
				name, ok := key.(string)
				folded := strings.ToLower(name)
				if err != nil || !ok || seen[folded] {
					return ErrInvalidReceipt
				}
				seen[folded] = true
				if err = read(depth + 1); err != nil {
					return err
				}
			}
		case '[':
			for decoder.More() {
				if err := read(depth + 1); err != nil {
					return err
				}
			}
		default:
			return ErrInvalidReceipt
		}
		if _, err := decoder.Token(); err != nil {
			return ErrInvalidReceipt
		}
		return nil
	}
	if err := read(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return ErrInvalidReceipt
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil {
		return ErrInvalidReceipt
	}
	for _, name := range []string{"schema_version", "organization_id", "brain_id", "operation_id", "device_id", "page_id", "request_sha256", "outcome", "revision_id", "revision", "event_id", "conflict"} {
		if len(fields[name]) == 0 {
			return ErrInvalidReceipt
		}
	}
	for _, name := range []string{"schema_version", "organization_id", "brain_id", "operation_id", "device_id", "page_id", "request_sha256", "outcome", "revision"} {
		if jsonNull(fields[name]) {
			return ErrInvalidReceipt
		}
	}
	if conflict := fields["conflict"]; len(conflict) > 0 && !bytes.Equal(bytes.TrimSpace(conflict), []byte("null")) {
		var snapshots map[string]json.RawMessage
		if json.Unmarshal(conflict, &snapshots) != nil {
			return ErrInvalidReceipt
		}
		for _, name := range []string{"base", "local", "server"} {
			raw := snapshots[name]
			if len(raw) == 0 {
				return ErrInvalidReceipt
			}
			if len(raw) > 0 && !bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				var object map[string]json.RawMessage
				if v1.DecodeStrict(raw, &object) != nil {
					return ErrInvalidReceipt
				}
				if name == "local" {
					if !contentShape(object) {
						return ErrInvalidReceipt
					}
				} else {
					for _, field := range []string{"revision_id", "revision", "content"} {
						if len(object[field]) == 0 || jsonNull(object[field]) {
							return ErrInvalidReceipt
						}
					}
					var content map[string]json.RawMessage
					if json.Unmarshal(object["content"], &content) != nil || !contentShape(content) {
						return ErrInvalidReceipt
					}
				}
			}
		}
	}
	return nil
}

func jsonNull(raw json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(raw), []byte("null")) }
func contentShape(content map[string]json.RawMessage) bool {
	for _, field := range []string{"title", "body", "state"} {
		if len(content[field]) == 0 || jsonNull(content[field]) {
			return false
		}
	}
	return true
}
