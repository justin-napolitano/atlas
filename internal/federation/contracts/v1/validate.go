package v1

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// ValidationError deliberately contains no submitted content or identifier values.
type ValidationError struct {
	Field string
	Code  string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Code }
func invalid(field, code string) error   { return &ValidationError{field, code} }

func ValidateID(id ID) error {
	s := string(id)
	if len(s) != 36 || s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' || s == "00000000-0000-0000-0000-000000000000" {
		return invalid("id", "invalid_uuid")
	}
	for i, c := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			continue
		}
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return invalid("id", "invalid_uuid")
		}
	}
	return nil
}
func ids(values ...ID) error {
	for _, id := range values {
		if err := ValidateID(id); err != nil {
			return err
		}
	}
	return nil
}
func text(field, value string, max int, nonblank bool) error {
	if !utf8.ValidString(value) || strings.IndexByte(value, 0) >= 0 {
		return invalid(field, "invalid_text")
	}
	if len(value) > max {
		return invalid(field, "too_large")
	}
	if nonblank && strings.TrimSpace(value) == "" {
		return invalid(field, "required")
	}
	return nil
}
func validVersion(value string) error {
	if value != SchemaVersion {
		return invalid("schema_version", "unsupported_version")
	}
	return nil
}
func validRevision(n int64, zero bool) error {
	if n < 0 || n > MaxRevision || (!zero && n == 0) {
		return invalid("revision", "out_of_range")
	}
	return nil
}
func validRole(r Role) bool { return r == Reader || r == Editor || r == Reviewer || r == BrainAdmin }
func (o Organization) Validate() error {
	if err := ValidateID(o.OrganizationID); err != nil {
		return err
	}
	return text("name", o.Name, MaxTitleBytes, true)
}
func (u UserIdentity) Validate() error {
	if err := ids(u.OrganizationID, u.UserID); err != nil {
		return err
	}
	issuer, err := url.Parse(u.Issuer)
	if err != nil || issuer.Scheme != "https" || issuer.Host == "" || issuer.User != nil || issuer.RawQuery != "" || issuer.Fragment != "" || len(u.Issuer) > 2048 {
		return invalid("issuer", "invalid_issuer")
	}
	return text("subject", u.Subject, 255, true)
}
func (t TeamIdentity) Validate() error {
	if err := ids(t.OrganizationID, t.TeamID); err != nil {
		return err
	}
	return text("name", t.Name, MaxTitleBytes, true)
}
func (i Invitation) Validate() error {
	if err := ids(i.OrganizationID, i.BrainID, i.InvitationID, i.InvitedUserID); err != nil {
		return err
	}
	if !validRole(i.Role) {
		return invalid("role", "unsupported_role")
	}
	if _, err := time.Parse(time.RFC3339Nano, i.ExpiresAt); err != nil {
		return invalid("expires_at", "invalid_time")
	}
	return nil
}
func (b Brain) Validate() error {
	if err := ids(b.OrganizationID, b.BrainID); err != nil {
		return err
	}
	if b.Kind != Private && b.Kind != Team && b.Kind != Incident {
		return invalid("kind", "unsupported_kind")
	}
	return text("name", b.Name, MaxTitleBytes, true)
}
func (p PageContent) Validate() error {
	if err := text("title", p.Title, MaxTitleBytes, true); err != nil {
		return err
	}
	if err := text("body", p.Body, MaxBodyBytes, false); err != nil {
		return err
	}
	if p.State != Active && p.State != Deleted {
		return invalid("state", "unsupported_state")
	}
	return nil
}
func (o Operation) Validate() error {
	if err := validVersion(o.SchemaVersion); err != nil {
		return err
	}
	if err := ids(o.OrganizationID, o.BrainID, o.OperationID, o.DeviceID, o.PageID); err != nil {
		return err
	}
	if err := validRevision(o.BaseRevision, true); err != nil {
		return err
	}
	return o.Payload.Validate()
}
func (s Snapshot) Validate() error {
	if err := ValidateID(s.RevisionID); err != nil {
		return err
	}
	if err := validRevision(s.Revision, false); err != nil {
		return err
	}
	return s.Content.Validate()
}

