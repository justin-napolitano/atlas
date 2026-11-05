"""Registered only by the trusted Electron-managed local service, never by env flags."""
from typing import Annotated,Literal
from fastapi import Depends,Query
from .workspace_api import Write,ID,UUID4
from pydantic import Field


class Reference(Write):
    request_uuid:UUID4
    reference:Annotated[str,Field(min_length=1,max_length=2000)]
    existing_source_record_id:ID|None=None
    distinct_reason:Annotated[str,Field(max_length=2000)]=''


class File(Write):
    request_uuid:UUID4
    filename:Annotated[str,Field(min_length=1,max_length=255)]
    content_base64:Annotated[str,Field(min_length=1,max_length=43692)]
    intent:Literal['source','note']
    rights_basis:Annotated[str,Field(min_length=1,max_length=2000)]
    record_id:ID|None=None


class Metadata(Write):
    request_uuid:UUID4
    record_id:ID
    expected_revision:Annotated[int,Field(strict=True,ge=1)]
    title:Annotated[str,Field(min_length=1,max_length=2000)]
    creators:Annotated[str,Field(max_length=2000)]=''
    edition:Annotated[str,Field(max_length=1000)]=''


class PagePrepare(Write):
    request_uuid:UUID4
    parent_id:ID|None=None
    folder_id:ID|None=None


class FolderChange(Write):
    request_uuid:UUID4
    folder_id:ID|None=None
    title:Annotated[str,Field(min_length=1,max_length=300)]|None=None
    parent_id:ID|None=None
    expected_revision:Annotated[int,Field(strict=True,ge=0)]=0
    action:Literal['create','rename','move','remove']='create'


class PageMove(Write):
    request_uuid:UUID4
    folder_id:ID|None=None
    entry_id:ID
    parent_id:ID|None=None
    expected_revision:Annotated[int,Field(strict=True,ge=0)]


def register(router,store,owner,artifact_root):
    def write(operation,value,actor):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.desktop_operation(operation,actor=actor,**fields)

    @router.get('/desktop/capabilities')
    def capabilities():
        return dict(local_sources=True,pages=True,folders=True,files=True,github_vault=True,formats=['md','markdown','txt'],max_file_bytes=32768,cloud_sync=False)

    @router.get('/desktop/tree')
    def tree(folder_id:ID|None=None,parent_id:ID|None=None,q:Annotated[str,Query(max_length=300)]='',
             cursor:Annotated[str,Query(max_length=1600)]='',limit:Annotated[int,Query(ge=1,le=50)]=30,all_items:bool=False):
        return store.folder_operation('tree',folder_id=folder_id,parent_id=parent_id,q=q,cursor=cursor,limit=limit,all_items=all_items)

    @router.post('/desktop/folders',status_code=201)
    def folder(value:FolderChange,actor:str=Depends(owner)):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.folder_operation('change',actor=actor,**fields)

    @router.get('/desktop/pages')
    def pages(parent_id:ID|None=None,q:Annotated[str,Query(max_length=300)]='',cursor:Annotated[str,Query(max_length=1600)]='',
              limit:Annotated[int,Query(ge=1,le=50)]=30,all_pages:bool=False):
        return store.page_operation('listing',parent_id=parent_id,q=q,cursor=cursor,limit=limit,all_pages=all_pages)

    @router.get('/desktop/page')
    def page(entry_id:ID):return store.page_operation('context',entry_id=entry_id)

    @router.get('/desktop/pages/backlinks')
    def backlinks(entry_id:ID,cursor:Annotated[str,Query(max_length=500)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return store.page_operation('backlinks',entry_id=entry_id,cursor=cursor,limit=limit)

    @router.get('/desktop/pages/resolve')
    def resolve(target:Annotated[str,Query(min_length=1,max_length=500)]):return store.page_operation('resolve',target=target)

    @router.post('/desktop/pages/prepare',status_code=201)
    def prepare(value:PagePrepare,actor:str=Depends(owner)):
        return store.page_operation('prepare_child',actor=actor,request_uuid=value.request_uuid,parent_id=value.parent_id,folder_id=value.folder_id)

    @router.post('/desktop/pages/parent')
    def move(value:PageMove,actor:str=Depends(owner)):
        return store.page_operation('move',actor=actor,request_uuid=value.request_uuid,entry_id=value.entry_id,
            parent_id=value.parent_id,folder_id=value.folder_id,expected_revision=value.expected_revision)

    @router.post('/desktop/references',status_code=201)
    def reference(value:Reference,actor:str=Depends(owner)):return write('reference',value,actor)

    @router.get('/desktop/source/writing')
    def related(record_id:ID,cursor:Annotated[str,Query(max_length=1200)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return store.desktop_operation('related',record_id=record_id,cursor=cursor,limit=limit)

    @router.post('/desktop/source/metadata')
    def metadata(value:Metadata,actor:str=Depends(owner)):return write('metadata',value,actor)

    @router.post('/desktop/files',status_code=201)
    def ingest(value:File,actor:str=Depends(owner)):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.desktop_operation('ingest',artifact_root=artifact_root,actor=actor,**fields)

    @router.get('/desktop/source/files')
    def artifacts(record_id:ID):return dict(items=store.desktop_operation('artifacts',record_id=record_id))
