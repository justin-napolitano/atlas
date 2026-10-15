"""Transactional private lexicon authoring and project-scoped retrieval."""
from __future__ import annotations

from psycopg import sql

from . import database as db, lexicon as model, passage_store

TABLES={"lexicon_entries","lexicon_forms","lexicon_representations","lexicon_senses","lexicon_definitions","lexicon_occurrences"}
UPDATES={"lexicon_senses":{"scope","rationale","state"},
         "lexicon_definitions":{"wording_mode","body","attribution","scope","dating_note","rationale","search_key","state"},
         "lexicon_occurrences":{"rationale","state"}}
ENTITY_TABLES={"entry":"lexicon_entries","form":"lexicon_forms","representation":"lexicon_representations",
               "sense":"lexicon_senses","definition":"lexicon_definitions","occurrence":"lexicon_occurrences"}


def _insert(connection,table,values):
    if table not in TABLES: raise ValueError("Unsupported lexicon entity")
    columns=list(values)
    row=connection.execute(sql.SQL("INSERT INTO research.{} ({}) VALUES({}) ON CONFLICT(id) DO NOTHING RETURNING *").format(
        sql.Identifier(table),sql.SQL(",").join(map(sql.Identifier,columns)),sql.SQL(",").join(sql.Placeholder() for _ in columns)),
        tuple(values.values())).fetchone()
    if row is not None: return row
    current=connection.execute(sql.SQL("SELECT * FROM research.{} WHERE project_id=%s AND id=%s").format(sql.Identifier(table)),
                               (values["project_id"],values["id"])).fetchone()
    if current and current["revision"]==1 and all(current[key]==value for key,value in values.items()): return current
    raise db.RevisionConflict(current)


def _update(connection,table,project_id,identifier,expected_revision,actor,values):
    if table not in UPDATES or set(values)!=UPDATES[table]: raise ValueError("Unsupported lexicon update")
    if type(expected_revision) is not int or expected_revision<1: raise ValueError("Supply the last confirmed lexical revision")
    model.text(actor,"actor",500)
    values={**values,"changed_by":actor}
    query=sql.SQL("UPDATE research.{} SET {},revision=revision+1 WHERE project_id=%s AND id=%s AND revision=%s RETURNING *").format(
        sql.Identifier(table),sql.SQL(",").join(sql.SQL("{}=%s").format(sql.Identifier(key)) for key in values))
    row=connection.execute(query,(*values.values(),project_id,identifier,expected_revision)).fetchone()
    if row is not None: return row
    current=connection.execute(sql.SQL("SELECT * FROM research.{} WHERE project_id=%s AND id=%s").format(sql.Identifier(table)),(project_id,identifier)).fetchone()
    if current and current["revision"]==expected_revision+1 and all(current[key]==value for key,value in values.items()): return current
    raise db.RevisionConflict(current)


def _annotation(connection,project_id,annotation_id):
    captured=passage_store.annotation(connection,project_id,annotation_id)
    if captured is None or not captured["anchor"]["anchored"]: raise ValueError("Active anchored source passage required")
    return captured["annotation"]


def _concept(connection,project_id,concept_id):
    row=connection.execute("SELECT * FROM research.records WHERE project_id=%s AND id=%s AND kind='concept' AND deleted_at IS NULL",(project_id,concept_id)).fetchone()
    if row is None: raise ValueError("Active concept not found in this project")
    return row


def _representation(connection,project_id,representation_id):
    return connection.execute("""SELECT r.*,f.entry_id FROM research.lexicon_representations r
        JOIN research.lexicon_forms f ON f.project_id=r.project_id AND f.id=r.form_id
        WHERE r.project_id=%s AND r.id=%s""",(project_id,representation_id)).fetchone()


def create_representation(connection,*,request_uuid,project_id,form_id,annotation_id,start,end,
                          language_tag,script_tag,transliteration_scheme,rationale,actor):
    with connection.transaction():
        captured=_annotation(connection,project_id,annotation_id)
        written=model.selected_term(captured["exact"],start,end)
        model.representation(written,language_tag,script_tag,transliteration_scheme)
        model.text(rationale,"representation rationale",2000);model.text(actor,"actor",500)
        return _insert(connection,"lexicon_representations",dict(id=model.entity_id(request_uuid,"representation"),
            project_id=project_id,form_id=form_id,origin_annotation_id=annotation_id,origin_start=start,origin_end=end,
            written_rep=written,language_tag=language_tag,script_tag=script_tag,transliteration_scheme=transliteration_scheme,
            search_key=model.search_key(written),search_version=model.SEARCH_VERSION,rationale=rationale,changed_by=actor))


