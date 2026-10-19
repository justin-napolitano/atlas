# Personal Qur’an reading progress

Tracking: #187. This is owner-declared completion, separate from reading place,
source review, comprehension, annotation, and publication.

Each ayah number has a quiet **Mark read** action. Press it again to mark unread.
Confirmed counts appear beside the current surah, in the single sidebar's surah
list, and in the toolbar's whole-Qur’an progress disclosure. Completion is the
number of distinct marked ayahs out of 6,236; the disclosure also counts complete
surahs out of 114. These are ayah counts, not estimates of time, pages or mastery.
Scrolling and opening verses never mark them read. The existing canonical resume
location continues saving independently.

Progress belongs to a project and the canonical chapter/ayah, so Arabic and
English reading share it. Notes and highlights remain tied to their exact source
edition. A change of translation does not reset progress or move annotations.

## Persistence and concurrency

Migration `0022_quran_reading_progress.sql` creates a private row per touched ayah,
with a read flag, server-generated read timestamp, monotonically increasing
revision and actor. Unread reverses the flag and clears the current read timestamp;
the private revision log retains prior transitions. There is no destructive reset
or bulk completion action in this slice.

Owner-only `GET /v1/quran/progress?project_id=…` returns bounded project state.
`PUT /v1/quran/progress` accepts project, chapter, ayah, `is_read`,
`expected_revision`, and explicit owner confirmation. The actor comes from signed
owner authentication. Canonical chapter/ayah bounds are enforced in application
code and database constraints. An advisory lock serializes edits to the same
project/ayah. The exact stale revision plus matching outcome confirms a lost
acknowledgement without another row or revision; other competing outcomes conflict.

Frontend per-ayah save queues freeze an uncertain request while preserving newer
clicks. Completion counts reflect confirmed state, while a pending toggle says
Saving. Failures remain visible with retry; conflicts offer Use saved progress or
Keep my read mark. Clean refreshes adopt newer server revisions without replacing
pending actions. Queue state lives with the workspace's in-memory draft owner so
view navigation cannot silently discard pending work. A hard browser close before
acknowledgement is not guaranteed to preserve an unsent action; the server's
confirmed state is authoritative on reload. No progress is stored in localStorage.

The local review adapter durably saves progress with the rest of its visibly local
state. That demonstrates local persistence, not hosted cross-device sync. Hosted
deployment requires applying the migration and refreshed least-privilege grants.

## Privacy and security

Public runtime routes and publication exports exclude progress. New table grants
allow the owner only the needed read/insert/update columns; revision history is
read-only and written by a trigger with a fixed search path. No credentials,
external provider calls, agent access, or source review promotion are introduced.
The existing owner/CSRF boundary and exact project/verse/revision response checks
remain in force. Review the migration, trigger, grants and API boundary in the PR
before deploying. Personal reading state never becomes public because a source is
published.

## Verification

Client tests cover exact retry after a lost response, no double counting, rapid
undo during an in-flight save, clean adoption of another device's newer state,
explicit conflict resolution, source/project bounds, and duplicate/invalid rows.
The real reader browser fixture checks that scrolling does not mark verses,
unconfirmed state does not increase completion, retry saves once, unread reverses
the count, and completion survives component memory loss. Existing Arabic word
selection, note editing, resizable margin, resume, and mobile checks run alongside.

HTTP boundary tests cover anonymous/public refusal, owner confirmation, CSRF,
strict booleans/revisions and rejected authority fields. Real PostgreSQL 17/18
contracts verify timestamps, idempotent saves, revision logs, conflicts, canonical
bounds, project isolation and denied public table access in CI. Those integration
tests require an isolated PostgreSQL service and are skipped when it is absent;
local fixture tests are not described as database evidence.
