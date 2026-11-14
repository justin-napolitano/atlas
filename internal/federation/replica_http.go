package federation

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type BrainAuthority struct {
	OrganizationID  v1.ID `json:"organization_id"`
	BrainID         v1.ID `json:"brain_id"`
	UserID          v1.ID `json:"user_id"`
	MembershipEpoch int64 `json:"membership_epoch"`
	CanWrite        bool  `json:"can_write"`
}

func (h *HTTPTransport) readJSON(ctx context.Context, path string) ([]byte, error) {
	return h.readJSONQuery(ctx, path, "")
}

// Query values are constructed by typed adapters; browser callers never supply
// an origin, URL or arbitrary query string.
func (h *HTTPTransport) readJSONQuery(ctx context.Context, path, query string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, h.timeout)
	defer cancel()
	credential, err := h.credentials.Credential(ctx, h.origin)
	if err != nil {
		if errors.Is(err, ErrAuthenticationRequired) {
			return nil, ErrAuthenticationRequired
		}
		return nil, ErrUncertain
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
	u.RawQuery = query
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, ErrUncertain
	}
	req.Header.Set("Authorization", "Bearer "+credential.BearerToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-store")
	response, err := h.client.Do(req)
	if err != nil {
		return nil, ErrUncertain
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case 401:
		return nil, ErrAuthenticationRequired
	case 403, 404:
		return nil, ErrAccessDenied
	case 200:
	default:
		return nil, ErrUncertain
	}
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		return nil, ErrInvalidReceipt
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, v1.MaxRequestBytes+1))
	if err != nil {
		return nil, ErrUncertain
	}
	if len(data) > v1.MaxRequestBytes {
		return nil, ErrInvalidReceipt
	}
	return data, nil
}

func brainPath(org, brain v1.ID) string {
	return "/v1/organizations/" + string(org) + "/brains/" + string(brain)
}

func (h *HTTPTransport) ReadAuthority(ctx context.Context, org, brain v1.ID) (BrainAuthority, error) {
	var result BrainAuthority
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil {
		return result, ErrAccessDenied
	}
	data, err := h.readJSON(ctx, brainPath(org, brain))
	if err != nil {
		return result, err
	}
	var fields map[string]json.RawMessage
	if v1.DecodeStrict(data, &fields) != nil {
		return result, ErrInvalidReceipt
	}
	for name, target := range map[string]any{"organization_id": &result.OrganizationID, "brain_id": &result.BrainID, "user_id": &result.UserID, "membership_epoch": &result.MembershipEpoch, "can_write": &result.CanWrite} {
		if len(fields[name]) == 0 || jsonNull(fields[name]) || json.Unmarshal(fields[name], target) != nil {
			return result, ErrInvalidReceipt
		}
	}
	if result.OrganizationID != org || result.BrainID != brain || result.UserID != h.userID || result.MembershipEpoch < 1 || result.MembershipEpoch > v1.MaxRevision {
		return result, ErrInvalidReceipt
	}
	return result, nil
}

func (h *HTTPTransport) ReadPage(ctx context.Context, org, brain, page v1.ID) (v1.Snapshot, error) {
	var result v1.Snapshot
	for _, id := range []v1.ID{org, brain, page} {
		if v1.ValidateID(id) != nil {
			return result, ErrAccessDenied
		}
	}
	data, err := h.readJSON(ctx, brainPath(org, brain)+"/pages/"+string(page))
	if err != nil {
		return result, err
	}
	return decodeSnapshot(data)
}

func decodeSnapshot(data []byte) (v1.Snapshot, error) {
	var result v1.Snapshot
	var err error
	var fields map[string]json.RawMessage
	if v1.DecodeStrict(data, &fields) != nil {
		return result, ErrInvalidReceipt
	}
	for name, target := range map[string]any{"revision_id": &result.RevisionID, "revision": &result.Revision} {
		if len(fields[name]) == 0 || jsonNull(fields[name]) || json.Unmarshal(fields[name], target) != nil {
			return result, ErrInvalidReceipt
		}
	}
	var content map[string]json.RawMessage
	if json.Unmarshal(fields["content"], &content) != nil || !contentShape(content) {
		return result, ErrInvalidReceipt
	}
	result.Content, err = decodeContentExact(fields["content"])
	if err != nil || result.Validate() != nil {
		return result, ErrInvalidReceipt
	}
	return result, nil
}