def capture(connection,*,request_uuid,project_id,annotation_id,start,end,entry,representation_id,
            concept,sense_id,sense_scope,rationale,actor):
    request_id=model.request_identity(request_uuid)
    model.text(rationale,"connection rationale",2000);model.text(actor,"actor",500)
    payload=dict(project_id=project_id,annotation_id=annotation_id,start=start,end=end,entry=entry,
                 representation_id=representation_id,concept=concept,sense_id=sense_id,sense_scope=sense_scope,rationale=rationale,actor=actor)
    digest=model.fingerprint(payload)
    with connection.transaction():
        # READ COMMITTED: separate post-lock read sees a concurrent completed retry.
        connection.execute("SELECT pg_advisory_xact_lock(184513,hashtext(%s))",(str(request_id),))
        previous=connection.execute("SELECT * FROM research.lexicon_captures WHERE request_uuid=%s",(request_id,)).fetchone()
        if previous:
            if previous["project_id"]!=project_id or previous["input_sha256"]!=digest or previous["changed_by"]!=actor:
                raise ValueError("Capture request ID was already used for different input")
            return previous["result"]
        annotation=_annotation(connection,project_id,annotation_id)
        exact=model.selected_term(annotation["exact"],start,end)
        if sense_id:
            if entry is not None or concept is not None or not representation_id or sense_scope:
                raise ValueError("Reuse a sense with its chosen representation; do not supply a new entry or concept")
            sense=connection.execute("SELECT * FROM research.lexicon_senses WHERE project_id=%s AND id=%s AND state='active'",(project_id,sense_id)).fetchone()
            if sense is None: raise ValueError("Active sense not found in this project")
            _concept(connection,project_id,sense["concept_id"])
        else:
            model.text(sense_scope,"sense scope",10000)
            if bool(entry)==bool(representation_id): raise ValueError("Choose a new lexical entry or an existing representation")
            if entry:
                if set(entry)!={"entry_type","scope","language_tag","script_tag","transliteration_scheme"}:
                    raise ValueError("Unsupported lexical entry fields")
                if entry["entry_type"] not in {"word","multiword","undetermined"}: raise ValueError("Unsupported lexical entry type")
                model.text(entry["scope"],"lexical entry scope",10000)
                model.representation(exact,entry["language_tag"],entry["script_tag"],entry["transliteration_scheme"])
                base=dict(project_id=project_id,changed_by=actor)
                created=_insert(connection,"lexicon_entries",dict(id=model.entity_id(request_uuid,"entry"),**base,entry_type=entry["entry_type"],scope=entry["scope"]))
                form=_insert(connection,"lexicon_forms",dict(id=model.entity_id(request_uuid,"form"),**base,entry_id=created["id"],form_kind="undetermined",rationale=rationale))
                rep=create_representation(connection,request_uuid=request_uuid,project_id=project_id,form_id=form["id"],annotation_id=annotation_id,
                    start=start,end=end,language_tag=entry["language_tag"],script_tag=entry["script_tag"],transliteration_scheme=entry["transliteration_scheme"],rationale=rationale,actor=actor)
                representation_id=rep["id"]
            rep=_representation(connection,project_id,representation_id)
            if rep is None: raise ValueError("Written representation not found in this project")
            if not isinstance(concept,dict): raise ValueError("Choose a new or existing concept")
            if concept.get("mode")=="existing" and set(concept)=={"mode","concept_id"}:
                selected=_concept(connection,project_id,concept["concept_id"])
            elif concept.get("mode")=="new" and set(concept)=={"mode","title","scope","language_tag"}:
                model.text(concept["scope"],"concept scope",10000);model.language_tag(concept["language_tag"])
                selected=db.save_record(connection,record_id=model.entity_id(request_uuid,"concept"),project_id=project_id,kind="concept",
                    title=concept["title"],summary=concept["scope"],attributes={"lexicon":{"label_language":concept["language_tag"],"description_role":"owner_scope_not_definition"}},actor=actor)
            else: raise ValueError("Unsupported concept choice")
            if connection.execute("SELECT id FROM research.lexicon_senses WHERE project_id=%s AND entry_id=%s AND concept_id=%s",(project_id,rep["entry_id"],selected["id"])).fetchone():
                raise ValueError("This entry/concept connection already exists; explicitly select its sense to reuse it")
            sense=_insert(connection,"lexicon_senses",dict(id=model.entity_id(request_uuid,"sense"),project_id=project_id,
                entry_id=rep["entry_id"],concept_id=selected["id"],scope=sense_scope,rationale=rationale,changed_by=actor))
        rep=_representation(connection,project_id,representation_id)
        if rep is None or rep["entry_id"]!=sense["entry_id"] or rep["written_rep"]!=exact:
            raise ValueError("Chosen representation/sense does not match this exact term occurrence")
        occurrence=_insert(connection,"lexicon_occurrences",dict(id=model.entity_id(request_uuid,"occurrence"),project_id=project_id,
            representation_id=representation_id,sense_id=sense["id"],annotation_id=annotation_id,document_id=annotation["document_id"],
            text_sha256=annotation["text_sha256"],term_start=start,term_end=end,exact=exact,rationale=rationale,changed_by=actor))
        result=dict(concept_id=sense["concept_id"],sense_id=sense["id"],entry_id=rep["entry_id"],
                    form_id=rep["form_id"],representation_id=representation_id,occurrence_id=occurrence["id"])
        connection.execute("INSERT INTO research.lexicon_captures(request_uuid,project_id,input_sha256,result,changed_by) VALUES(%s,%s,%s,%s,%s)",
                           (request_id,project_id,digest,db.Jsonb(result),actor))
        return result


