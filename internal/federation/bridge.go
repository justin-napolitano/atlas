package federation

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

// BridgeAccount is supplied by a trusted launcher, never a browser request.
// Each account has a separate immutable replica and delegated credential source.
type BridgeAccount struct {
	ID, Name        string
	Replica         *Replica
	Transport       *HTTPTransport
	ChatEnabled     bool
	GoldEnabled     bool
	SourcesEnabled  bool
	ResearchEnabled bool
}
type BridgeConfig struct {
	Origin              string
	Accounts            []BridgeAccount
	Assets              fs.FS
	PrivateWorkspaceURL string
	// ResearchHandler is a trusted launcher injection. It must bind its client to
	// the supplied identity/brain and retain upstream authorization checks. No
	// browser-supplied URL or actor is accepted by this bridge.
	ResearchHandler func(context.Context, http.ResponseWriter, *http.Request, BridgeAccount, v1.ID)
}
type Bridge struct {
	config              BridgeConfig
	accounts            map[string]BridgeAccount
	mu                  sync.Mutex
	code, session, csrf string
	codeUsed            bool
	expires             time.Time
}

// NewBridge returns a one-time local setup code separately. The caller must hand
// it to the operator privately, never in URLs, logs, assets or configuration.
func NewBridge(config BridgeConfig) (*Bridge, string, error) {
	u, err := url.Parse(config.Origin)
	if err != nil || u.Scheme != "http" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || u.ForceQuery {
		return nil, "", ErrAccessDenied
	}
	b := &Bridge{config: config, accounts: map[string]BridgeAccount{}, expires: time.Now().Add(30 * time.Minute)}
	if config.PrivateWorkspaceURL != "" {
		owner, err := url.Parse(config.PrivateWorkspaceURL)
		if err != nil || (owner.Scheme != "http" && owner.Scheme != "https") || owner.Host == "" || owner.User != nil || owner.RawQuery != "" || owner.Fragment != "" {
			return nil, "", ErrAccessDenied
		}
	}
	for _, a := range config.Accounts {
		if a.ID == "" || len(a.ID) > 80 || strings.ContainsAny(a.ID, "/\\?%# ") || a.Replica == nil || a.Transport == nil || a.Transport.Origin() != a.Replica.identity.Origin || a.Transport.AccountID() != a.Replica.identity.UserID || b.accounts[a.ID].Replica != nil {
			return nil, "", ErrAccessDenied
		}
		if err := a.Replica.WorkspaceReady(context.Background()); err != nil {
			return nil, "", err
		}
		if !a.Transport.RequiresGeneration() {
			return nil, "", ErrGenerationReview
		}
		b.accounts[a.ID] = a
	}
	if len(b.accounts) == 0 {
		return nil, "", ErrAccessDenied
	}
	for _, target := range []*string{&b.code, &b.session, &b.csrf} {
		var raw [32]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return nil, "", err
		}
		*target = hex.EncodeToString(raw[:])
	}
	return b, b.code, nil
}

