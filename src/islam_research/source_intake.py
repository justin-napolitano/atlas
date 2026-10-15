"""Explicit owner-declared bibliography intake; never fetches or reviews sources."""
from __future__ import annotations

import hashlib
from datetime import date
import json
import re
from urllib.parse import urlsplit, urlunsplit
import uuid

from . import database as db, passage_store
from .passages import normalize_excerpt

ROLES = {"primary_text", "translation", "commentary", "scholarship", "reference", "undetermined"}
ACCESS = {"unknown", "open", "subscription", "owned_copy", "unavailable"}
RIGHTS = {"unknown", "metadata_only", "permitted_excerpt", "public_domain", "open_license"}
COVERAGE = {"metadata_only", "abstract", "selected_passage", "full_work_read"}
LIMITS = {"title":2000,"creators":2000,"publication":2000,"publication_date":200,
          "edition":1000,"identifier":2000,"source_url":2000,"rights_basis":2000,
          "rationale":2000,"distinct_source_rationale":2000,"language":200,"accessed_on":10}


def identity_keys(source_url, identifier):
    """Return conservative lookup hints, never inferred edition equivalence."""
    db._text(source_url,"source URL",2000,empty=True)
    db._text(identifier,"identifier",2000,empty=True)
    source_url, identifier = source_url.strip(), identifier.strip()
    url_key = ""
    if source_url:
        parsed = urlsplit(source_url)
        if (parsed.scheme not in {"http","https"} or not parsed.hostname or parsed.username or parsed.password
            or any(ord(c)<33 for c in source_url) or "\\" in source_url):
            raise ValueError("Use an HTTP(S) source URL without credentials or whitespace")
        # Accessing port also validates malformed/out-of-range ports.
        parsed.port
        url_key = urlunsplit((parsed.scheme.lower(),parsed.netloc.lower(),parsed.path,parsed.query,""))
    doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", identifier, flags=re.I)
    identifier_key = "doi:"+doi.lower() if re.fullmatch(r"10\.[0-9]{4,9}/\S+",doi,re.I) else identifier
    return url_key, identifier_key


def validate(values):
    """Validate outside HTTP too, so scripts and transactions share the contract."""
    if values.get("owner_confirmed") is not True:
        raise ValueError("Explicit owner confirmation is required")
    request = uuid.UUID(values["intake_uuid"])
    if request.version != 4:
        raise ValueError("Retain a UUIDv4 intake ID for retries")
    for key,limit in LIMITS.items(): db._text(values[key],key,limit,empty=key not in {"title","edition","rationale"})
    if values["accessed_on"]:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}",values["accessed_on"]): raise ValueError("Use an ISO access date or leave it unknown")
        date.fromisoformat(values["accessed_on"])
    for key,allowed in [("source_role",ROLES),("access_status",ACCESS),("rights_status",RIGHTS),("coverage_scope",COVERAGE)]:
        if values[key] not in allowed: raise ValueError("Invalid "+key)
    for key in ("project_id","actor"): db._text(values[key],key,500)
    if values["existing_source_record_id"]:
        db._text(values["existing_source_record_id"],"existing source",500)
    keys = identity_keys(values["source_url"],values["identifier"])
    excerpt = values["excerpt"]
    if excerpt is not None:
        if values["rights_status"] not in {"permitted_excerpt","public_domain","open_license"} or not values["rights_basis"].strip():
            raise ValueError("Record a permitted excerpt basis before importing text")
        if set(excerpt) != {"text","edition","locator","representation_url"}:
            raise ValueError("Supply only excerpt text, edition, locator, and representation URL")
        normalize_excerpt(excerpt["text"])
        db._text(excerpt["edition"],"excerpt edition",1000)
        db._text(excerpt["locator"],"excerpt locator",2000)
        identity_keys(excerpt["representation_url"],"")
        if excerpt["edition"] != values["edition"]:
            raise ValueError("The excerpt must use the declared edition")
        if values["coverage_scope"] == "metadata_only":
            raise ValueError("Choose the actual reading coverage for an imported excerpt")
    return str(request), keys


