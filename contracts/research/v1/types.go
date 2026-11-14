// Package v1 defines Atlas research records independently of note bodies.
package v1

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"unicode/utf8"
)

type Selector struct {
	Exact  string `json:"exact"`
	Prefix string `json:"prefix"`
	Suffix string `json:"suffix"`
	Start  int    `json:"start"`
	End    int    `json:"end"`
}
type Record struct {
	ID              string    `json:"id"`
	Revision        int64     `json:"revision"`
	Kind            string    `json:"kind"`
	Visibility      string    `json:"visibility"`
	Deleted         bool      `json:"deleted"`
	Title           string    `json:"title"`
	SourceID        string    `json:"source_id"`
	DocumentVersion string    `json:"document_version"`
	SHA256          string    `json:"sha256"`
	CollectionID    string    `json:"collection_id"`
	Document        string    `json:"document"`
	Selector        *Selector `json:"selector"`
	Body            string    `json:"body"`
	Position        int       `json:"position"`
}
type Operation struct {
	OperationID  string `json:"operation_id"`
	GenerationID string `json:"generation_id"`
	BaseRevision int64  `json:"base_revision"`
	Record       Record `json:"record"`
}
type Snapshot struct {
	OrganizationID string   `json:"organization_id"`
	BrainID        string   `json:"brain_id"`
	UserID         string   `json:"user_id"`
	GenerationID   string   `json:"generation_id"`
	Items          []Record `json:"items"`
	Total          int      `json:"total"`
}
type Receipt struct {
	OrganizationID string `json:"organization_id"`
	BrainID        string `json:"brain_id"`
	UserID         string `json:"user_id"`
	GenerationID   string `json:"generation_id"`
	OperationID    string `json:"operation_id"`
	Outcome        string `json:"outcome"`
	Record         Record `json:"record"`
}

var ErrInvalid = errors.New("invalid research operation")
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func ValidID(s string) bool {
	return uuid.MatchString(s) && s != "00000000-0000-0000-0000-000000000000"
}
func (o *Operation) Validate() error {
	r := &o.Record
	if !ValidID(o.OperationID) || !ValidID(o.GenerationID) || !ValidID(r.ID) || o.BaseRevision < 0 || r.Revision != 0 || len(r.Title) > 1000 || len(r.Body) > 65536 || len(r.Document) > 262144 || !utf8.ValidString(r.Document) || !utf8.ValidString(r.Body) || !utf8.ValidString(r.Title) || r.Position < 0 {
		return ErrInvalid
	}
	if r.Visibility == "" {
		r.Visibility = "private"
	}
	if r.Visibility != "private" && r.Visibility != "shared" {
		return ErrInvalid
	}
	switch r.Kind {
	case "collection":
		if r.Visibility != "shared" || r.Title == "" {
			return ErrInvalid
		}
	case "source":
		sum := sha256.Sum256([]byte(r.Document))
		if r.Visibility != "shared" || !ValidID(r.DocumentVersion) || r.SourceID != r.ID || r.SHA256 != hex.EncodeToString(sum[:]) {
			return ErrInvalid
		}
	case "membership":
		if r.Visibility != "shared" || !ValidID(r.CollectionID) || !ValidID(r.SourceID) {
			return ErrInvalid
		}
	case "annotation", "progress":
		if !ValidID(r.SourceID) || !ValidID(r.DocumentVersion) || len(r.SHA256) != 64 {
			return ErrInvalid
		}
		if r.Kind == "progress" && r.Visibility != "private" {
			return ErrInvalid
		}
		if r.Kind == "annotation" && (r.Selector == nil || r.Selector.Start < 0 || r.Selector.End < r.Selector.Start || r.Selector.Exact == "" || len(r.Selector.Exact) > 65536) {
			return ErrInvalid
		}
	default:
		return ErrInvalid
	}
	return nil
}
