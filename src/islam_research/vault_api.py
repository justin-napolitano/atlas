"""Privileged local-only connection surface, registered by the trusted desktop host."""
from typing import Annotated
from fastapi import Depends,HTTPException,Query
from pydantic import Field
from .workspace_api import Write,Input,ID,UUID4
from .github_native import GitHubUnavailable,NativeGitHub


class Connect(Write):
    repository:Annotated[str,Field(min_length=3,max_length=201)]
    branch:Annotated[str,Field(min_length=1,max_length=128)]='main'


class SelectedPage(Input):
    id:ID
    revision:Annotated[int,Field(strict=True,ge=1)]


class Prepare(Write):
    request_uuid:UUID4
    entries:Annotated[list[SelectedPage],Field(max_length=10)]
    include_remote:bool=False


class Apply(Write):
    plan_id:UUID4


def register(router,store,owner,*,remote=None):
    transport=remote or NativeGitHub()
    def operation(name,**values):
        try:return store.vault_operation(name,remote=transport,**values)
        except GitHubUnavailable as error:raise HTTPException(error.status,error.reason) from None

    @router.get('/desktop/vault')
    def status(actor:str=Depends(owner)):return operation('status')

    @router.post('/desktop/vault/connect')
    def connect(value:Connect,actor:str=Depends(owner)):
        return operation('connect',repository=value.repository,branch=value.branch,actor=actor)

    @router.get('/desktop/vault/preview')
    def preview(actor:str=Depends(owner),cursor:Annotated[str,Query(max_length=1000)]='',limit:Annotated[int,Query(ge=1,le=50)]=30):
        return operation('preview',cursor=cursor,limit=limit)

    @router.post('/desktop/vault/plan')
    def prepare(value:Prepare,actor:str=Depends(owner)):
        entries=[dict(id=item.id,revision=item.revision) for item in value.entries]
        return operation('prepare',request_uuid=value.request_uuid,entries=entries,include_remote=value.include_remote,actor=actor)

    @router.get('/desktop/vault/plan')
    def plan(plan_id:UUID4,actor:str=Depends(owner)):return operation('get_plan',plan_id=plan_id)

    @router.get('/desktop/vault/versions')
    def versions(plan_id:UUID4,entry_id:ID,actor:str=Depends(owner)):return operation('versions',plan_id=plan_id,entry_id=entry_id)

    @router.post('/desktop/vault/apply')
    def apply(value:Apply,actor:str=Depends(owner)):return operation('apply',plan_id=value.plan_id,actor=actor)