def create_definition(connection,*,definition_uuid,project_id,concept_id,sense_id,annotation_id,
                      definition_kind,wording_mode,body,attribution,attribution_person_id,scope,dating_note,
                      rationale,proposal_tool,proposal_version,proposal_activity,actor):
    with connection.transaction():
        captured=_annotation(connection,project_id,annotation_id);_concept(connection,project_id,concept_id)
        model.validate_definition(kind=definition_kind,wording_mode=wording_mode,body=body,attribution=attribution,scope=scope,
            dating_note=dating_note,rationale=rationale,proposal_tool=proposal_tool,proposal_version=proposal_version,
            proposal_activity=proposal_activity,quotation=captured["exact"])
        model.text(actor,"actor",500)
        return _insert(connection,"lexicon_definitions",dict(id=model.entity_id(definition_uuid,"definition"),project_id=project_id,
            concept_id=concept_id,sense_id=sense_id,annotation_id=annotation_id,definition_kind=definition_kind,wording_mode=wording_mode,
            body=body,attribution=attribution,attribution_person_id=attribution_person_id,scope=scope,dating_note=dating_note,rationale=rationale,
            proposal_tool=proposal_tool,proposal_version=proposal_version,proposal_activity=proposal_activity,
            search_key=model.search_key(body),search_version=model.SEARCH_VERSION,changed_by=actor))


def update_definition(connection,*,project_id,definition_id,expected_revision,wording_mode,body,attribution,
                      scope,dating_note,rationale,state,actor):
    if state not in {"active","withdrawn"}: raise ValueError("Unsupported definition state")
    with connection.transaction():
        current=connection.execute("SELECT * FROM research.lexicon_definitions WHERE project_id=%s AND id=%s",(project_id,definition_id)).fetchone()
        if current is None: raise ValueError("Definition not found")
        captured=(connection.execute("SELECT * FROM research.reading_annotations WHERE project_id=%s AND id=%s",(project_id,current["annotation_id"])).fetchone()
                  if state=="withdrawn" else _annotation(connection,project_id,current["annotation_id"]))
        model.validate_definition(kind=current["definition_kind"],wording_mode=wording_mode,body=body,attribution=attribution,
            scope=scope,dating_note=dating_note,rationale=rationale,quotation=captured["exact"],
            **{key:current[key] for key in ("proposal_tool","proposal_version","proposal_activity")})
        return _update(connection,"lexicon_definitions",project_id,definition_id,expected_revision,actor,
            dict(wording_mode=wording_mode,body=body,attribution=attribution,scope=scope,dating_note=dating_note,
                 rationale=rationale,state=state,search_key=model.search_key(body)))


