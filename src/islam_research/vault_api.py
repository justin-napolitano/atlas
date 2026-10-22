"""Privileged local-only connection surface, registered by the trusted desktop host."""
from typing import Annotated
from fastapi import Depends,HTTPException,Query
from pydantic import Field
from .workspace_api import Write
from .github_native import GitHubUnavailable,NativeGitHub


class Connect(Write):
    repository:Annotated[str,Field(min_length=3,max_length=201)]
    branch:Annotated[str,Field(min_length=1,max_length=128)]='main'


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
