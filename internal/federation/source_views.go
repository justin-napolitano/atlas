package federation

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	v1 "github.com/justin-napolitano/atlas/internal/federation/contracts/v1"
)

type SourceCoverage struct {
	Scope                  string     `json:"scope"`
	Complete               bool       `json:"complete"`
	LatestObservedAt       *time.Time `json:"latest_observed_at"`
	LatestSourceModifiedAt *time.Time `json:"latest_source_modified_at"`
	ClockSkew              bool       `json:"clock_skew"`
}
type SourceHit struct {
	BrainID          v1.ID             `json:"brain_id"`
	ConnectionID     v1.ID             `json:"connection_id"`
	Source           v1.SourceIdentity `json:"source"`
	SourceVersion    string            `json:"source_version"`
	Ordinal          int64             `json:"ordinal"`
	Title            string            `json:"title"`
	Snippet          string            `json:"snippet"`
	SourceModifiedAt time.Time         `json:"source_modified_at"`
	ObservedAt       time.Time         `json:"observed_at"`
	ACLValidUntil    time.Time         `json:"acl_valid_until"`
}
type SourceSearchResult struct {
	Items    []SourceHit    `json:"items"`
	Total    int64          `json:"total"`
	Coverage SourceCoverage `json:"coverage"`
}
type SourceRecord struct {
	Source           v1.SourceIdentity `json:"source"`
	SourceVersion    string            `json:"source_version"`
	Ordinal          int64             `json:"ordinal"`
	SourceModifiedAt time.Time         `json:"source_modified_at"`
	ObservedAt       time.Time         `json:"observed_at"`
	IngestedAt       time.Time         `json:"ingested_at"`
	ACLValidUntil    time.Time         `json:"acl_valid_until"`
	Fields           map[string]string `json:"fields"`
	ContentSHA256    string            `json:"content_sha256"`
}

