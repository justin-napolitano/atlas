"""Private native workspace routes, registered only on the existing owner router."""
from typing import Annotated,Literal
from fastapi import Depends,HTTPException,Query
from pydantic import BaseModel,ConfigDict,Field,field_validator

ID=Annotated[str,Field(min_length=1,max_length=500,pattern=r'^[^\x00-\x1f\x7f]+$')]
Revision=Annotated[int,Field(strict=True,ge=0)]
Kind=Literal['note','question','source_claim','interpretation','objection','decision','principle']
UUID4=Annotated[str,Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')]

class Input(BaseModel):
    model_config=ConfigDict(extra='forbid')

class Write(Input):
    owner_confirmed:Literal[True]
    @field_validator('owner_confirmed',mode='before')
    @classmethod
    def explicit(cls,value):
        if value is not True:raise ValueError('Explicit owner write required')
        return value

class Link(Input):
    kind:Literal['record','annotation','entry']
    id:ID
    rationale:Annotated[str,Field(min_length=1,max_length=2000)]

class NoteCreate(Write):
    request_uuid:UUID4
    body:Annotated[str,Field(min_length=1,max_length=20000)]
    title:Annotated[str,Field(max_length=300)]=''
    thought_type:Kind='note'
    links:Annotated[list[Link],Field(max_length=25)]=Field(default_factory=list)
    record_id:ID|None=None
    document_id:ID|None=None
    annotation_id:ID|None=None
    reading_position:Annotated[int,Field(strict=True,ge=0,le=12000)]|None=None

class NoteUpdate(Write):
    entry_id:ID
    expected_revision:Annotated[int,Field(strict=True,ge=1)]
    body:Annotated[str,Field(min_length=1,max_length=20000)]
    title:Annotated[str,Field(max_length=300)]|None=None
    title_mode:Literal['automatic','manual']|None=None
    thought_type:Kind|None=None
    links:Annotated[list[Link],Field(max_length=25)]|None=None
    state:Literal['active','withdrawn']='active'

class Trash(Write):
    entry_id:ID
    target_revision:Annotated[int,Field(strict=True,ge=1)]
    expected_revision:Revision
    state:Literal['active','trashed']

class DraftValue(Input):
    thought_type:Kind='note'
    title:Annotated[str,Field(max_length=300)]=''
    body:Annotated[str,Field(max_length=20000)]=''
    links:Annotated[list[Link],Field(max_length=25)]=Field(default_factory=list)
    state:Literal['active','withdrawn']='active'

class Draft(Write):
    draft_uuid:UUID4
    entry_id:ID|None=None
    request_uuid:UUID4|None=None
    record_id:ID|None=None
    document_id:ID|None=None
    annotation_id:ID|None=None
    reading_position:Annotated[int,Field(strict=True,ge=0,le=12000)]|None=None
    base_revision:Revision
    expected_revision:Revision
    value:DraftValue
    state:Literal['active','discarded']='active'


def register_workspace(router,store,owner):
    def write(operation,value,actor):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.workspace_operation(operation,actor=actor,**fields)

    @router.get('/workspace/notes')
    def notes(q:Annotated[str,Query(max_length=300)]='',thought_type:Literal['','note','question','source_claim','interpretation','objection','decision','principle']='',cursor:Annotated[str,Query(max_length=1200)]='',limit:Annotated[int,Query(ge=1,le=50)]=30,trashed:bool=False):
        return store.workspace_operation('notes',q=q,thought_type=thought_type,cursor=cursor,limit=limit,trashed=trashed)

    @router.get('/workspace/note')
    def note(entry_id:ID):
        row=store.workspace_operation('note',entry_id=entry_id)
        if row is None:raise HTTPException(404,'Note not found')
        return row

    @router.post('/workspace/notes',status_code=201)
    def create(value:NoteCreate,actor:str=Depends(owner)):return write('create_note',value,actor)

    @router.put('/workspace/note')
    def update(value:NoteUpdate,actor:str=Depends(owner)):return write('update_note',value,actor)

    @router.get('/workspace/note/history')
    def history(entry_id:ID,before_revision:Annotated[int,Query(ge=1)]|None=None,limit:Annotated[int,Query(ge=1,le=50)]=30):
        rows=store.workspace_operation('history',entry_id=entry_id,before_revision=before_revision,limit=limit+1)
        if rows is None:raise HTTPException(404,'Note not found')
        return dict(items=rows[:limit],next_before_revision=rows[limit-1]['revision'] if len(rows)>limit else None)

    @router.put('/workspace/note/trash')
    def trash(value:Trash,actor:str=Depends(owner)):return write('trash',value,actor)

    @router.get('/workspace/draft')
    def draft(draft_id:ID):
        row=store.workspace_operation('draft',draft_id=draft_id)
        if row is None:raise HTTPException(404,'Writing recovery not found')
        return row

    @router.get('/workspace/drafts')
    def drafts(cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        rows=store.workspace_operation('drafts',cursor=cursor,limit=limit+1)
        return dict(items=rows[:limit],next_cursor=rows[limit-1]['id'] if len(rows)>limit else None)

    @router.put('/workspace/draft')
    def save_draft(value:Draft,actor:str=Depends(owner)):return write('save_draft',value,actor)
