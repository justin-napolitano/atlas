"""Private source excerpts and revision-safe captured annotations."""
from __future__ import annotations

import hashlib
import json
from urllib.parse import urlsplit
import uuid

from . import database as db
from .passages import anchor, normalize_excerpt, resolve_anchor, web_annotation


def get_document(connection, project_id, document_id):
    return connection.execute("""SELECT d.* FROM research.reading_documents d
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        WHERE d.project_id=%s AND d.id=%s AND r.deleted_at IS NULL""",(project_id,document_id)).fetchone()


def create_document(connection, *, project_id, source_record_id, edition, locator, representation_url, text, actor):
    snapshot = normalize_excerpt(text)
    for value,name,limit in [(edition,"edition",1000),(locator,"locator",2000),(actor,"actor",500)]:
        db._text(value,name,limit)
    db._text(representation_url,"representation URL",2000,empty=True)
    if representation_url:
        url = urlsplit(representation_url)
        if url.scheme not in {"https","http"} or not url.hostname or url.username or url.password:
            raise ValueError("Supply an HTTP(S) source representation without embedded credentials")
    with connection.transaction():
        source = connection.execute("SELECT kind FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL",
                                    (project_id,source_record_id)).fetchone()
        if not source or source["kind"] not in {"source","work","edition"}:
            raise ValueError("A reading excerpt must target an active source, work, or edition in this project")
        key = hashlib.sha256(json.dumps([source_record_id,edition,locator,representation_url,snapshot["text_sha256"]],ensure_ascii=False).encode()).hexdigest()
        row = connection.execute("""INSERT INTO research.reading_documents
            (id,project_id,source_record_id,edition,locator,representation_url,text_body,input_sha256,text_sha256,normalization,content_key,changed_by)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(project_id,content_key) DO NOTHING RETURNING *""",
            ("urn:research:document:"+str(uuid.uuid4()),project_id,source_record_id,edition,locator,representation_url,
             snapshot["text"],snapshot["input_sha256"],snapshot["text_sha256"],snapshot["normalization"],key,actor)).fetchone()
        if row is None:
            row = connection.execute("SELECT * FROM research.reading_documents WHERE project_id=%s AND content_key=%s",(project_id,key)).fetchone()
            if any(row[k] != v for k,v in {"source_record_id":source_record_id,"edition":edition,"locator":locator,
                                         "representation_url":representation_url,"text_body":snapshot["text"]}.items()):
                raise ValueError("Snapshot fingerprint conflict requires reconciliation")
        return row


def documents(connection, project_id, source_record_id, cursor, limit):
    return connection.execute("""SELECT d.id,d.project_id,d.source_record_id,d.edition,d.locator,d.representation_url,
        d.text_sha256,d.normalization,d.review_scope,d.created_at FROM research.reading_documents d
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        WHERE d.project_id=%s AND d.source_record_id=%s AND d.id>%s AND r.deleted_at IS NULL ORDER BY d.id LIMIT %s""",
        (project_id,source_record_id,cursor,limit)).fetchall()


def annotation(connection, project_id, annotation_id):
    row = connection.execute("SELECT * FROM research.reading_annotations WHERE project_id=%s AND id=%s",
                             (project_id,annotation_id)).fetchone()
    if row is None:
        return None
    document = get_document(connection,project_id,row["document_id"])
    if document is None:
        return None
    selector = {"start":row["start_pos"],"end":row["end_pos"],**{key:row[key] for key in ["text_sha256","exact","prefix","suffix"]}}
    return {"annotation":row,"anchor":resolve_anchor(document["text_body"],selector),"web_annotation":web_annotation(document,row)}


def create_annotation(connection, *, annotation_uuid, project_id, document_id, text_sha256, start, end, exact, capture_kind, body, actor, mark_style="highlight"):
    identifier = uuid.UUID(annotation_uuid)
    if identifier.version != 4:
        raise ValueError("Use a fresh UUIDv4 capture ID and retain it when retrying")
    if capture_kind not in {"comment","term_candidate","citation_candidate"}:
        raise ValueError("Unsupported capture kind")
    if mark_style not in {"highlight","underline","none"}:
        raise ValueError("Unsupported passage mark style")
    db._text(body,"annotation body",10000,empty=True)
    db._text(actor,"actor",500)
    annotation_id = "urn:research:annotation:"+str(identifier)
    with connection.transaction():
        document = get_document(connection,project_id,document_id)
        if document is None:
            raise ValueError("Active reading snapshot not found in this project")
        selection = anchor(document["text_body"],start,end)
        if selection["text_sha256"] != text_sha256 or selection["exact"] != exact:
            raise ValueError("The source version or selected text changed; select it again")
        row = connection.execute("""INSERT INTO research.reading_annotations
            (id,project_id,document_id,text_sha256,start_pos,end_pos,exact,prefix,suffix,capture_kind,body,changed_by,mark_style)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING RETURNING *""",
            (annotation_id,project_id,document_id,text_sha256,start,end,exact,selection["prefix"],selection["suffix"],capture_kind,body,actor,mark_style)).fetchone()
        if row is None:
            row = connection.execute("SELECT * FROM research.reading_annotations WHERE id=%s",(annotation_id,)).fetchone()
            if any(row[k] != v for k,v in {"project_id":project_id,"document_id":document_id,"start_pos":start,"end_pos":end,
                "exact":exact,"text_sha256":text_sha256,"capture_kind":capture_kind,"body":body,"changed_by":actor,"mark_style":mark_style}.items()):
                raise db.RevisionConflict(row)
        return row


def annotations(connection, project_id, document_id, cursor, limit):
    if get_document(connection,project_id,document_id) is None:
        return []
    return connection.execute("SELECT * FROM research.reading_annotations WHERE project_id=%s AND document_id=%s AND id>%s ORDER BY id LIMIT %s",
                              (project_id,document_id,cursor,limit)).fetchall()


def update_annotation(connection, *, annotation_id, project_id, body, expected_revision, actor, mark_style=None):
    db._text(body,"annotation body",10000,empty=True)
    db._text(actor,"actor",500)
    if mark_style is not None and mark_style not in {"highlight","underline","none"}:
        raise ValueError("Unsupported passage mark style")
    if type(expected_revision) is not int or expected_revision < 1:
        raise ValueError("Supply the last confirmed annotation revision")
    with connection.transaction():
        current = annotation(connection,project_id,annotation_id)
        if current is None:
            raise ValueError("Active annotation not found")
        row = connection.execute("""UPDATE research.reading_annotations SET body=%s,revision=revision+1,changed_by=%s,
            mark_style=coalesce(%s,mark_style)
            WHERE project_id=%s AND id=%s AND revision=%s RETURNING *""",
            (body,actor,mark_style,project_id,annotation_id,expected_revision)).fetchone()
        if row is None:
            latest=connection.execute("SELECT * FROM research.reading_annotations WHERE project_id=%s AND id=%s",
                                      (project_id,annotation_id)).fetchone()
            # A repeated request after a lost response acknowledges the same edit,
            # but cannot overwrite a different newer body or explicit style.
            if (latest and latest["revision"]==expected_revision+1 and latest["body"]==body
                and latest["changed_by"]==actor and (mark_style is None or latest["mark_style"]==mark_style)):
                return latest
            raise db.RevisionConflict(latest)
        return row