// Select is explicit per brain and requires fresh authenticated write authority.
func (r *Replica) Select(ctx context.Context, h *HTTPTransport, brain v1.ID) (*Engine, error) {
	if h.Origin() != r.identity.Origin || h.AccountID() != r.identity.UserID {
		return nil, ErrAccessDenied
	}
	engine := r.Engine(h)
	state, stateErr := engine.State(ctx, r.key(brain))
	if stateErr != nil {
		return nil, stateErr
	}
	authority, err := h.ReadAuthority(ctx, r.identity.OrganizationID, brain)
	if err != nil {
		if state.MembershipEpoch > 0 {
			return nil, r.authorityError(ctx, engine, r.key(brain), state.AccessGeneration, err)
		}
		return nil, err
	}
	if !authority.CanWrite {
		if state.MembershipEpoch > 0 {
			return nil, engine.revoke(ctx, r.key(brain), state.AccessGeneration)
		}
		return nil, ErrAccessDenied
	}
	if err = engine.Enable(ctx, r.key(brain), authority.MembershipEpoch); err != nil {
		return nil, err
	}
	return engine, nil
}

// RefreshPage is an explicit selected-page read, not a full-brain bootstrap/feed.
// A matching current access generation fences both downloads and local commits.
// Dirty local writing remains in place; the remote snapshot advances separately.
func (r *Replica) RefreshPage(ctx context.Context, engine *Engine, h *HTTPTransport, brain, page v1.ID) error {
	if engine.Store != r || engine.Transport != h || h.Origin() != r.identity.Origin || h.AccountID() != r.identity.UserID {
		return ErrAccessDenied
	}
	key := r.key(brain)
	state, err := engine.State(ctx, key)
	if err != nil {
		return err
	}
	if state.Revoked {
		return ErrRevoked
	}
	if !state.Enabled {
		return ErrDisabled
	}
	authority, err := h.ReadAuthority(ctx, key.OrganizationID, brain)
	if err != nil {
		return r.authorityError(ctx, engine, key, state.AccessGeneration, err)
	}
	if !authority.CanWrite || authority.MembershipEpoch != state.MembershipEpoch {
		return engine.revoke(ctx, key, state.AccessGeneration)
	}
	snapshot, err := h.ReadPage(ctx, key.OrganizationID, brain, page)
	if errors.Is(err, ErrAccessDenied) {
		return engine.revoke(ctx, key, state.AccessGeneration)
	}
	if errors.Is(err, ErrAuthenticationRequired) {
		return r.pauseReadAuthentication(ctx, engine, key, state.AccessGeneration)
	}
	if err != nil {
		return err
	}
	return r.Transaction(ctx, func(tx Tx) error {
		current, err := tx.Brain(key)
		if err != nil {
			return err
		}
		if !current.Enabled || current.Revoked || current.AccessGeneration != state.AccessGeneration || current.MembershipEpoch != state.MembershipEpoch {
			return ErrStaleResponse
		}
		raw, _ := SQLTransaction(tx)
		return cacheSnapshot(ctx, raw, key, page, snapshot)
	})
}

func (r *Replica) authorityError(ctx context.Context, engine *Engine, key Key, generation int64, err error) error {
	if errors.Is(err, ErrAccessDenied) {
		return engine.revoke(ctx, key, generation)
	}
	if errors.Is(err, ErrAuthenticationRequired) {
		return r.pauseReadAuthentication(ctx, engine, key, generation)
	}
	return err
}

func (r *Replica) pauseReadAuthentication(ctx context.Context, engine *Engine, key Key, generation int64) error {
	err := engine.persistOutcome(ctx, func(tx Tx) error {
		state, err := tx.Brain(key)
		if err != nil {
			return err
		}
		if state.AccessGeneration != generation {
			return ErrStaleResponse
		}
		state.Enabled = false
		state.AccessGeneration++
		if err = tx.PutBrain(key, state); err != nil {
			return err
		}
		entries, err := tx.Entries(key)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.Status == Pending || entry.Status == InFlight {
				entry.Status = Suspended
				entry.LastError = "authentication_required"
				if err = tx.Update(entry); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return ErrAuthenticationRequired
}
