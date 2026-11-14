package federation

import (
	"context"
	"encoding/json"
	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
	"net/http"
	"regexp"
	"unicode/utf8"
)

var notePropertyKey = regexp.MustCompile(`^[a-z_][a-z0-9_.-]{0,63}$`)

func (h *HTTPTransport) NoteSearch(ctx context.Context, org v1.ID, query string, properties map[string]string, brainName string, offset int) (json.RawMessage, error) {
	if v1.ValidateID(org) != nil || !utf8.ValidString(query) || len(query) > 512 || len(properties) > 8 || len(brainName) > 1000 || !utf8.ValidString(brainName) || offset < 0 || offset > 10000 {
		return nil, ErrRequestRejected
	}
	for key, value := range properties {
		if !notePropertyKey.MatchString(key) || len(value) > 512 || !utf8.ValidString(value) {
			return nil, ErrRequestRejected
		}
	}
	if properties == nil {
		properties = map[string]string{}
	}
	return h.remoteJSON(ctx, http.MethodPost, "/v1/organizations/"+string(org)+"/wiki/search", map[string]any{"query": query, "properties": properties, "brain_name": brainName, "kinds": []string{}, "brain_id": nil, "offset": offset})
}
