package federation

import (
	"context"
	"net/http"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

func (b *Bridge) sourceRequest(ctx context.Context, w http.ResponseWriter, r *http.Request, a BridgeAccount, parts []string) bool {
	isSearch := len(parts) == 4 && parts[2] == "sources" && parts[3] == "search"
	isRecord := len(parts) == 8 && parts[2] == "brains" && parts[4] == "sources" && parts[6] == "records"
	if !isSearch && !isRecord {
		return false
	}
	if !a.SourcesEnabled || r.Method != http.MethodPost {
		bridgeError(w, 404, "resource_unavailable")
		return true
	}
	if isSearch {
		var body struct {
			Query   string `json:"query"`
			BrainID *v1.ID `json:"brain_id"`
			Limit   int    `json:"limit"`
			Offset  int    `json:"offset"`
		}
		if bridgeDecode(r, &body, "query", "brain_id", "limit", "offset") != nil {
			bridgeError(w, 400, "invalid_request")
			return true
		}
		value, err := a.Transport.SourceSearch(ctx, a.Replica.identity.OrganizationID, body.Query, body.BrainID, body.Limit, body.Offset)
		b.result(w, value, err)
		return true
	}
	var body struct {
		Version *string `json:"source_version"`
	}
	if bridgeDecode(r, &body, "source_version") != nil {
		bridgeError(w, 400, "invalid_request")
		return true
	}
	value, err := a.Transport.SourceRead(ctx, a.Replica.identity.OrganizationID, v1.ID(parts[3]), v1.ID(parts[5]), parts[7], body.Version)
	b.result(w, value, err)
	return true
}