func (b *Bridge) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'")
	u, _ := url.Parse(b.config.Origin)
	if r.Host != u.Host {
		bridgeError(w, 403, "local_origin_required")
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/collaboration/") {
		if b.config.Assets == nil {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/workspace.html?collaboration=1", http.StatusFound)
			return
		}
		if r.URL.Path != "/workspace.html" && !strings.HasPrefix(r.URL.Path, "/assets/") {
			http.NotFound(w, r)
			return
		}
		http.FileServer(http.FS(b.config.Assets)).ServeHTTP(w, r)
		return
	}
	if r.URL.RawQuery != "" || r.Header.Get("Origin") != "" && r.Header.Get("Origin") != b.config.Origin || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		bridgeError(w, 403, "local_origin_required")
		return
	}
	if r.Method != http.MethodGet && r.Header.Get("Origin") != b.config.Origin {
		bridgeError(w, 403, "local_origin_required")
		return
	}
	if r.URL.Path == "/api/collaboration/session" {
		b.sessionRequest(w, r)
		return
	}
	if !b.authenticated(r) {
		bridgeError(w, 401, "local_session_required")
		return
	}
	if r.Method != http.MethodGet && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Atlas-CSRF")), []byte(b.csrf)) != 1 {
		bridgeError(w, 403, "csrf_required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/collaboration/"), "/")
	if len(parts) == 1 && parts[0] == "profiles" && r.Method == http.MethodGet {
		items := []map[string]any{}
		for _, a := range b.config.Accounts {
			items = append(items, map[string]any{"id": a.ID, "name": a.Name, "user_id": a.Replica.identity.UserID, "organization_id": a.Replica.identity.OrganizationID, "chat_enabled": a.ChatEnabled, "gold_enabled": a.GoldEnabled, "sources_enabled": a.SourcesEnabled, "research_enabled": a.ResearchEnabled})
		}
		bridgeJSON(w, 200, map[string]any{"items": items, "private_workspace_url": b.config.PrivateWorkspaceURL})
		return
	}
	if len(parts) < 3 || parts[0] != "accounts" {
		bridgeError(w, 404, "resource_unavailable")
		return
	}
	a, ok := b.accounts[parts[1]]
	if !ok {
		bridgeError(w, 404, "resource_unavailable")
		return
	}
	if b.sourceRequest(ctx, w, r, a, parts) {
		return
	}
	if len(parts) == 3 && parts[2] == "members" && r.Method == http.MethodGet {
		value, err := a.Transport.ListMembers(ctx, a.Replica.identity.OrganizationID)
		b.result(w, value, err)
		return
	}
	if len(parts) == 3 && parts[2] == "members" && r.Method == http.MethodPost {
		var request struct {
			Offset *int `json:"offset"`
		}
		if bridgeDecode(r, &request, "offset") != nil || request.Offset == nil {
			bridgeError(w, 400, "invalid_request")
			return
		}
		value, err := a.Transport.ListMembersPage(ctx, a.Replica.identity.OrganizationID, *request.Offset)
		b.result(w, value, err)
		return
	}
	if len(parts) == 3 && parts[2] == "brains" && r.Method == http.MethodGet {
		value, err := a.Transport.ListBrains(ctx, a.Replica.identity.OrganizationID)
		if err != nil {
			items, localErr := a.Replica.CachedBrains(ctx)
			if localErr == nil {
				bridgeJSON(w, 200, map[string]any{"items": items, "offline": true})
				return
			}
		}
		b.result(w, value, err)
		return
	}
	if len(parts) == 3 && parts[2] == "search" && r.Method == http.MethodPost {
		var request struct {
			Query      string            `json:"query"`
			Properties map[string]string `json:"properties"`
			BrainName  string            `json:"brain_name"`
			Offset     int               `json:"offset"`
		}
		if bridgeDecode(r, &request, "query", "properties", "brain_name", "offset") != nil {
			bridgeError(w, 400, "invalid_request")
			return
		}
		value, err := a.Transport.NoteSearch(ctx, a.Replica.identity.OrganizationID, request.Query, request.Properties, request.BrainName, request.Offset)
		b.result(w, value, err)
		return
	}
	if len(parts) < 5 || parts[2] != "brains" || v1.ValidateID(v1.ID(parts[3])) != nil {
		bridgeError(w, 404, "resource_unavailable")
		return
	}
	brain := v1.ID(parts[3])
	if parts[4] == "research" {
		if !a.ResearchEnabled || b.config.ResearchHandler == nil {
			bridgeError(w, 404, "resource_unavailable")
			return
		}
		state, err := a.Replica.Engine(a.Transport).State(ctx, a.Replica.key(brain))
		if err != nil || !state.Enabled || state.Revoked {
			bridgeError(w, 403, "selected_brain_required")
			return
		}
		b.config.ResearchHandler(ctx, w, r, a, brain)
		return
	}
	if len(parts) >= 6 && parts[4] == "gold" {
		if !a.GoldEnabled {
			bridgeError(w, 404, "resource_unavailable")
			return
		}
		if len(parts) == 6 && r.Method == http.MethodGet {
			value, err := a.Transport.GoldRead(ctx, a.Replica.identity.OrganizationID, brain, parts[5], "", "")
			b.result(w, value, err)
			return
		}
		if len(parts) == 9 && parts[5] == "proposals" && parts[7] == "pages" && r.Method == http.MethodGet {
			value, err := a.Transport.GoldRead(ctx, a.Replica.identity.OrganizationID, brain, "page", v1.ID(parts[6]), v1.ID(parts[8]))
			b.result(w, value, err)
			return
		}
		if len(parts) == 6 && parts[5] == "proposals" && r.Method == http.MethodPost {
			var request GoldProposalRequest
			if bridgeDecode(r, &request, "generation_id", "manifest", "audience_user_ids") != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			value, err := a.Transport.GoldPropose(ctx, a.Replica.identity.OrganizationID, brain, request)
			b.result(w, value, err)
			return
		}
		if len(parts) == 6 && parts[5] == "decisions" && r.Method == http.MethodPost {
			var request GoldDecisionRequest
			if bridgeDecode(r, &request, "generation_id", "decision_id", "proposal_id", "manifest_sha256", "expected_state_id", "kind", "reason") != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			value, err := a.Transport.GoldDecide(ctx, a.Replica.identity.OrganizationID, brain, request)
			b.result(w, value, err)
			return
		}
		bridgeError(w, 404, "resource_unavailable")
		return
	}
	if len(parts) == 8 && parts[4] == "chat" && parts[5] == "proposals" && parts[7] == "apply" && r.Method == http.MethodPost {
		if !a.ChatEnabled {
			bridgeError(w, 503, "chat_unavailable")
			return
		}
		var request struct {
			SHA256 string `json:"sha256"`
		}
		if bridgeDecode(r, &request, "sha256") != nil {
			bridgeError(w, 400, "invalid_request")
			return
		}
		value, err := a.Transport.ConfirmChatProposal(ctx, a.Replica.identity.OrganizationID, brain, v1.ID(parts[6]), request.SHA256)
		b.result(w, value, err)
		return
	}
	e := a.Replica.Engine(a.Transport)
	key := a.Replica.key(brain)
	if len(parts) == 5 {
		switch parts[4] {
		case "export":
			if r.Method != http.MethodPost {
				break
			}
			if bridgeEmpty(r) != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			b.exportNotes(ctx, w, a, brain)
			return
		case "open":
			if r.Method != http.MethodPost {
				break
			}
			if bridgeEmpty(r) != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			state, err := e.State(ctx, key)
			if err != nil || state.MembershipEpoch == 0 {
				b.result(w, nil, ErrNotFound)
				return
			}
			b.state(w, ctx, a, brain)
			return
		case "select":
			if r.Method != http.MethodPost {
				break
			}
			if bridgeEmpty(r) != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			_, err := a.Replica.SelectWorkspace(ctx, a.Transport, brain)
			if err != nil {
				b.result(w, nil, err)
				return
			}
			b.state(w, ctx, a, brain)
			return
		case "state":
			if r.Method != http.MethodGet {
				break
			}
			b.state(w, ctx, a, brain)
			return
		case "disable":
			if r.Method != http.MethodPost {
				break
			}
			if bridgeEmpty(r) != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			err := e.Disable(ctx, key)
			b.result(w, map[string]bool{"disabled": err == nil}, err)
			return
		case "sync":
			if r.Method != http.MethodPost {
				break
			}
			if bridgeEmpty(r) != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			result, err := a.Replica.Synchronize(ctx, e, a.Transport, brain)
			b.result(w, result, err)
			return
		case "chat":
			if r.Method != http.MethodPost {
				break
			}
			if !a.ChatEnabled {
				bridgeError(w, 503, "chat_unavailable")
				return
			}
			var request ChatRequest
			if bridgeDecode(r, &request, "conversation_id", "expected_version", "operation_id", "message", "page_id") != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			value, err := a.Transport.Chat(ctx, key.OrganizationID, brain, request)
			b.result(w, value, err)
			return
		}
	}
	if len(parts) < 7 || parts[4] != "pages" || v1.ValidateID(v1.ID(parts[5])) != nil {
		bridgeError(w, 404, "resource_unavailable")
		return
	}
	page := v1.ID(parts[5])
	if len(parts) != 7 {
		bridgeError(w, 404, "resource_unavailable")
		return
	}
	switch parts[6] {
	case "edit":
		if r.Method != http.MethodPost {
			break
		}
		canWrite, err := a.Replica.CanWrite(ctx, brain)
		if err != nil || !canWrite {
			b.result(w, nil, ErrAccessDenied)
			return
		}
		var request struct {
			EditID          v1.ID          `json:"edit_id"`
			ExpectedVersion int64          `json:"expected_version"`
			Content         v1.PageContent `json:"content"`
		}
		if bridgeDecode(r, &request, "edit_id", "expected_version", "content") != nil {
			bridgeError(w, 400, "invalid_request")
			return
		}
		current, err := a.Replica.SaveWorking(ctx, brain, page, request.EditID, request.ExpectedVersion, request.Content)
		if err != nil {
			b.result(w, nil, err)
			return
		}
		bridgeJSON(w, 200, pageDTO(ctx, e, key, current))
		return
	case "resolve", "resolve-generation":
		if r.Method != http.MethodPost {
			break
		}
		canWrite, err := a.Replica.CanWrite(ctx, brain)
		if err != nil || !canWrite {
			b.result(w, nil, ErrAccessDenied)
			return
		}
		if parts[6] == "resolve-generation" {
			var request struct {
				Version        int64 `json:"version"`
				ServerRevision int64 `json:"server_revision"`
			}
			if bridgeDecode(r, &request, "version", "server_revision") != nil {
				bridgeError(w, 400, "invalid_request")
				return
			}
			entry, err := a.Replica.ResolveGeneration(ctx, e, brain, page, request.Version, request.ServerRevision)
			b.result(w, map[string]any{"operation_id": entry.Operation.OperationID}, err)
			return
		}
		var request struct {
			OperationID    v1.ID `json:"operation_id"`
			Version        int64 `json:"version"`
			ServerRevision int64 `json:"server_revision"`
		}
		if bridgeDecode(r, &request, "operation_id", "version", "server_revision") != nil {
			bridgeError(w, 400, "invalid_request")
			return
		}
		entry, err := a.Replica.ResolveWorking(ctx, e, brain, page, request.OperationID, request.Version, request.ServerRevision)
		b.result(w, map[string]any{"operation_id": entry.Operation.OperationID}, err)
		return
	case "history", "graph", "record":
		if r.Method != http.MethodGet {
			break
		}
		value, err := a.Transport.WikiProjection(ctx, key.OrganizationID, brain, page, parts[6])
		if errors.Is(err, ErrAccessDenied) {
			state, _ := e.State(ctx, key)
			err = e.revoke(ctx, key, state.AccessGeneration)
		}
		b.result(w, value, err)
		return
	}
	bridgeError(w, 405, "method_not_allowed")
}

