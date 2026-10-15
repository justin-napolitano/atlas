"""Private passage anchors with Unicode positions and immutable text checksums."""
from __future__ import annotations

import hashlib
import unicodedata


def text_digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_excerpt(text):
    if not isinstance(text,str) or not 1 <= len(text) <= 12000 or "\x00" in text or not text.strip():
        raise ValueError("Supply a nonempty plain-text excerpt of at most 12000 characters")
    normalized = text.replace("\r\n","\n").replace("\r","\n")
    return {"text":normalized,"input_sha256":text_digest(text),"text_sha256":text_digest(normalized),
            "normalization":"plain-text-lf-v1; logical Unicode order; no Unicode/whitespace folding"}


def _split_cluster(text, position):
    if not 0 < position < len(text):
        return False
    code = ord(text[position])
    return (unicodedata.category(text[position]) in {"Mn","Mc","Me"} or
            text[position] == "\u200d" or text[position-1] == "\u200d" or 0x1f3fb <= code <= 0x1f3ff)


def anchor(text, start, end):
    """Python string indices count Unicode code points, not UTF-16 code units."""
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text) or end-start > 500:
        raise ValueError("Select 1–500 Unicode code points within the excerpt")
    if _split_cluster(text,start) or _split_cluster(text,end):
        raise ValueError("Selection splits a combining sequence; select the whole written character")
    return {"text_sha256":text_digest(text),"start":start,"end":end,"exact":text[start:end],
            "prefix":text[max(0,start-40):start],"suffix":text[end:end+40]}


def resolve_anchor(text, selector):
    """Diagnose drift and ambiguity. Never move an anchor or verify a source claim."""
    same_version = text_digest(text) == selector["text_sha256"]
    start,end = selector["start"],selector["end"]
    if same_version:
        try:
            expected = anchor(text,start,end)
        except ValueError:
            return {"status":"invalid_selector","anchored":False}
        if all(expected[key] == selector[key] for key in expected):
            return {"status":"anchored","anchored":True,"start":start,"end":end}
        return {"status":"invalid_selector","anchored":False}
    exact = selector["exact"]
    if not isinstance(exact,str) or not exact:
        return {"status":"invalid_selector","anchored":False}
    matches=[]; offset=0
    while len(matches) <= 100:
        found=text.find(exact,offset)
        if found<0:
            break
        matches.append(found); offset=found+1
    return {"status":"source_changed_ambiguous" if len(matches)>1 else
            "source_changed_requires_review" if matches else "source_changed_orphaned",
            "anchored":False,"candidate_count":min(len(matches),100),"candidate_count_truncated":len(matches)>100}


def web_annotation(document, annotation):
    """Export selection/comment metadata without attaching an unselected full text."""
    quote = {"type":"TextQuoteSelector",**{key:annotation[key] for key in ["exact","prefix","suffix"]}}
    position = {"type":"TextPositionSelector","start":annotation["start_pos"],"end":annotation["end_pos"]}
    created = annotation["created_at"]
    if hasattr(created,"isoformat"):
        created = created.isoformat()
    return {"@context":["http://www.w3.org/ns/anno.jsonld",{"ir":"https://islam-research.local/vocab/"}],
        "id":annotation["id"],"type":"Annotation","motivation":"commenting",
        "body":{"type":"TextualBody","value":annotation["body"],"purpose":"commenting","format":"text/markdown"},
        "target":{"type":"SpecificResource","source":document["id"],"selector":[quote,position]},
        "created":created,"creator":{"id":annotation["changed_by"],"type":"Person"},
        "ir:sourceRecord":document["source_record_id"],"ir:representationUrl":document["representation_url"],
        "ir:edition":document["edition"],"ir:locator":document["locator"],
        "ir:textSha256":document["text_sha256"],"ir:captureKind":annotation["capture_kind"],
        "ir:reviewStatus":"captured_unreviewed","ir:revision":annotation["revision"]}
