package federation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

var ErrRequestRejected = errors.New("request rejected; revise input before retry")
var ErrConversationConflict = errors.New("conversation version changed; explicit new conversation required")

// RemoteJSON is restricted to paths constructed in this package; callers never
// provide an origin or arbitrary URL. Credentials remain server-side.
func (h *HTTPTransport) remoteJSON(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	return h.remoteJSONGeneration(ctx, method, path, body, "")
}
func (h *HTTPTransport) remoteJSONGeneration(ctx context.Context, method, path string, body any, generation v1.ID) (json.RawMessage, error) {
	if method == http.MethodGet {
		data, err := h.readJSON(ctx, path)
		if err != nil {
			return nil, err
		}
		if documentJSON(data) != nil {
			return nil, ErrInvalidReceipt
		}
		return data, nil
	}
	data, err := json.Marshal(body)
	if err != nil || len(data) > 65536 {
		return nil, ErrInvalidReceipt
	}
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	credential, err := h.credentials.Credential(ctx, h.origin)
	if err != nil {
		return nil, ErrAuthenticationRequired
	}
	if credential.Origin != h.origin || credential.UserID != h.userID || len(credential.BearerToken) == 0 || len(credential.BearerToken) > 16384 {
		return nil, ErrAuthenticationRequired
	}
	for _, b := range []byte(credential.BearerToken) {
		if b < 0x21 || b > 0x7e {
			return nil, ErrAuthenticationRequired
		}
	}
	u := h.base
	u.Path = path
	req, err := http.NewRequestWithContext(ctx, method, u.String(), bytes.NewReader(data))
	if err != nil {
		return nil, ErrUncertain
	}
	req.Header.Set("Authorization", "Bearer "+credential.BearerToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	if generation != "" {
		if v1.ValidateID(generation) != nil {
			return nil, ErrInvalidReceipt
		}
		req.Header.Set("X-Muthur-Generation", string(generation))
	}
	response, err := h.client.Do(req)
	if err != nil {
		return nil, ErrUncertain
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case 200:
	case 400:
		return nil, ErrRequestRejected
	case 401:
		return nil, ErrAuthenticationRequired
	case 403, 404:
		return nil, ErrAccessDenied
	case 409:
		return nil, ErrConflict
	default:
		return nil, ErrUncertain
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return nil, ErrInvalidReceipt
	}
	result, err := io.ReadAll(io.LimitReader(response.Body, MaxReceiptBytes+1))
	if err != nil {
		return nil, ErrUncertain
	}
	if len(result) > MaxReceiptBytes || documentJSON(result) != nil {
		return nil, ErrInvalidReceipt
	}
	return result, nil
}

func (h *HTTPTransport) ListBrains(ctx context.Context, org v1.ID) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil {
		return nil, ErrAccessDenied
	}
	return h.remoteJSON(ctx, http.MethodGet, "/v1/organizations/"+string(org)+"/membership/brains", nil)
}
func (h *HTTPTransport) ListMembers(ctx context.Context, org v1.ID) (json.RawMessage, error) {
	return h.ListMembersPage(ctx, org, 0)
}
func (h *HTTPTransport) ListMembersPage(ctx context.Context, org v1.ID, offset int) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || offset < 0 || offset > 10000 {
		return nil, ErrInvalidReceipt
	}
	data, err := h.readJSONQuery(ctx, "/v1/organizations/"+string(org)+"/membership/members", url.Values{"offset": {strconv.Itoa(offset)}, "limit": {"50"}}.Encode())
	if err != nil {
		return nil, err
	}
	if documentJSON(data) != nil {
		return nil, ErrInvalidReceipt
	}
	return data, nil
}
func (h *HTTPTransport) WikiSearch(ctx context.Context, org v1.ID, query string) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || len(query) > 512 {
		return nil, ErrInvalidReceipt
	}
	return h.remoteJSON(ctx, http.MethodPost, "/v1/organizations/"+string(org)+"/wiki/search", map[string]any{"query": query, "kinds": []string{}, "brain_id": nil, "offset": 0})
}
func (h *HTTPTransport) WikiProjection(ctx context.Context, org, brain, page v1.ID, view string) (json.RawMessage, error) {
	for _, id := range []v1.ID{org, brain, page} {
		if v1.ValidateID(id) != nil {
			return nil, ErrAccessDenied
		}
	}
	suffix := ""
	switch view {
	case "record":
	case "history":
		suffix = "/timeline"
	case "graph":
		suffix = "/graph"
	default:
		return nil, ErrAccessDenied
	}
	return h.remoteJSON(ctx, http.MethodGet, brainPath(org, brain)+"/wiki/records/"+string(page)+suffix, nil)
}

type ChatRequest struct {
	ConversationID  *v1.ID `json:"conversation_id"`
	ExpectedVersion int64  `json:"expected_version"`
	OperationID     v1.ID  `json:"operation_id"`
	Message         string `json:"message"`
	PageID          *v1.ID `json:"page_id"`
}

func (h *HTTPTransport) Chat(ctx context.Context, org, brain v1.ID, request ChatRequest) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil || v1.ValidateID(request.OperationID) != nil || request.ExpectedVersion < 0 || request.ExpectedVersion >= v1.MaxRevision || len(strings.TrimSpace(request.Message)) == 0 || len(request.Message) > 4096 || !utf8.ValidString(request.Message) || strings.ContainsRune(request.Message, 0) {
		return nil, ErrRequestRejected
	}
	if request.ConversationID != nil && v1.ValidateID(*request.ConversationID) != nil || request.PageID != nil && v1.ValidateID(*request.PageID) != nil {
		return nil, ErrInvalidReceipt
	}
	data, err := h.remoteJSON(ctx, http.MethodPost, brainPath(org, brain)+"/chat/turns", request)
	if errors.Is(err, ErrConflict) {
		return nil, ErrConversationConflict
	}
	return data, err
}

// ConfirmChatProposal carries only the exact reviewed server proposal hash. The
// server binds actor, scope, immutable base and generation; there is no write tool.
func (h *HTTPTransport) ConfirmChatProposal(ctx context.Context, org, brain, proposal v1.ID, hash string) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil || v1.ValidateID(proposal) != nil || !validSHA256(hash) {
		return nil, ErrInvalidReceipt
	}
	return h.remoteJSON(ctx, http.MethodPost, brainPath(org, brain)+"/chat/proposals/"+string(proposal)+"/apply", map[string]string{"sha256": hash})
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