def update_connection(connection,*,project_id,entity_kind,entity_id,expected_revision,rationale,state,scope,actor):
    if entity_kind not in {"sense","occurrence"} or state not in {"active","withdrawn"}: raise ValueError("Unsupported lexical connection update")
    model.text(rationale,"connection rationale",2000)
    values=dict(rationale=rationale,state=state)
    if entity_kind=="sense": model.text(scope,"sense scope",10000);values["scope"]=scope
    elif scope: raise ValueError("Occurrence scope is carried by its sense")
    with connection.transaction():
        return _update(connection,"lexicon_senses" if entity_kind=="sense" else "lexicon_occurrences",
                       project_id,entity_id,expected_revision,actor,values)


def get_concept(connection,project_id,concept_id):
    record=connection.execute("SELECT * FROM research.records WHERE project_id=%s AND id=%s AND kind='concept' AND deleted_at IS NULL",(project_id,concept_id)).fetchone()
    if record is None: return None
    defined=connection.execute("""SELECT EXISTS(SELECT 1 FROM research.lexicon_definitions l
        JOIN research.reading_annotations a ON a.project_id=l.project_id AND a.id=l.annotation_id
        JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        WHERE l.project_id=%s AND l.concept_id=%s AND l.state='active' AND l.definition_kind<>'machine_proposed'
        AND r.deleted_at IS NULL) AS present""",(project_id,concept_id)).fetchone()["present"]
    return {"concept":record,"definition_gap":not defined,"definition_review":"Separate assertions remain pending review",
            "coverage":"Active private recorded assertions and accessible source snapshots only; not corpus-wide coverage"}


def get_entity(connection,project_id,entity_kind,entity_id):
    table=ENTITY_TABLES.get(entity_kind)
    if table is None: raise ValueError("Unsupported lexical entity")
    return connection.execute(sql.SQL("SELECT * FROM research.{} WHERE project_id=%s AND id=%s").format(sql.Identifier(table)),(project_id,entity_id)).fetchone()


def history(connection,project_id,entity_kind,entity_id,before_revision,limit):
    if get_entity(connection,project_id,entity_kind,entity_id) is None: return None
    return connection.execute("SELECT * FROM research.lexicon_revisions WHERE entity_table=%s AND entity_id=%s AND revision<%s ORDER BY revision DESC LIMIT %s",
        (ENTITY_TABLES[entity_kind],entity_id,before_revision,limit)).fetchall()


def senses(connection,project_id,concept_id,cursor,limit):
    return connection.execute("""SELECT s.*,e.entry_type,e.scope AS entry_scope,p.id AS representative_id,
        p.written_rep,p.language_tag,p.script_tag,p.transliteration_scheme FROM research.lexicon_senses s
        JOIN research.lexicon_entries e ON e.project_id=s.project_id AND e.id=s.entry_id
        JOIN research.records c ON c.project_id=s.project_id AND c.id=s.concept_id
        LEFT JOIN LATERAL(SELECT r.* FROM research.lexicon_representations r
            JOIN research.lexicon_forms f ON f.project_id=r.project_id AND f.id=r.form_id
            WHERE f.project_id=e.project_id AND f.entry_id=e.id ORDER BY r.id LIMIT 1) p ON true
        WHERE s.project_id=%s AND s.concept_id=%s AND s.id>%s AND s.state='active' AND c.deleted_at IS NULL
        ORDER BY s.id LIMIT %s""",(project_id,concept_id,cursor,limit)).fetchall()


def representations(connection,project_id,entry_id,cursor,limit):
    return connection.execute("""SELECT r.*,f.entry_id,f.form_kind FROM research.lexicon_representations r
        JOIN research.lexicon_forms f ON f.project_id=r.project_id AND f.id=r.form_id
        WHERE r.project_id=%s AND f.entry_id=%s AND r.id>%s ORDER BY r.id LIMIT %s""",(project_id,entry_id,cursor,limit)).fetchall()


