"""Private organizational API: registered on the authenticated owner router only."""
from typing import Annotated,Literal
from fastapi import Depends,HTTPException,Query
from pydantic import Field
from .workspace_api import Input,Write,ID,Revision,UUID4,Kind

ObjectKind=Literal['entry','record','annotation']
Relation=Literal['personal_association','comments_on','asks_about','defines','supports','challenges','qualifies','interprets','historical_influence']
Title=Annotated[str,Field(min_length=1,max_length=300)]
Reason=Annotated[str,Field(min_length=1,max_length=2000)]

class QueryDefinition(Input):
    version:Literal[1]=1
    scope:Literal['notes','sources']='notes'
    q:Annotated[str,Field(max_length=300)]=''
    thought_type:Kind|Literal['']=''
class CollectionCreate(Write):
    request_uuid:UUID4
    title:Title
class CollectionUpdate(Write):
    id:ID
    title:Title
    state:Literal['active','archived']='active'
    expected_revision:Annotated[int,Field(strict=True,ge=1)]
class ViewCreate(CollectionCreate):
    query:QueryDefinition
class ViewUpdate(CollectionUpdate):
    query:QueryDefinition
class Membership(Write):
    collection_id:ID
    target_kind:ObjectKind
    target_id:ID
    state:Literal['active','removed']
    expected_revision:Revision
class ConnectionFields(Input):
    relation:Relation='personal_association'
    rationale:Reason
    attribution:Annotated[str,Field(max_length=1000)]=''
    evidence_annotation_id:ID|None=None
    state:Literal['tentative','accepted','withdrawn']='tentative'
class ConnectionCreate(ConnectionFields,Write):
    request_uuid:UUID4
    from_kind:ObjectKind
    from_id:ID
    to_kind:ObjectKind
    to_id:ID
class ConnectionUpdate(ConnectionFields,Write):
    id:ID
    expected_revision:Annotated[int,Field(strict=True,ge=1)]
class Investigation(Write):
    target_kind:Literal['entry','record']
    target_id:ID
    target_revision:Annotated[int,Field(strict=True,ge=1)]
    expected_revision:Revision
    state:Literal['open','investigating','provisional','resolved','revisiting']
    reason:Reason
class Reflection(Write):
    request_uuid:UUID4
    entry_id:ID
    entry_revision:Annotated[int,Field(strict=True,ge=1)]
    reason:Reason
    uncertainty:Annotated[str,Field(max_length=2000)]=''
    evidence_annotation_id:ID|None=None

def register(router,store,owner):
    def write(operation,value,actor,**extra):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.workspace_graph_operation(operation,actor=actor,**fields,**extra)
    @router.get('/workspace/collections')
    def collections(cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):return store.workspace_graph_operation('listing',entity='collection',cursor=cursor,limit=limit)
    @router.post('/workspace/collections',status_code=201)
    def create_collection(value:CollectionCreate,actor:str=Depends(owner)):return write('create',value,actor,entity='collection')
    @router.put('/workspace/collection')
    def update_collection(value:CollectionUpdate,actor:str=Depends(owner)):return write('update',value,actor,entity='collection')
    @router.put('/workspace/membership')
    def membership(value:Membership,actor:str=Depends(owner)):return write('membership',value,actor)
    @router.get('/workspace/members')
    def members(collection_id:ID,cursor:Annotated[str,Query(max_length=1100)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):return store.workspace_graph_operation('members',collection_id=collection_id,cursor=cursor,limit=limit)
    @router.get('/workspace/views')
    def views(cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):return store.workspace_graph_operation('listing',entity='view',cursor=cursor,limit=limit)
    @router.post('/workspace/views',status_code=201)
    def create_view(value:ViewCreate,actor:str=Depends(owner)):return write('create',value,actor,entity='view')
    @router.put('/workspace/view')
    def update_view(value:ViewUpdate,actor:str=Depends(owner)):return write('update',value,actor,entity='view')
    @router.post('/workspace/connections',status_code=201)
    def connect(value:ConnectionCreate,actor:str=Depends(owner)):return write('create',value,actor,entity='connection')
    @router.put('/workspace/connection')
    def update_connection(value:ConnectionUpdate,actor:str=Depends(owner)):return write('update',value,actor,entity='connection')
    @router.get('/workspace/neighborhood')
    def neighborhood(kind:ObjectKind,id:ID,depth:Annotated[int,Query(ge=1,le=2)]=1,limit:Annotated[int,Query(ge=1,le=100)]=40):return store.workspace_graph_operation('neighborhood',kind=kind,id=id,depth=depth,limit=limit)
    @router.get('/workspace/investigation')
    def investigation(target_kind:Literal['entry','record'],target_id:ID):return store.workspace_graph_operation('investigation',target_kind=target_kind,target_id=target_id)
    @router.put('/workspace/investigation')
    def investigate(value:Investigation,actor:str=Depends(owner)):return write('investigate',value,actor)
    @router.post('/workspace/reflections',status_code=201)
    def reflect(value:Reflection,actor:str=Depends(owner)):return write('reflect',value,actor)
    @router.get('/workspace/reflections')
    def reflections(entry_id:ID,cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):return store.workspace_graph_operation('reflections',entry_id=entry_id,cursor=cursor,limit=limit)

    @router.get('/workspace/collection')
    def collection(collection_id:ID):
        row=store.workspace_graph_operation('item',entity='collection',id=collection_id)
        if row is None:raise HTTPException(404,'Collection unavailable')
        return row

    @router.get('/workspace/view')
    def view(view_id:ID):
        row=store.workspace_graph_operation('item',entity='view',id=view_id)
        if row is None:raise HTTPException(404,'Saved view unavailable')
        return row
