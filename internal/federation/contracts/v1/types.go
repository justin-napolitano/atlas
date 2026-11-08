// Package v1 defines the v1alpha1 federation candidate shared by MU-TH-UR and FA-TH-UR.
// Validation does not authenticate a caller or replace transaction-bound authorization.
package v1

const (
	SchemaVersion         = "v1alpha1"
	MaxRevision     int64 = 9007199254740991 // Exact in JavaScript and PostgreSQL bigint.
	MaxBodyBytes          = 1 << 20
	MaxTitleBytes         = 1000
	MaxRequestBytes       = 6*MaxBodyBytes + 65536 // Bound worst-case JSON escaping as well as decoded text.
)

type ID string
type BrainKind string

const (
	Private  BrainKind = "private"
	Team     BrainKind = "team"
	Incident BrainKind = "incident"
)

type PageState string

const (
	Active  PageState = "active"
	Deleted PageState = "deleted"
)

type Role string

const (
	Reader     Role = "reader"
	Editor     Role = "editor"
	Reviewer   Role = "reviewer"
	BrainAdmin Role = "brain_admin"
)

type Capability string

const (
	Read   Capability = "read"
	Write  Capability = "write"
	Review Capability = "review"
	Invite Capability = "invite"
	Admin  Capability = "admin"
	Export Capability = "export"
)

type Outcome string

const (
	Accepted   Outcome = "accepted"
	Conflicted Outcome = "conflict"
)

type Organization struct {
	OrganizationID ID     `json:"organization_id"`
	Name           string `json:"name"`
}
type UserIdentity struct {
	OrganizationID ID     `json:"organization_id"`
	UserID         ID     `json:"user_id"`
	Issuer         string `json:"issuer"`
	Subject        string `json:"subject"`
}
type TeamIdentity struct {
	OrganizationID ID     `json:"organization_id"`
	TeamID         ID     `json:"team_id"`
	Name           string `json:"name"`
}
type Brain struct {
	OrganizationID ID        `json:"organization_id"`
	BrainID        ID        `json:"brain_id"`
	Kind           BrainKind `json:"kind"`
	Name           string    `json:"name"`
}

// Principal must be built by the server from current verified identity and membership.
// Team IDs never come from an untrusted edit request. Organization admin is not a content role.
type Principal struct {
	OrganizationID ID   `json:"organization_id"`
	UserID         ID   `json:"user_id"`
	TeamIDs        []ID `json:"team_ids"`
	Active         bool `json:"active"`
}
type Grant struct {
	OrganizationID ID      `json:"organization_id"`
	BrainID        ID      `json:"brain_id"`
	SubjectKind    string  `json:"subject_kind"`
	SubjectID      ID      `json:"subject_id"`
	Role           Role    `json:"role"`
	ExpiresAt      *string `json:"expires_at"`
}
type Invitation struct {
	OrganizationID ID     `json:"organization_id"`
	BrainID        ID     `json:"brain_id"`
	InvitationID   ID     `json:"invitation_id"`
	InvitedUserID  ID     `json:"invited_user_id"`
	Role           Role   `json:"role"`
	ExpiresAt      string `json:"expires_at"`
}

type PageContent struct {
	Title string    `json:"title"`
	Body  string    `json:"body"`
	State PageState `json:"state"`
}

// Operation IDs are immutable idempotency keys scoped to organization and brain.
// An actor is intentionally absent: the server attributes its authenticated caller.
type Operation struct {
	SchemaVersion  string      `json:"schema_version"`
	OrganizationID ID          `json:"organization_id"`
	BrainID        ID          `json:"brain_id"`
	OperationID    ID          `json:"operation_id"`
	DeviceID       ID          `json:"device_id"`
	PageID         ID          `json:"page_id"`
	BaseRevision   int64       `json:"base_revision"`
	Payload        PageContent `json:"payload"`
}
type Snapshot struct {
	RevisionID ID          `json:"revision_id"`
	Revision   int64       `json:"revision"`
	Content    PageContent `json:"content"`
}
type Conflict struct {
	Base   *Snapshot   `json:"base"`
	Local  PageContent `json:"local"`
	Server *Snapshot   `json:"server"`
}
type Receipt struct {
	SchemaVersion  string    `json:"schema_version"`
	OrganizationID ID        `json:"organization_id"`
	BrainID        ID        `json:"brain_id"`
	OperationID    ID        `json:"operation_id"`
	DeviceID       ID        `json:"device_id"`
	PageID         ID        `json:"page_id"`
	RequestSHA256  string    `json:"request_sha256"`
	Outcome        Outcome   `json:"outcome"`
	RevisionID     *ID       `json:"revision_id"`
	Revision       int64     `json:"revision"`
	EventID        *ID       `json:"event_id"`
	Conflict       *Conflict `json:"conflict"`
}

// Cursor is the server-side binding payload, NOT a client-mintable wire token.
// Runtime transport must make it opaque/integrity-protected and check current access.
type Cursor struct {
	SchemaVersion   string `json:"schema_version"`
	OrganizationID  ID     `json:"organization_id"`
	BrainID         ID     `json:"brain_id"`
	UserID          ID     `json:"user_id"`
	MembershipEpoch int64  `json:"membership_epoch"`
	AfterEventID    *ID    `json:"after_event_id"`
	ExpiresAt       string `json:"expires_at"`
}
type ChangeEvent struct {
	SchemaVersion  string `json:"schema_version"`
	OrganizationID ID     `json:"organization_id"`
	BrainID        ID     `json:"brain_id"`
	EventID        ID     `json:"event_id"`
	PageID         ID     `json:"page_id"`
	RevisionID     ID     `json:"revision_id"`
	Revision       int64  `json:"revision"`
	Kind           string `json:"kind"`
	OccurredAt     string `json:"occurred_at"`
}
type SourceIdentity struct {
	Provider string `json:"provider"`
	Instance string `json:"instance"`
	Table    string `json:"table"`
	SourceID string `json:"source_id"`
}
type EntityRef struct {
	BrainID  ID     `json:"brain_id"`
	EntityID ID     `json:"entity_id"`
	Kind     string `json:"kind"`
}
type Edge struct {
	OrganizationID     ID        `json:"organization_id"`
	BrainID            ID        `json:"brain_id"`
	EdgeID             ID        `json:"edge_id"`
	Source             EntityRef `json:"source"`
	Target             EntityRef `json:"target"`
	Kind               string    `json:"kind"`
	EvidenceRevisionID ID        `json:"evidence_revision_id"`
}
type RevisionRef struct {
	BrainID    ID `json:"brain_id"`
	PageID     ID `json:"page_id"`
	RevisionID ID `json:"revision_id"`
}
type GoldManifest struct {
	SchemaVersion    string        `json:"schema_version"`
	OrganizationID   ID            `json:"organization_id"`
	ManifestID       ID            `json:"manifest_id"`
	AudienceBrainIDs []ID          `json:"audience_brain_ids"`
	Revisions        []RevisionRef `json:"revisions"`
}

// APIError contains server-owned correlation metadata and safe codes, never content.
type APIError struct {
	Code      string  `json:"code"`
	Field     *string `json:"field"`
	RequestID ID      `json:"request_id"`
}

// ListResponse deliberately has no unfiltered total. Coverage must describe the
// authorized configured-source subset; a cursor is an opaque runtime token.
type ListResponse[T any] struct {
	SchemaVersion string  `json:"schema_version"`
	Items         []T     `json:"items"`
	NextCursor    *string `json:"next_cursor"`
	Coverage      string  `json:"coverage"`
}
