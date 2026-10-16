"""Private confirmed reading places, independent of notes and device geometry."""
from . import database as db, passage_store


def get(connection,project_id):
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
        source=connection.execute("SELECT kind FROM research.records WHERE project_id=%s AND id=%s AND deleted_at IS NULL AND review_state<>'withdrawn'",(project_id,record_id)).fetchone()
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
        if expected_revision==0:
            row=connection.execute("""INSERT INTO research.reading_desks(project_id,record_id,document_id,annotation_id,start_pos,end_pos,changed_by)
                VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(project_id) DO NOTHING RETURNING *""",
                (project_id,record_id,document_id,annotation_id,start,end,actor)).fetchone()
        else:
            row=connection.execute("""UPDATE research.reading_desks SET record_id=%s,document_id=%s,annotation_id=%s,start_pos=%s,end_pos=%s,
                changed_by=%s,revision=revision+1 WHERE project_id=%s AND revision=%s RETURNING *""",
                (record_id,document_id,annotation_id,start,end,actor,project_id,expected_revision)).fetchone()
        if row is not None: return get(connection,project_id)
        current=get(connection,project_id)
        if current and current["revision"]==expected_revision+1 and all(current[k]==v for k,v in values.items()):
            return current
        raise db.RevisionConflict(current)


def history(connection,project_id,before_revision,limit):
    if get(connection,project_id) is None: return None
    return connection.execute("""SELECT revision,snapshot FROM research.reading_desk_revisions
        WHERE project_id=%s AND (%s::integer IS NULL OR revision<%s) ORDER BY revision DESC LIMIT %s""",
        (project_id,before_revision,before_revision,limit)).fetchall()
