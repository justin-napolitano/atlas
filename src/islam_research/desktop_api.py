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


def register(router,store,owner,artifact_root):
    def write(operation,value,actor):
        fields=value.model_dump();fields.pop('owner_confirmed')
        return store.desktop_operation(operation,actor=actor,**fields)

    @router.get('/desktop/capabilities')
    def capabilities():
        return dict(local_sources=True,files=True,formats=['md','markdown','txt'],max_file_bytes=32768,cloud_sync=False)

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