func (b *Bridge) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie("atlas_collaboration")
	return err == nil && time.Now().Before(b.expires) && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(b.session)) == 1
}
func (b *Bridge) sessionRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && b.authenticated(r) {
		bridgeJSON(w, 200, map[string]any{"csrf": b.csrf, "expires_at": b.expires.Format(time.RFC3339)})
		return
	}
	if r.Method != http.MethodPost {
		bridgeError(w, 401, "local_session_required")
		return
	}
	var request struct {
		Code string `json:"code"`
	}
	if bridgeDecode(r, &request, "code") != nil {
		bridgeError(w, 400, "invalid_request")
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.codeUsed || !time.Now().Before(b.expires) || subtle.ConstantTimeCompare([]byte(request.Code), []byte(b.code)) != 1 {
		bridgeError(w, 401, "local_session_required")
		return
	}
	b.codeUsed = true
	http.SetCookie(w, &http.Cookie{Name: "atlas_collaboration", Value: b.session, Path: "/api/collaboration/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 1800})
	bridgeJSON(w, 200, map[string]any{"csrf": b.csrf, "expires_at": b.expires.Format(time.RFC3339)})
}

func bridgeDecode(r *http.Request, target any, keys ...string) error {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return ErrInvalidReceipt
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, v1.MaxRequestBytes+1))
	if err != nil || len(data) > v1.MaxRequestBytes {
		return ErrInvalidReceipt
	}
	var fields map[string]json.RawMessage
	if v1.DecodeStrict(data, &fields) != nil || len(fields) != len(keys) {
		return ErrInvalidReceipt
	}
	for _, key := range keys {
		if len(fields[key]) == 0 {
			return ErrInvalidReceipt
		}
	}
	if content, ok := fields["content"]; ok {
		var f map[string]json.RawMessage
		if json.Unmarshal(content, &f) != nil || len(f) != 3 || !contentShape(f) {
			return ErrInvalidReceipt
		}
	}
	return v1.DecodeStrict(data, target)
}
func bridgeEmpty(r *http.Request) error { var request struct{}; return bridgeDecode(r, &request) }
func bridgeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func bridgeError(w http.ResponseWriter, status int, code string) {
	bridgeJSON(w, status, map[string]string{"code": code})
}
func (b *Bridge) result(w http.ResponseWriter, value any, err error) {
	if err == nil {
		bridgeJSON(w, 200, value)
		return
	}
	switch {
	case errors.Is(err, ErrRequestRejected):
		bridgeError(w, 400, "invalid_request")
	case errors.Is(err, ErrConversationConflict):
		bridgeError(w, 409, "conversation_conflict")
	case errors.Is(err, ErrAuthenticationRequired):
		bridgeError(w, 401, "authentication_required")
	case errors.Is(err, ErrAccessDenied), errors.Is(err, ErrRevoked):
		bridgeError(w, 403, "access_revoked")
	case errors.Is(err, ErrDisabled):
		bridgeError(w, 409, "brain_not_selected")
	case errors.Is(err, ErrLocalVersion):
		bridgeError(w, 409, "local_version_conflict")
	case errors.Is(err, ErrGenerationReview):
		bridgeError(w, 409, "generation_review")
	case errors.Is(err, ErrCursorReset):
		bridgeError(w, 409, "cursor_reset")
	case errors.Is(err, ErrConflict):
		bridgeError(w, 409, "revision_conflict")
	case errors.Is(err, ErrNotFound):
		bridgeError(w, 404, "resource_unavailable")
	default:
		bridgeError(w, 503, "transfer_uncertain")
	}
}