// DecodeOperation rejects unknown fields, duplicate keys, invalid UTF-8, oversize
// input and trailing JSON. Responses use ordinary JSON decoding for additive fields.
func DecodeOperation(data []byte) (Operation, error) {
	var o Operation
	if err := DecodeStrict(data, &o); err != nil {
		return o, err
	}
	var fields map[string]json.RawMessage
	_ = json.Unmarshal(data, &fields)
	if len(fields) != 8 {
		return o, invalid("request", "unexpected_field")
	}
	for _, key := range []string{"schema_version", "organization_id", "brain_id", "operation_id", "device_id", "page_id", "base_revision", "payload"} {
		if len(fields[key]) == 0 || bytes.Equal(fields[key], []byte("null")) {
			return o, invalid(key, "required")
		}
	}
	var payload map[string]json.RawMessage
	_ = json.Unmarshal(fields["payload"], &payload)
	if len(payload) != 3 {
		return o, invalid("payload", "unexpected_field")
	}
	for _, key := range []string{"title", "body", "state"} {
		if len(payload[key]) == 0 || bytes.Equal(payload[key], []byte("null")) {
			return o, invalid(key, "required")
		}
	}
	return o, o.Validate()
}
func DecodeStrict(data []byte, target any) error {
	if len(data) > MaxRequestBytes {
		return invalid("request", "too_large")
	}
	if !utf8.Valid(data) {
		return invalid("request", "invalid_utf8")
	}
	if err := validEscapedUnicode(data); err != nil {
		return err
	}
	if err := rejectDuplicates(data); err != nil {
		return err
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return invalid("request", "invalid_json")
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return invalid("request", "trailing_json")
	}
	return nil
}
func validEscapedUnicode(data []byte) error {
	inString := false
	for i := 0; i < len(data); i++ {
		if data[i] == '"' {
			inString = !inString
			continue
		}
		if !inString || data[i] != '\\' {
			continue
		}
		if i+1 >= len(data) {
			return invalid("request", "invalid_json")
		}
		if data[i+1] != 'u' {
			i++
			continue
		}
		if i+5 >= len(data) {
			return invalid("request", "invalid_json")
		}
		code, err := strconv.ParseUint(string(data[i+2:i+6]), 16, 16)
		if err != nil {
			return invalid("request", "invalid_json")
		}
		if code >= 0xdc00 && code <= 0xdfff {
			return invalid("request", "invalid_unicode")
		}
		if code >= 0xd800 && code <= 0xdbff {
			if i+11 >= len(data) || data[i+6] != '\\' || data[i+7] != 'u' {
				return invalid("request", "invalid_unicode")
			}
			low, e := strconv.ParseUint(string(data[i+8:i+12]), 16, 16)
			if e != nil || low < 0xdc00 || low > 0xdfff {
				return invalid("request", "invalid_unicode")
			}
			i += 11
		} else {
			i += 5
		}
	}
	return nil
}
func rejectDuplicates(data []byte) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var read func(int) error
	read = func(depth int) error {
		if depth > 16 {
			return invalid("request", "too_deep")
		}
		t, err := d.Token()
		if err != nil {
			return invalid("request", "invalid_json")
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, e := d.Token()
				if e != nil {
					return invalid("request", "invalid_json")
				}
				s, ok := key.(string)
				if !ok || seen[s] {
					return invalid("request", "duplicate_key")
				}
				seen[s] = true
				if e = read(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			for d.More() {
				if e := read(depth + 1); e != nil {
					return e
				}
			}
		default:
			return invalid("request", "invalid_json")
		}
		_, err = d.Token()
		if err != nil {
			return invalid("request", "invalid_json")
		}
		return nil
	}
	if err := read(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return invalid("request", "trailing_json")
	}
	return nil
}

