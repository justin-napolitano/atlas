"""Private confirmed reading places, independent of notes and device geometry."""
from . import database as db, passage_store


def get(connection,project_id):
    if project_id is None:
        return connection.execute("""SELECT p.*,NULL::text AS project_id,r.title AS source_title,d.edition,d.locator,d.text_sha256
          FROM research.workspace_reading_desks p JOIN research.records r ON r.id=p.record_id
          LEFT JOIN research.reading_documents d ON d.id=p.document_id
          WHERE p.workspace_id='owner' AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'""").fetchone()
    return connection.execute("""SELECT p.*,r.title AS source_title,d.edition,d.locator,d.text_sha256
        FROM research.reading_desks p JOIN research.records r ON r.project_id=p.project_id AND r.id=p.record_id
        LEFT JOIN research.reading_documents d ON d.project_id=p.project_id AND d.id=p.document_id
        WHERE p.project_id=%s AND r.deleted_at IS NULL AND r.review_state<>'withdrawn'""",(project_id,)).fetchone()


def save(connection,*,project_id,record_id,document_id,annotation_id,start,end,expected_revision,actor):
    db._text(actor,"actor",500)
    if type(expected_revision) is not int or expected_revision<0:
        raise ValueError("Supply the last confirmed reading-place revision")
    if any(v is not None and type(v) is not int for v in (start,end)):
        raise ValueError("Reading positions use integer Unicode code-point offsets")
    with connection.transaction():
        source=connection.execute("SELECT kind FROM research.records WHERE project_id IS NOT DISTINCT FROM %s AND id=%s AND deleted_at IS NULL AND review_state<>'withdrawn'",(project_id,record_id)).fetchone()
        if not source or source["kind"] not in {"source","work","edition"}:
            raise ValueError("Active source not found in this project")
        if document_id is None:
            if any(v is not None for v in (annotation_id,start,end)):
                raise ValueError("A reading position requires its immutable document")
        else:
            document=passage_store.get_document(connection,project_id,document_id)
            if document is None or document["source_record_id"]!=record_id:
                raise ValueError("Reading document does not belong to this source")
            if annotation_id is not None:
                captured=passage_store.annotation(connection,project_id,annotation_id)
                if captured is None or not captured["anchor"]["anchored"] or captured["annotation"]["document_id"]!=document_id:
                    raise ValueError("Reading annotation does not belong to this document")
                selected=captured["annotation"]
                if (start is not None and start!=selected["start_pos"]) or (end is not None and end!=selected["end_pos"]):
                    raise ValueError("Position must retain the annotation's exact selector")
                start,end=selected["start_pos"],selected["end_pos"]
            elif start is None and end is None:
                start=end=0
            if type(start) is not int or type(end) is not int or not 0<=start<=end<=len(document["text_body"]):
                raise ValueError("Position is outside this immutable reading document")
        values=dict(record_id=record_id,document_id=document_id,annotation_id=annotation_id,start_pos=start,end_pos=end,changed_by=actor)
        table='workspace_reading_desks' if project_id is None else 'reading_desks'
        column='workspace_id' if project_id is None else 'project_id'
        key=project_id or 'owner'
        if expected_revision==0:
            row=connection.execute(f"""INSERT INTO research.{table}({column},record_id,document_id,annotation_id,start_pos,end_pos,changed_by)
                VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT({column}) DO NOTHING RETURNING *""",
                (key,record_id,document_id,annotation_id,start,end,actor)).fetchone()
        else:
            row=connection.execute(f"""UPDATE research.{table} SET record_id=%s,document_id=%s,annotation_id=%s,start_pos=%s,end_pos=%s,
                changed_by=%s,revision=revision+1 WHERE {column}=%s AND revision=%s RETURNING *""",
                (record_id,document_id,annotation_id,start,end,actor,key,expected_revision)).fetchone()
        if row is not None:
            if document_id:
                from .library_shelf import mark_reading
                mark_reading(connection,source_id=record_id,edition=document['edition'],representation_url=document['representation_url'],actor=actor)
            return get(connection,project_id)
        current=get(connection,project_id)
        if current and current["revision"]==expected_revision+1 and all(current[k]==v for k,v in values.items()):
            return current
        raise db.RevisionConflict(current)


def history(connection,project_id,before_revision,limit):
    if get(connection,project_id) is None: return None
    table='workspace_reading_desk_revisions' if project_id is None else 'reading_desk_revisions'
    column='workspace_id' if project_id is None else 'project_id'
    return connection.execute(f"""SELECT revision,snapshot FROM research.{table}
        WHERE {column}=%s AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s""",
        (project_id or 'owner',before_revision,before_revision,limit)).fetchall()
