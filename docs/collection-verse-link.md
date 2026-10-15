# Explicit collection-to-verse connection

`collection_link.link(connection, *, project_id, reading_id, document_id,
request_uuid, rationale, actor)` connects an already imported document to a
validated reading from `reader_collection.collection_resource()`. The transport
must enforce signed owner access and explicit confirmation; this store function
does not expose a public route or bypass existing identity policy.

The stored document must exactly match the selected reading's text, UTF-8 hash,
edition, locator and representation URL. Its source is derived from the same-
project document and must be active. A declared canonical source ID may be reused
without changing its RDF metadata. Other sources require the immutable intake
receipt for that exact document and matching source URL, creators, edition and
language; copied wording on an unrelated source record is insufficient.

In one transaction and the existing verse-material retry lock, a fresh retained
UUID creates a whole-excerpt annotation with no visible mark or note body, then
its typed pending verse material. Translations are representations. Tafsir and
linguistic excerpts are discussion links, never fabricated detected citations or
adopted interpretations. The collection's analyst findings are not copied into
the source quotation or asserted interpretation. No source acquisition, source
metadata rewrite, review promotion, graph edge or publication occurs.

The immutable creation fingerprint includes the selected collection reading,
artifact, document, source and rationale. A retry first acknowledges an existing
material receipt, preserving later passage notes, material corrections and
withdrawal. Different input with the same UUID fails before capture writes. An
existing unrelated capture UUID cannot be repurposed. The function returns project,
record, document, annotation and material IDs, current material revision and
reading ID. Reopen current state through the existing reader APIs.

Restricted PostgreSQL17/18 tests exercise all five actual collection quotations,
Rodwell translation representations and Arabic/English commentary discussion,
exact verse retrieval, wrong document/source/edition/locator/text/URL refusal,
unchanged original retries after later notes/corrections, old capture refusal and
concurrent identical requests. They run on isolated CI; no Mac database daemon is
started. Tests establish application behavior, not a new scholarly review of the
readings, global reuse rights or live hosted sign-in. No migration or new SQL grant
is needed; the operation uses existing restricted passage/material permissions.
