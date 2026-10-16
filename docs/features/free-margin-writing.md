# Free margin writing

Issue #154 adds private organizational notes at an approximate reading position,
without a selected quotation. The existing notebook remains the authority.
`reading_position` is a zero-based Unicode code-point offset in an immutable
reading document. It requires the original project, source and document, forbids
an annotation ID, and cannot turn a personal note into an exact source claim.

Migration 0019 validates bounds and immutable identity in PostgreSQL. Creation
replay hashes include the point only when supplied, preserving old requests.
Recovery copies retain the point and historical baseline. The owner can insert
the column but cannot update it. Anonymous/public projections do not expose notes.

API and column-grant changes require human/AppSec review under the repository's
applied Citizen Developer policy before a hosted release. Existing IAP, origin,
write-header, private no-store and publication boundaries remain applicable.
