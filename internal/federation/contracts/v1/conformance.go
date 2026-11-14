package v1

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"time"
)

// ConformanceFixture contains synthetic data only; it is not an authorization database.
type ConformanceFixture struct {
	SchemaVersion string            `json:"schema_version"`
	Cases         []ConformanceCase `json:"cases"`
}
type ConformanceCase struct {
	Name     string          `json:"name"`
	Kind     string          `json:"kind"`
	Input    json.RawMessage `json:"input"`
	Expected bool            `json:"expected"`
}
type ConformanceReport struct {
	SchemaVersion string `json:"schema_version"`
	FixtureSHA256 string `json:"fixture_sha256"`
	Cases         int    `json:"cases"`
	Passed        int    `json:"passed"`
}
type AccessCase struct {
	Principal      Principal  `json:"principal"`
	Grants         []Grant    `json:"grants"`
	OrganizationID ID         `json:"organization_id"`
	BrainID        ID         `json:"brain_id"`
	Capability     Capability `json:"capability"`
	Now            string     `json:"now"`
}
type CursorCase struct {
	Cursor          Cursor `json:"cursor"`
	OrganizationID  ID     `json:"organization_id"`
	BrainID         ID     `json:"brain_id"`
	UserID          ID     `json:"user_id"`
	MembershipEpoch int64  `json:"membership_epoch"`
	Now             string `json:"now"`
}
type EdgeCase struct {
	Edge      Edge      `json:"edge"`
	Principal Principal `json:"principal"`
	Grants    []Grant   `json:"grants"`
	Now       string    `json:"now"`
}
type ReceiptCase struct {
	Operation Operation `json:"operation"`
	Receipt   Receipt   `json:"receipt"`
}

// CheckConformance evaluates exactly the supplied fixture bytes and reports their digest.
// This proves contract agreement only, never a hosted implementation's authorization.
func CheckConformance(data []byte) (ConformanceReport, error) {
	sum := sha256.Sum256(data)
	report := ConformanceReport{SchemaVersion: SchemaVersion, FixtureSHA256: hex.EncodeToString(sum[:])}
	var fixture ConformanceFixture
	// Negative cases intentionally contain duplicate keys/invalid Unicode inside
	// RawMessage inputs; validate each case, not the entire fixture as an operation.
	if len(data) > MaxRequestBytes {
		return report, invalid("fixture", "too_large")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		return report, invalid("fixture", "invalid_json")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return report, invalid("fixture", "trailing_json")
	}
	if err := validVersion(fixture.SchemaVersion); err != nil {
		return report, err
	}
	if len(fixture.Cases) == 0 || len(fixture.Cases) > 1000 {
		return report, invalid("cases", "invalid_size")
	}
	names := map[string]bool{}
	for _, c := range fixture.Cases {
		if text("case_name", c.Name, 120, true) != nil || names[c.Name] {
			return report, invalid("cases", "duplicate_or_invalid_name")
		}
		names[c.Name] = true
		report.Cases++
		actual, err := checkCase(c)
		if err != nil {
			return report, err
		}
		if actual != c.Expected {
			return report, invalid("cases", "expectation_mismatch")
		}
		report.Passed++
	}
	return report, nil
}
func checkCase(c ConformanceCase) (bool, error) {
	switch c.Kind {
	case "operation":
		_, err := DecodeOperation(c.Input)
		return err == nil, nil
	case "brain":
		var b Brain
		if err := DecodeStrict(c.Input, &b); err != nil {
			return false, nil
		}
		return b.Validate() == nil, nil
	case "source":
		var s SourceIdentity
		if err := DecodeStrict(c.Input, &s); err != nil {
			return false, nil
		}
		return s.Validate() == nil, nil
	case "gold":
		var m GoldManifest
		if err := DecodeStrict(c.Input, &m); err != nil {
			return false, nil
		}
		return m.Validate() == nil, nil
	case "receipt":
		var r ReceiptCase
		if err := DecodeStrict(c.Input, &r); err != nil {
			return false, nil
		}
		return r.Receipt.Matches(r.Operation), nil
	case "access":
		var a AccessCase
		if err := DecodeStrict(c.Input, &a); err != nil {
			return false, nil
		}
		now, err := time.Parse(time.RFC3339Nano, a.Now)
		return err == nil && HasCapability(a.Principal, a.Grants, a.OrganizationID, a.BrainID, a.Capability, now), nil
	case "cursor_binding":
		var cursorCase CursorCase
		if err := DecodeStrict(c.Input, &cursorCase); err != nil {
			return false, nil
		}
		now, err := time.Parse(time.RFC3339Nano, cursorCase.Now)
		return err == nil && cursorCase.Cursor.ValidateBinding(cursorCase.OrganizationID, cursorCase.BrainID, cursorCase.UserID, cursorCase.MembershipEpoch, now) == nil, nil
	case "edge_visibility":
		var e EdgeCase
		if err := DecodeStrict(c.Input, &e); err != nil {
			return false, nil
		}
		now, err := time.Parse(time.RFC3339Nano, e.Now)
		return err == nil && EdgeVisible(e.Edge, e.Principal, e.Grants, now), nil
	default:
		return false, invalid("kind", "unsupported_fixture_kind")
	}
}
