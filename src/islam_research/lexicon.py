"""Lexical retrieval/validation without language inference or external services."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import uuid

from .passages import anchor

SEARCH_VERSION = "lexicon-search-1"
DEFINITION_KINDS = {"source_explicit", "reference_gloss", "owner_paraphrase", "machine_proposed"}
GRANDFATHERED = set("en-GB-oed i-ami i-bnn i-default i-enochian i-hak i-klingon i-lux i-mingo i-navajo i-pwn i-tao i-tay i-tsu sgn-BE-FR sgn-BE-NL sgn-CH-DE art-lojban cel-gaulish no-bok no-nyn zh-guoyu zh-hakka zh-min zh-min-nan zh-xiang".lower().split())


def text(value, name, maximum, *, empty=False):
    if not isinstance(value,str) or len(value)>maximum or "\x00" in value or not empty and not value.strip():
        raise ValueError(f"Invalid {name}")
    return value


def language_tag(value):
    """RFC 5646-shaped syntax, including grandfathered/private-use tags.

    This checks syntax and duplicate variants/extensions, not IANA registration,
    language identification, canonicalization, or actual content language.
    """
    text(value,"declared language tag",100)
    if value.lower() in GRANDFATHERED:
        return value
    if not re.fullmatch(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*",value):
        raise ValueError("Invalid declared language tag")
    parts=value.lower().split("-")
    if parts[0]=="x":
        if len(parts)<2 or any(not 1<=len(p)<=8 for p in parts[1:]):
            raise ValueError("Invalid private-use language tag")
        return value
    primary=parts[0]
    if not primary.isalpha() or not 2<=len(primary)<=8:
        raise ValueError("Invalid declared language tag")
    i=1
    if len(primary)<=3:
        for _ in range(3):
            if i<len(parts) and len(parts[i])==3 and parts[i].isalpha(): i+=1
            else: break
    if i<len(parts) and len(parts[i])==4 and parts[i].isalpha(): i+=1
    if i<len(parts) and (len(parts[i])==2 and parts[i].isalpha() or len(parts[i])==3 and parts[i].isdigit()): i+=1
    variants=set()
    while i<len(parts) and (5<=len(parts[i])<=8 or len(parts[i])==4 and parts[i][0].isdigit()):
        if parts[i] in variants: raise ValueError("Duplicate language variant")
        variants.add(parts[i]);i+=1
    extensions=set()
    while i<len(parts) and len(parts[i])==1 and parts[i]!="x":
        if parts[i] in extensions: raise ValueError("Duplicate language extension")
        extensions.add(parts[i]);i+=1
        first=i
        while i<len(parts) and 2<=len(parts[i])<=8: i+=1
        if i==first: raise ValueError("Missing language extension value")
    if i<len(parts) and parts[i]=="x":
        i+=1;first=i
        while i<len(parts) and 1<=len(parts[i])<=8: i+=1
        if i==first: raise ValueError("Missing private-use language value")
    if i!=len(parts): raise ValueError("Invalid declared language tag")
    return value


def representation(written_rep, language, script, transliteration_scheme):
    text(written_rep,"written representation",500)
    language_tag(language)
    text(script,"declared script",4,empty=True)
    if script and not re.fullmatch(r"[A-Za-z]{4}",script):
        raise ValueError("Declare a four-letter script code or leave it unknown")
    if script and language.lower() not in GRANDFATHERED and not language.lower().startswith("x-"):
        parts=language.split("-")
        for part in parts[1:]:
            if len(part)==1: break
            if len(part)==4 and part.isalpha() and part.lower()!=script.lower():
                raise ValueError("Language/script declarations conflict")
    text(transliteration_scheme,"transliteration scheme",500,empty=True)


def search_key(value):
    """Versioned retrieval only; never modify original wording or compare IDs."""
    text(value,"lexical search text",10000)
    decomposed=unicodedata.normalize("NFD",value.casefold())
    return " ".join("".join(c for c in decomposed if unicodedata.category(c)[0]!="M" and c!="\u0640").split())


def selected_term(quotation,start,end):
    return anchor(quotation,start,end)["exact"]


def request_identity(request_uuid):
    value=uuid.UUID(request_uuid)
    if value.version!=4:
        raise ValueError("Retain a UUIDv4 capture request ID when retrying")
    return value


def entity_id(request_uuid,kind):
    return "urn:research:lexicon:"+kind+":"+str(uuid.uuid5(request_identity(request_uuid),kind))


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(",", ":")).encode()).hexdigest()


def validate_definition(*,kind,wording_mode,body,attribution,scope,dating_note,rationale,
                        proposal_tool,proposal_version,proposal_activity,quotation):
    if kind not in DEFINITION_KINDS or wording_mode not in {"quotation","paraphrase"}:
        raise ValueError("Unsupported definition kind or wording mode")
    for value,name,maximum in [(body,"definition text",5000),(attribution,"definition attribution",2000),
                               (scope,"definition scope",10000),(rationale,"definition rationale",2000)]:
        text(value,name,maximum)
    text(dating_note,"dating uncertainty",2000,empty=True)
    if wording_mode=="quotation" and body!=quotation:
        raise ValueError("A definition quotation must equal its captured source quotation")
    proposals=[proposal_tool,proposal_version,proposal_activity]
    for value in proposals: text(value,"declared proposal provenance",500,empty=kind!="machine_proposed")
    if kind!="machine_proposed" and any(proposals):
        raise ValueError("Proposal provenance requires the machine-proposed definition type")