func pageDTO(ctx context.Context, e *Engine, key Key, page WorkingPage) map[string]any {
	out := map[string]any{"page_id": page.PageID, "content": page.Local, "version": page.Version, "synced_version": page.SyncedVersion, "base": page.WorkingBase, "remote": page.Remote, "operation_id": page.DraftOperationID, "operation_status": "", "conflict": nil}
	if page.DraftOperationID != "" {
		entry, err := e.Entry(ctx, key, page.DraftOperationID)
		if err == nil {
			out["operation_status"] = entry.Status
			if entry.Receipt != nil {
				out["conflict"] = entry.Receipt.Conflict
			}
		}
	}
	if replica, ok := e.Store.(*Replica); ok {
		blocked, err := replica.GenerationReview(ctx, key.BrainID, page.PageID)
		if err == nil && blocked {
			out["generation_review"] = true
			out["operation_status"] = "generation_review"
			out["conflict"] = &v1.Conflict{Base: page.WorkingBase, Local: page.Local, Server: page.Remote}
		}
	}
	return out
}
func (b *Bridge) state(w http.ResponseWriter, ctx context.Context, a BridgeAccount, brain v1.ID) {
	e := a.Replica.Engine(a.Transport)
	state, err := e.State(ctx, a.Replica.key(brain))
	if err != nil {
		b.result(w, nil, err)
		return
	}
	pages, err := a.Replica.WorkingPages(ctx, brain)
	if err != nil {
		b.result(w, nil, err)
		return
	}
	items := []any{}
	for _, page := range pages {
		items = append(items, pageDTO(ctx, e, a.Replica.key(brain), page))
	}
	canWrite, err := a.Replica.CanWrite(ctx, brain)
	if err != nil {
		b.result(w, nil, err)
		return
	}
	bridgeJSON(w, 200, map[string]any{"brain_id": brain, "enabled": state.Enabled, "revoked": state.Revoked, "membership_epoch": state.MembershipEpoch, "can_write": canWrite, "pages": items})
}