func sourceText(value string, max int) bool {
	return utf8.ValidString(value) && len(value) <= max && !strings.ContainsRune(value, 0)
}
func sourceToken(value string) bool {
	return len(value) > 0 && strings.TrimSpace(value) == value && sourceText(value, 200)
}
func sourceIDValid(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func sourceTime(value time.Time) bool {
	return !value.IsZero() && value.Year() >= 1 && value.Year() <= 9999
}
func sourceShape(data []byte, nullable map[string]bool, names ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if v1.DecodeStrict(data, &fields) != nil || len(fields) != len(names) {
		return nil, ErrInvalidReceipt
	}
	for _, name := range names {
		if len(fields[name]) == 0 || jsonNull(fields[name]) && !nullable[name] {
			return nil, ErrInvalidReceipt
		}
	}
	return fields, nil
}
func sourceIdentityShape(data []byte) bool {
	_, err := sourceShape(data, nil, "provider", "instance", "table", "source_id")
	return err == nil
}

// SourceSearch reads a separate permission-filtered projection. Neither results
// nor exact source records are inserted into local notes, outbox or chat.
func (h *HTTPTransport) SourceSearch(ctx context.Context, org v1.ID, query string, brain *v1.ID, limit, offset int) (SourceSearchResult, error) {
	var out SourceSearchResult
	if v1.ValidateID(org) != nil || brain != nil && v1.ValidateID(*brain) != nil || !sourceText(query, 512) || limit < 1 || limit > 100 || offset < 0 || offset > 10000 {
		return out, ErrInvalidReceipt
	}
	data, err := h.remoteJSON(ctx, http.MethodPost, "/v1/organizations/"+string(org)+"/sources/search", map[string]any{"query": query, "brain_id": brain, "limit": limit, "offset": offset})
	if err != nil {
		return out, err
	}
	fields, err := sourceShape(data, nil, "items", "total", "coverage")
	if err != nil || v1.DecodeStrict(data, &out) != nil || out.Items == nil || len(out.Items) > limit || out.Total < int64(len(out.Items)) {
		return SourceSearchResult{}, ErrInvalidReceipt
	}
	if _, err = sourceShape(fields["coverage"], map[string]bool{"latest_observed_at": true, "latest_source_modified_at": true}, "scope", "complete", "latest_observed_at", "latest_source_modified_at", "clock_skew"); err != nil || out.Coverage.Scope != "permitted_source_records" || out.Coverage.Complete {
		return SourceSearchResult{}, ErrInvalidReceipt
	}
	if (out.Coverage.LatestObservedAt == nil) != (out.Coverage.LatestSourceModifiedAt == nil) || out.Total == 0 && out.Coverage.LatestObservedAt != nil || out.Total > 0 && out.Coverage.LatestObservedAt == nil {
		return SourceSearchResult{}, ErrInvalidReceipt
	}
	if out.Coverage.LatestObservedAt != nil && (!sourceTime(*out.Coverage.LatestObservedAt) || !sourceTime(*out.Coverage.LatestSourceModifiedAt)) {
		return SourceSearchResult{}, ErrInvalidReceipt
	}
	var raw []json.RawMessage
	if json.Unmarshal(fields["items"], &raw) != nil {
		return SourceSearchResult{}, ErrInvalidReceipt
	}
	for i, hit := range out.Items {
		if hit.Source.Provider != "servicenow" {
			return SourceSearchResult{}, ErrInvalidReceipt
		}
		shape, e := sourceShape(raw[i], nil, "brain_id", "connection_id", "source", "source_version", "ordinal", "title", "snippet", "source_modified_at", "observed_at", "acl_valid_until")
		if e != nil || !sourceIdentityShape(shape["source"]) || hit.Source.Validate() != nil || v1.ValidateID(hit.BrainID) != nil || v1.ValidateID(hit.ConnectionID) != nil || brain != nil && hit.BrainID != *brain || !sourceToken(hit.SourceVersion) || hit.Ordinal < 0 || hit.Ordinal > v1.MaxRevision || !sourceText(hit.Title, 1000) || !sourceText(hit.Snippet, 4096) || !sourceTime(hit.SourceModifiedAt) || !sourceTime(hit.ObservedAt) || !hit.ACLValidUntil.After(time.Now()) {
			return SourceSearchResult{}, ErrInvalidReceipt
		}
	}
	return out, nil
}
func (h *HTTPTransport) SourceRead(ctx context.Context, org, brain, connection v1.ID, id string, version *string) (SourceRecord, error) {
	var out SourceRecord
	if v1.ValidateID(org) != nil || v1.ValidateID(brain) != nil || v1.ValidateID(connection) != nil || !sourceIDValid(id) || version != nil && !sourceToken(*version) {
		return out, ErrInvalidReceipt
	}
	data, err := h.remoteJSON(ctx, http.MethodPost, brainPath(org, brain)+"/sources/"+string(connection)+"/records/"+id, map[string]any{"source_version": version})
	if err != nil {
		return out, err
	}
	shape, err := sourceShape(data, nil, "source", "source_version", "ordinal", "source_modified_at", "observed_at", "ingested_at", "acl_valid_until", "fields", "content_sha256")
	if err == nil && v1.DecodeStrict(data, &out) == nil && out.Source.Provider != "servicenow" {
		return SourceRecord{}, ErrInvalidReceipt
	}
	if err != nil || v1.DecodeStrict(data, &out) != nil || !sourceIdentityShape(shape["source"]) || out.Source.Validate() != nil || out.Source.SourceID != id || !sourceToken(out.SourceVersion) || version != nil && out.SourceVersion != *version || out.Ordinal < 0 || out.Ordinal > v1.MaxRevision || !sourceTime(out.SourceModifiedAt) || !sourceTime(out.ObservedAt) || !sourceTime(out.IngestedAt) || !out.ACLValidUntil.After(time.Now()) || !validSHA256(out.ContentSHA256) || len(out.Fields) == 0 || len(out.Fields) > 30 {
		return SourceRecord{}, ErrInvalidReceipt
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(shape["fields"], &raw) != nil {
		return SourceRecord{}, ErrInvalidReceipt
	}
	total := 0
	for field, value := range out.Fields {
		if field == "" || !sourceText(field, 80) || jsonNull(raw[field]) || !sourceText(value, 1<<20) {
			return SourceRecord{}, ErrInvalidReceipt
		}
		total += len(value)
	}
	if total > 1<<20 {
		return SourceRecord{}, ErrInvalidReceipt
	}
	return out, nil
}
