# Confirmed private reading place

Story #94 can save one source/document/passage position per project through the
signed-owner `GET/PUT /v1/reading/desk` API. This is a durable bookmark, not a
durable draft protocol or automatic synchronization of every scroll event.

The record stores stable source, immutable representation and optional annotation
IDs. An annotation derives its exact Unicode code-point position on the server;
otherwise a bounded position or the document beginning is used. Source-only
bookmarks are supported when no text is available. Device-specific pixel geometry
is not interpreted as a portable source location.

Writes require an expected revision: zero creates, a known revision corrects.
An identical lost-response retry acknowledges its successor without another
revision; a different stale position returns 409 with the current owner-visible
place. The interface must offer explicit reconciliation rather than silently
overwriting a position saved on another machine. Merely visiting a public page
does not create or expose this private state.

Migration 0013 adds narrow owner grants, source/document/annotation constraints,
and private revision history (`GET /v1/reading/desk-history`). Notes, scholarly
review and publication are unchanged. A removed/inactive source produces an
unavailable bookmark; this API never guesses a new edition or reanchors text.
The same project scope applies to the history endpoint. Publisher accounts cannot
read either table, and source publication does not include reading-place state.

The reader integration must demonstrate save/reload/resume, two independent
authenticated sessions, focus/position return, interrupted requests, explicit
conflict handling and keyboard/mobile behavior. Synthetic browser adapters and
real PostgreSQL tests are complementary; live hosted verification remains #42.
