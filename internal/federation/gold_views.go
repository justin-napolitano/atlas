package federation

import (
	"context"
	"encoding/json"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
	"net/http"
	"strings"
	"unicode/utf8"
)

type GoldProposalRequest struct {
	GenerationID    v1.ID           `json:"generation_id"`
	Manifest        v1.GoldManifest `json:"manifest"`
	AudienceUserIDs []v1.ID         `json:"audience_user_ids"`
}
type GoldDecisionRequest struct {
	GenerationID    v1.ID  `json:"generation_id"`
	DecisionID      v1.ID  `json:"decision_id"`
	ProposalID      v1.ID  `json:"proposal_id"`
	ManifestSHA256  string `json:"manifest_sha256"`
	ExpectedStateID v1.ID  `json:"expected_state_id"`
	Kind            string `json:"kind"`
	Reason          string `json:"reason"`
}

func (h *HTTPTransport) GoldRead(ctx context.Context, org, brain v1.ID, view string, proposal, page v1.ID) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil {
		return nil, ErrInvalidReceipt
	}
	path := brainPath(org, brain) + "/gold/"
	switch view {
	case "context", "state", "current", "proposals":
		path += view
	case "page":
		if v1.ValidateID(proposal) != nil || v1.ValidateID(page) != nil {
			return nil, ErrInvalidReceipt
		}
		path += "proposals/" + string(proposal) + "/pages/" + string(page)
	default:
		return nil, ErrInvalidReceipt
	}
	return h.remoteJSON(ctx, http.MethodGet, path, nil)
}
func (h *HTTPTransport) GoldPropose(ctx context.Context, org, brain v1.ID, request GoldProposalRequest) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil || v1.ValidateID(request.GenerationID) != nil || request.Manifest.Validate() != nil || request.Manifest.OrganizationID != org || len(request.Manifest.AudienceBrainIDs) != 1 || request.Manifest.AudienceBrainIDs[0] != brain || len(request.Manifest.Revisions) > 100 || len(request.AudienceUserIDs) == 0 || len(request.AudienceUserIDs) > 100 {
		return nil, ErrRequestRejected
	}
	for _, ref := range request.Manifest.Revisions {
		if ref.BrainID != brain {
			return nil, ErrRequestRejected
		}
	}
	seen := map[v1.ID]bool{}
	for _, id := range request.AudienceUserIDs {
		if v1.ValidateID(id) != nil || seen[id] {
			return nil, ErrRequestRejected
		}
		seen[id] = true
	}
	return h.remoteJSONGeneration(ctx, http.MethodPost, brainPath(org, brain)+"/gold/proposals", map[string]any{"manifest": request.Manifest, "audience_user_ids": request.AudienceUserIDs}, request.GenerationID)
}
func (h *HTTPTransport) GoldDecide(ctx context.Context, org, brain v1.ID, request GoldDecisionRequest) (json.RawMessage, error) {
	if len(strings.TrimSpace(request.Reason)) == 0 || len(request.Reason) > 1000 || !utf8.ValidString(request.Reason) || strings.ContainsRune(request.Reason, 0) {
		return nil, ErrRequestRejected
	}
	for _, id := range []v1.ID{org, brain, request.GenerationID, request.DecisionID, request.ProposalID, request.ExpectedStateID} {
		if v1.ValidateID(id) != nil {
			return nil, ErrInvalidReceipt
		}
	}
	if !validSHA256(request.ManifestSHA256) || (request.Kind != "approve" && request.Kind != "reject") {
		return nil, ErrInvalidReceipt
	}
	return h.remoteJSONGeneration(ctx, http.MethodPost, brainPath(org, brain)+"/gold/decisions", map[string]any{"decision_id": request.DecisionID, "proposal_id": request.ProposalID, "manifest_sha256": request.ManifestSHA256, "expected_state_id": request.ExpectedStateID, "kind": request.Kind, "reason": request.Reason, "rollback_target_decision_id": nil}, request.GenerationID)
}