def definitions(connection,project_id,concept_id,cursor,limit):
    return connection.execute("""SELECT l.*,d.source_record_id,d.edition,d.locator,d.representation_url,d.text_sha256,
        a.exact AS source_quotation,r.title AS source_title FROM research.lexicon_definitions l
        JOIN research.reading_annotations a ON a.project_id=l.project_id AND a.id=l.annotation_id
        JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        JOIN research.records c ON c.project_id=l.project_id AND c.id=l.concept_id
        WHERE l.project_id=%s AND l.concept_id=%s AND l.id>%s AND l.state='active'
        AND r.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY l.id LIMIT %s""",(project_id,concept_id,cursor,limit)).fetchall()


def occurrences(connection,project_id,concept_id,cursor,limit):
    return connection.execute("""SELECT o.*,a.exact AS source_quotation,d.edition,d.locator,d.source_record_id,
        d.representation_url,r.title AS source_title,p.language_tag,p.script_tag,p.transliteration_scheme
        FROM research.lexicon_occurrences o
        JOIN research.lexicon_senses s ON s.project_id=o.project_id AND s.id=o.sense_id
        JOIN research.lexicon_representations p ON p.project_id=o.project_id AND p.id=o.representation_id
        JOIN research.reading_annotations a ON a.project_id=o.project_id AND a.id=o.annotation_id
        JOIN research.reading_documents d ON d.project_id=o.project_id AND d.id=o.document_id
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        JOIN research.records c ON c.project_id=s.project_id AND c.id=s.concept_id
        WHERE o.project_id=%s AND s.concept_id=%s AND o.id>%s AND o.state='active' AND s.state='active'
        AND r.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY o.id LIMIT %s""",(project_id,concept_id,cursor,limit)).fetchall()


def search(connection,project_id,query,limit):
    model.text(query,"lexicon query",500);normalized=model.search_key(query)
    if not normalized: raise ValueError("Use searchable letters or numbers")
    return connection.execute("""WITH hits AS (
        SELECT r.id AS concept_id,'concept_label_scope' AS channel,r.id AS match_id,r.title AS original,NULL::text AS assertion_kind
        FROM research.records r WHERE r.project_id=%s AND r.kind='concept' AND r.deleted_at IS NULL
          AND to_tsvector('simple',r.title||' '||r.summary) @@ plainto_tsquery('simple',%s)
        UNION ALL
        SELECT s.concept_id,'normalized_written_representation',p.id,p.written_rep,NULL::text
        FROM research.lexicon_representations p JOIN research.lexicon_forms f ON f.project_id=p.project_id AND f.id=p.form_id
        JOIN research.lexicon_senses s ON s.project_id=f.project_id AND s.entry_id=f.entry_id
        WHERE p.project_id=%s AND s.state='active' AND to_tsvector('simple',p.search_key) @@ plainto_tsquery('simple',%s)
        UNION ALL
        SELECT l.concept_id,'normalized_definition_text',l.id,l.body,l.definition_kind
        FROM research.lexicon_definitions l
        JOIN research.reading_annotations a ON a.project_id=l.project_id AND a.id=l.annotation_id
        JOIN research.reading_documents d ON d.project_id=a.project_id AND d.id=a.document_id
        JOIN research.records r ON r.project_id=d.project_id AND r.id=d.source_record_id
        WHERE l.project_id=%s AND l.state='active' AND r.deleted_at IS NULL
          AND to_tsvector('simple',l.search_key) @@ plainto_tsquery('simple',%s)
        ), chosen AS (SELECT DISTINCT ON(concept_id) * FROM hits ORDER BY concept_id,channel,match_id)
        SELECT c.id,c.project_id,c.title,c.summary,c.review_state,h.channel,h.match_id,h.assertion_kind,left(h.original,500) AS original
        FROM chosen h JOIN research.records c ON c.id=h.concept_id AND c.project_id=%s AND c.kind='concept' AND c.deleted_at IS NULL
        ORDER BY c.id LIMIT %s""",(project_id,query,project_id,normalized,project_id,normalized,project_id,limit)).fetchall()