// OperationDigest is a server reference fingerprint, not client authorization.
// It hashes typed, compact Go JSON in declared field order, without HTML escaping
// or a trailing newline. Writing bytes are preserved; no Unicode/line normalization.
func OperationDigest(o Operation) (string, error) {
	encoded, err := EncodeOperation(o)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

// EncodeOperation returns exactly the validated bytes used by OperationDigest.
// Clients may persist/send these bytes without defining a second serialization policy.
func EncodeOperation(o Operation) ([]byte, error) {
	if err := o.Validate(); err != nil {
		return nil, err
	}
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(o); err != nil {
		return nil, err
	}
	data := bytes.TrimSuffix(b.Bytes(), []byte("\n"))
	if len(data) > MaxRequestBytes {
		return nil, invalid("request", "too_large")
	}
	return data, nil
}
func validDigest(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}
func (r Receipt) Validate() error {
	if err := validVersion(r.SchemaVersion); err != nil {
		return err
	}
	if err := ids(r.OrganizationID, r.BrainID, r.OperationID, r.DeviceID, r.PageID); err != nil {
		return err
	}
	if !validDigest(r.RequestSHA256) {
		return invalid("request_sha256", "invalid_digest")
	}
	switch r.Outcome {
	case Accepted:
		if r.RevisionID == nil || r.EventID == nil || r.Conflict != nil {
			return invalid("receipt", "invalid_accepted_shape")
		}
		if err := ids(*r.RevisionID, *r.EventID); err != nil {
			return err
		}
		return validRevision(r.Revision, false)
	case Conflicted:
		if r.RevisionID != nil || r.EventID != nil || r.Revision != 0 || r.Conflict == nil {
			return invalid("receipt", "invalid_conflict_shape")
		}
		if err := r.Conflict.Local.Validate(); err != nil {
			return err
		}
		for _, s := range []*Snapshot{r.Conflict.Base, r.Conflict.Server} {
			if s != nil {
				if err := s.Validate(); err != nil {
					return err
				}
			}
		}
		return nil
	default:
		return invalid("outcome", "unsupported_outcome")
	}
}

// Matches prevents accepting a receipt for another scope, device, payload or key.
// Runtime clients also validate revision progression and preserve pending state until persisted.
func (r Receipt) Matches(o Operation) bool {
	if r.Validate() != nil {
		return false
	}
	digest, err := OperationDigest(o)
	if err != nil || r.OrganizationID != o.OrganizationID || r.BrainID != o.BrainID || r.OperationID != o.OperationID || r.DeviceID != o.DeviceID || r.PageID != o.PageID || r.RequestSHA256 != digest {
		return false
	}
	if r.Outcome == Accepted {
		return o.BaseRevision < MaxRevision && r.Revision == o.BaseRevision+1
	}
	return r.Conflict.Local == o.Payload && (r.Conflict.Base == nil || r.Conflict.Base.Revision == o.BaseRevision)
}

func (g Grant) Validate() error {
	if err := ids(g.OrganizationID, g.BrainID, g.SubjectID); err != nil {
		return err
	}
	if (g.SubjectKind != "user" && g.SubjectKind != "team") || !validRole(g.Role) {
		return invalid("grant", "invalid_subject_or_role")
	}
	if g.ExpiresAt != nil {
		if _, e := time.Parse(time.RFC3339Nano, *g.ExpiresAt); e != nil {
			return invalid("expires_at", "invalid_time")
		}
	}
	return nil
}
func RoleAllows(role Role, capability Capability) bool {
	if !validRole(role) {
		return false
	}
	switch capability {
	case Read:
		return true
	case Write:
		return role == Editor || role == BrainAdmin
	case Review:
		return role == Reviewer || role == BrainAdmin
	case Invite, Admin, Export:
		return role == BrainAdmin
	default:
		return false
	}
}
func HasCapability(p Principal, grants []Grant, organizationID, brainID ID, capability Capability, now time.Time) bool {
	if !p.Active || ids(p.OrganizationID, p.UserID, organizationID, brainID) != nil || p.OrganizationID != organizationID {
		return false
	}
	for _, g := range grants {
		if g.Validate() != nil || g.OrganizationID != organizationID || g.BrainID != brainID || !RoleAllows(g.Role, capability) {
			continue
		}
		if g.ExpiresAt != nil {
			expires, _ := time.Parse(time.RFC3339Nano, *g.ExpiresAt)
			if !now.Before(expires) {
				continue
			}
		}
		if g.SubjectKind == "user" && g.SubjectID == p.UserID {
			return true
		}
		if g.SubjectKind == "team" {
			for _, team := range p.TeamIDs {
				if ValidateID(team) == nil && g.SubjectID == team {
					return true
				}
			}
		}
	}
	return false
}
func (c Cursor) Validate() error {
	if err := validVersion(c.SchemaVersion); err != nil {
		return err
	}
	if err := ids(c.OrganizationID, c.BrainID, c.UserID); err != nil {
		return err
	}
	if err := validRevision(c.MembershipEpoch, false); err != nil {
		return err
	}
	if c.AfterEventID != nil {
		if err := ValidateID(*c.AfterEventID); err != nil {
			return err
		}
	}
	if _, err := time.Parse(time.RFC3339Nano, c.ExpiresAt); err != nil {
		return invalid("expires_at", "invalid_time")
	}
	return nil
}
func (c Cursor) ValidateBinding(organizationID, brainID, userID ID, membershipEpoch int64, now time.Time) error {
	expires, err := time.Parse(time.RFC3339Nano, c.ExpiresAt)
	if c.Validate() != nil || err != nil || !now.Before(expires) || c.OrganizationID != organizationID || c.BrainID != brainID || c.UserID != userID || c.MembershipEpoch != membershipEpoch {
		return invalid("cursor", "cursor_reset")
	}
	return nil
}
func (e ChangeEvent) Validate() error {
	if err := validVersion(e.SchemaVersion); err != nil {
		return err
	}
	if err := ids(e.OrganizationID, e.BrainID, e.EventID, e.PageID, e.RevisionID); err != nil {
		return err
	}
	if err := validRevision(e.Revision, false); err != nil {
		return err
	}
	if _, err := time.Parse(time.RFC3339Nano, e.OccurredAt); err != nil {
		return invalid("occurred_at", "invalid_time")
	}
	switch e.Kind {
	case "page_created", "page_updated", "page_deleted", "source_observed", "review_decided", "index_maintained":
		return nil
	default:
		return invalid("event_kind", "unsupported_kind")
	}
}
func (s SourceIdentity) Validate() error {
	if s.Provider != "servicenow" {
		return invalid("provider", "unsupported_provider")
	}
	u, e := url.Parse(s.Instance)
	if e != nil || u.Scheme != "https" || u.Host == "" || u.Host != strings.ToLower(u.Host) || u.Port() == "443" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || len(s.Instance) > 2048 {
		return invalid("instance", "invalid_instance")
	}
	if len(s.Table) < 1 || len(s.Table) > 80 {
		return invalid("table", "invalid_table")
	}
	for _, c := range s.Table {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return invalid("table", "invalid_table")
		}
	}
	if len(s.SourceID) != 32 {
		return invalid("source_id", "invalid_sys_id")
	}
	for _, c := range s.SourceID {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return invalid("source_id", "invalid_sys_id")
		}
	}
	return nil
}
func (e Edge) Validate() error {
	if err := ids(e.OrganizationID, e.BrainID, e.EdgeID, e.Source.BrainID, e.Source.EntityID, e.Target.BrainID, e.Target.EntityID, e.EvidenceRevisionID); err != nil {
		return err
	}
	for _, kind := range []string{e.Source.Kind, e.Target.Kind} {
		switch kind {
		case "page", "incident", "change", "service", "decision", "evidence":
		default:
			return invalid("entity_kind", "unsupported_kind")
		}
	}
	switch e.Kind {
	case "relates_to", "supports", "contradicts", "affects", "reported_cause", "verified_cause":
		return nil
	default:
		return invalid("edge_kind", "unsupported_kind")
	}
}
func EdgeVisible(e Edge, p Principal, grants []Grant, now time.Time) bool {
	return e.Validate() == nil && HasCapability(p, grants, e.OrganizationID, e.BrainID, Read, now) && HasCapability(p, grants, e.OrganizationID, e.Source.BrainID, Read, now) && HasCapability(p, grants, e.OrganizationID, e.Target.BrainID, Read, now)
}
func (m GoldManifest) Validate() error {
	if err := validVersion(m.SchemaVersion); err != nil {
		return err
	}
	if err := ids(m.OrganizationID, m.ManifestID); err != nil {
		return err
	}
	if len(m.AudienceBrainIDs) == 0 || len(m.AudienceBrainIDs) > 100 || len(m.Revisions) == 0 || len(m.Revisions) > 1000 {
		return invalid("manifest", "invalid_size")
	}
	audiences := map[ID]bool{}
	for _, id := range m.AudienceBrainIDs {
		if ValidateID(id) != nil || audiences[id] {
			return invalid("audience_brain_ids", "invalid_or_duplicate")
		}
		audiences[id] = true
	}
	pages := map[string]bool{}
	for _, ref := range m.Revisions {
		if ids(ref.BrainID, ref.PageID, ref.RevisionID) != nil {
			return invalid("revisions", "invalid_id")
		}
		key := fmt.Sprint(ref.BrainID, "/", ref.PageID)
		if pages[key] {
			return invalid("revisions", "duplicate_page")
		}
		pages[key] = true
	}
	return nil
}