def candidates(connection, project_id, source_url, identifier, limit=20):
    """Match exact conservative identity hints within the selected project."""
    url_key,identifier_key = identity_keys(source_url,identifier)
    if not url_key and not identifier_key: return []
    return connection.execute("""SELECT id,project_id,kind,title,revision,review_state,
        attributes->'source_intake' AS intake_metadata,
        (NULLIF(%s,'') IS NOT NULL AND attributes->'source_intake'->>'url_key'=%s) AS same_url,
        (NULLIF(%s,'') IS NOT NULL AND attributes->'source_intake'->>'identifier_key'=%s) AS same_identifier
        FROM research.records WHERE project_id=%s AND deleted_at IS NULL AND kind IN ('source','work','edition')
        AND ((NULLIF(%s,'') IS NOT NULL AND attributes->'source_intake'->>'url_key'=%s)
          OR (NULLIF(%s,'') IS NOT NULL AND attributes->'source_intake'->>'identifier_key'=%s))
        ORDER BY id LIMIT %s""", (url_key,url_key,identifier_key,identifier_key,project_id,
                                   url_key,url_key,identifier_key,identifier_key,limit)).fetchall()


def create(connection, **values):
    """Commit bibliography, optional located text, and receipt together.

    Reuse never overwrites existing bibliography. A retry returns stable IDs even
    after later source edits. Identity hints require a deliberate reuse/distinct
    choice, not automatic merging of editions. No network operations occur.
    """
    request,keys = validate(values)
    digest = hashlib.sha256(json.dumps(values,sort_keys=True,ensure_ascii=False,allow_nan=False).encode()).hexdigest()
    with connection.transaction():
        if connection.execute("SHOW transaction_isolation").fetchone()["transaction_isolation"] != "read committed":
            raise ValueError("Source intake requires read committed isolation")
        locks = sorted({"request:"+request,*(values["project_id"]+":"+key for key in keys if key)})
        for key in locks: connection.execute("SELECT pg_advisory_xact_lock(184514,hashtext(%s))",(key,))
        old = connection.execute("SELECT * FROM research.source_intakes WHERE request_uuid=%s",(request,)).fetchone()
        if old:
            if old["project_id"] != values["project_id"] or old["input_sha256"] != digest:
                raise ValueError("This intake ID already belongs to different input; reconcile before creating another")
            return {"project_id":old["project_id"],"record_id":old["source_record_id"],"document_id":old["document_id"],"replayed":True}
        declarations = {k:values[k] for k in LIMITS}
        declarations.update({k:values[k] for k in ("source_role","access_status","rights_status","coverage_scope")})
        declarations.update(metadata_origin="owner_declared_manual",identity_resolution="unresolved",review_effect="none",intake_version=1)
        declarations["intake_state"] = "representation_ready" if values["excerpt"] else "metadata_ready"
        if values["excerpt"]:
            declarations["excerpt"]={k:v for k,v in values["excerpt"].items() if k!="text"}
            declarations["excerpt"]["input_sha256"] = hashlib.sha256(values["excerpt"]["text"].encode()).hexdigest()
        source_id = values["existing_source_record_id"]
        if source_id:
            current = connection.execute("SELECT kind FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL",(values["project_id"],source_id)).fetchone()
            if not current or current["kind"] not in {"source","work","edition"}:
                raise ValueError("Choose an active source, work, or edition from this project")
        else:
            matches = candidates(connection,values["project_id"],values["source_url"],values["identifier"],1)
            if matches and not values["distinct_source_rationale"].strip():
                raise ValueError("A source shares this URL or identifier; choose reuse or explain why this is a distinct source/edition")
            source_id = "urn:research:source:"+str(uuid.uuid5(uuid.NAMESPACE_URL,"source-intake:"+request))
            metadata = {**declarations,"url_key":keys[0],"identifier_key":keys[1]}
            db.save_record(connection,record_id=source_id,project_id=values["project_id"],kind="source",title=values["title"],
                           actor=values["actor"],attributes={"source_intake":metadata})
        document = None
        if values["excerpt"] is not None:
            document = passage_store.create_document(connection,project_id=values["project_id"],source_record_id=source_id,
                                                      actor=values["actor"],**values["excerpt"])
        connection.execute("""INSERT INTO research.source_intakes
            (request_uuid,project_id,input_sha256,source_record_id,document_id,declarations,changed_by) VALUES(%s,%s,%s,%s,%s,%s,%s)""",
            (request,values["project_id"],digest,source_id,document["id"] if document else None,db.Jsonb(declarations),values["actor"]))
        return {"project_id":values["project_id"],"record_id":source_id,"document_id":document["id"] if document else None,"replayed":False}


def history(connection, project_id, source_record_id, cursor, limit):
    """Expose located intake declarations without pretending they update bibliography."""
    return connection.execute("""SELECT i.* FROM research.source_intakes i JOIN research.records r
        ON r.project_id=i.project_id AND r.id=i.source_record_id WHERE i.project_id=%s AND i.source_record_id=%s
        AND r.deleted_at IS NULL AND i.request_uuid::text>%s ORDER BY i.request_uuid::text LIMIT %s""",
        (project_id,source_record_id,cursor,limit)).fetchall()
