"""Pinned, located reading aids; never automatic acquisition or scholarly review."""
from __future__ import annotations

from datetime import date
import hashlib
from importlib.resources import files
import json
from urllib.parse import urlsplit

from .quran_citations import reference

COLLECTION_SHA256 = "78220ae3f8c55f0f85c9bb611c1102eeb1f6c9bec0ea754b9afc474839008840"


def _text(value, limit=10000):
    if not isinstance(value, str) or not value.strip() or len(value)>limit or "\0" in value:
        raise ValueError("Invalid collection text")


def _url(value):
    _text(value, 2000)
    parsed=urlsplit(value)
    if parsed.scheme!="https" or parsed.username or parsed.password or parsed.port or parsed.hostname not in {
        "www.gutenberg.org", "quran.ksu.edu.sa", "al-islam.org"}:
        raise ValueError("Unreviewed collection evidence origin")


def validate_collection(value):
    """Validate attribution, source identity, bounded quotations, and located aids.

    A structural pass does not verify an interpretation or resolve global rights.
    The separate artifact hash binds these already inspected resource bytes.
    """
    if value.get("format_version")!=1 or value.get("collection_id")!="islam-authority-located-readings-v1":
        raise ValueError("Unknown reading collection")
    _text(value.get("label"));_text(value.get("review_limit"))
    sources={}
    for source in value["sources"]:
        key=source["id"]
        if key in sources:raise ValueError("Duplicate collection source")
        for field in ["id","title","creators","edition","language","coverage"]:_text(source[field])
        _url(source["source_url"]);_url(source["evidence"]["url"])
        date.fromisoformat(source["accessed_on"])
        rights=source["rights"]
        if rights["status"] not in {"brief_quotation","public_domain_us"}:raise ValueError("Unreviewed reuse category")
        for field in ["basis","notice"]:_text(rights[field])
        evidence=source["evidence"]
        if evidence["method"] not in {"pinned_raw_bytes_utf8_lf","html_visible_text_whitespace_collapsed","web_reader_visible_text"}:raise ValueError("Unknown evidence method")
        if evidence["method"]=="web_reader_visible_text":
            if evidence["sha256"] is not None or evidence["filename"] is not None:raise ValueError("Web-reader evidence cannot imply a verified raw snapshot")
        elif not isinstance(evidence["sha256"],str) or len(evidence["sha256"])!=64:
            raise ValueError("Missing raw evidence digest")
        sources[key]=source
    readings={}
    for reading in value["readings"]:
        if reading["id"] in readings or reading["source_id"] not in sources:raise ValueError("Broken collection reading identity")
        if reading["review_state"]!="pending" or reading["wording_mode"]!="quotation":raise ValueError("Collection cannot promote review or mislabel wording")
        for field in ["id","text","locator","source_scope","attribution","exact_anchor"]:_text(reading[field])
        if len(reading["text"])>500 or hashlib.sha256(reading["text"].encode()).hexdigest()!=reading["text_sha256"]:
            raise ValueError("Changed or oversized selected source quotation")
        target=reading["reference"]
        reference(target["chapter"],target["ayah_start"],target["ayah_end"])
        if target["chapter"]!=4 or target["ayah_start"] not in {59,83} or target["ayah_end"]!=target["ayah_start"]:
            raise ValueError("Outside the bounded collection")
        source=sources[reading["source_id"]]
        if reading["material_kind"]=="translation":
            if source["rights"]["status"]!="public_domain_us":raise ValueError("Full translations need an inspected reuse basis")
        elif reading["material_kind"] not in {"tafsir","linguistic_annotation"} or len(reading["text"].split())>25:
            raise ValueError("Commentary must remain a brief quotation")
        finding=reading["finding"]
        if finding["wording_mode"]!="analyst_paraphrase" or finding["review_state"]!="pending":raise ValueError("Findings must remain attributed pending analysis")
        _text(finding["text"],2000);readings[reading["id"]]=reading
    for card in value["context_cards"]:
        if card["kind"] not in {"person","term"} or card["source_id"] not in sources or card["review_state"]!="pending" or card["wording_mode"]!="analyst_paraphrase":raise ValueError("Unsupported context assertion")
        for field in ["id","label","text","locator","scope"]:_text(card[field],2000)
        _url(card["evidence_url"])
        if not card["related_source_ids"] or any(key not in sources for key in card["related_source_ids"]):raise ValueError("Context references an unidentified source")
        if not card["reading_ids"] or any(key not in readings or readings[key]["source_id"]!=card["source_id"] for key in card["reading_ids"]):raise ValueError("Context must link to its located reading")
    if not readings or not value["coverage_gaps"]:raise ValueError("Missing actual readings or coverage limits")
    return value


def collection_resource():
    """Return a fresh, validated owner resource with stable verse references."""
    raw=files("islam_research").joinpath("resources/reading-collection-v1.json").read_bytes()
    if hashlib.sha256(raw).hexdigest()!=COLLECTION_SHA256:raise ValueError("Reading collection changed; inspect source evidence before updating the pin")
    value=validate_collection(json.loads(raw))
    value["artifact_sha256"]=COLLECTION_SHA256
    for reading in value["readings"]:
        target=reading["reference"];reading["reference"]=reference(target["chapter"],target["ayah_start"],target["ayah_end"])
    return value
