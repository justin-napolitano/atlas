"""Portable private reading-note format, independent of filenames and AI."""
from __future__ import annotations

import hashlib
import json

READING = {"unread", "reading", "read"}
DECISIONS = {"unreviewed", "relevant", "not_relevant", "read_later"}
KEYS = {"research_note_version", "research_id", "project_id", "base_revision", "base_sha256",
        "reading", "screening", "context", "context_sha256"}


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate note metadata key")
        result[key] = value
    return result


def _constant(value):
    raise ValueError("Non-finite note metadata number")


def content(state):
    note = state.get("note", "")
    if not isinstance(note, str) or len(note) > 10000 or "\x00" in note:
        raise ValueError("Invalid private note body")
    reading, decision = state.get("reading", "unread"), state.get("decision", "unreviewed")
    if not isinstance(reading, str) or not isinstance(decision, str) or reading not in READING or decision not in DECISIONS:
        raise ValueError("Invalid reading/screening state")
    return {"reading": reading, "decision": decision, "note": note.replace("\r\n", "\n")}


def digest(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _property(record, key):
    values = record.get("attributes", {}).get("rdf_properties", {}).get(key, [])
    result = []
    for value in values:
        if value.startswith('"'):
            try:
                result.append(json.JSONDecoder().raw_decode(value)[0])
            except ValueError:
                result.append(value)
        else:
            result.append(value.removeprefix("<").removesuffix(">"))
    return result


def citation_context(record):
    """Snapshot read-only source context; never infer edition, senses, or support."""
    ir = "https://islam-research.local/vocab/"
    dct = "http://purl.org/dc/terms/"
    return {"title": record["title"], "source_urls": _property(record, dct+"source"),
            "citation": _property(record, dct+"bibliographicCitation"), "locators": _property(record, ir+"locator"),
            "edition": record.get("attributes", {}).get("edition"),
            "question_ids": _property(record, ir+"addressesQuestion"),
            "review_scope": record.get("attributes", {}).get("recorded_review_status", [])}


def render_note(record, state, *, base_state=None):
    base = base_state if base_state is not None else state
    if record["id"] != state["record_id"] or record["project_id"] != state["project_id"]:
        raise ValueError("Record and personal-state identity differ")
    context = citation_context(record)
    metadata = {"research_note_version": 1, "research_id": record["id"], "project_id": record["project_id"],
                "base_revision": base["revision"], "base_sha256": digest(content(base)),
                "reading": content(state)["reading"], "screening": content(state)["decision"],
                "context": context, "context_sha256": digest(context)}
    text = "---\n" + "\n".join(key+": "+_json(value) for key, value in metadata.items()) + "\n---\n\n" + content(state)["note"]
    parse_note(text)
    return text


def parse_note(text):
    """Parse a strict JSON-valued YAML subset without executing YAML tags/objects."""
    if not isinstance(text, str) or len(text.encode("utf-8")) > 65536 or not text.startswith("---\n"):
        raise ValueError("Unsupported or oversized note document")
    head, separator, body = text[4:].partition("\n---\n\n")
    if not separator:
        raise ValueError("Expected versioned frontmatter and a blank line before the note")
    metadata = {}
    for line in head.splitlines():
        key, separator, value = line.partition(": ")
        if not separator or key in metadata or key not in KEYS:
            raise ValueError("Unknown, duplicate, or malformed note metadata")
        metadata[key] = json.loads(value, object_pairs_hook=_pairs, parse_constant=_constant)
    if set(metadata) != KEYS or type(metadata["research_note_version"]) is not int or metadata["research_note_version"] != 1:
        raise ValueError("Unsupported note format version")
    for key in ["research_id", "project_id"]:
        if not isinstance(metadata[key], str) or not 1 <= len(metadata[key]) <= 500 or any(ord(c) < 32 for c in metadata[key]):
            raise ValueError("Invalid stable note target")
    if type(metadata["base_revision"]) is not int or not 0 <= metadata["base_revision"] <= 2147483647:
        raise ValueError("Invalid base revision")
    for key in ["base_sha256", "context_sha256"]:
        if not isinstance(metadata[key], str) or len(metadata[key]) != 64 or set(metadata[key]) - set("0123456789abcdef"):
            raise ValueError("Invalid note digest")
    if not isinstance(metadata["context"], dict) or digest(metadata["context"]) != metadata["context_sha256"]:
        raise ValueError("Citation context changed; use a reviewed research edit, not private-note sync")
    state = {"record_id": metadata["research_id"], "project_id": metadata["project_id"],
             **content({"reading": metadata["reading"], "decision": metadata["screening"], "note": body})}
    return {"metadata": metadata, "state": state, "locally_changed": digest(content(state)) != metadata["base_sha256"]}
