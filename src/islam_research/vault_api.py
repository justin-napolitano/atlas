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


class CreateTask(Write):
    request_uuid:UUID4
    title:Annotated[str,Field(min_length=1,max_length=300)]
    body:Annotated[str,Field(max_length=20000)]=''
    context_entry_id:ID|None=None
    context_revision:Annotated[int,Field(strict=True,ge=1)]|None=None


class TaskState(Write):
    request_uuid:UUID4
    task_id:UUID4
    expected_revision:Annotated[int,Field(strict=True,ge=1)]
    state:Annotated[str,Field(pattern='^(open|closed)$')]


class TaskComments(Write):
    task_id:UUID4


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

    @router.get('/desktop/vault/backups')
    def backups(actor:str=Depends(owner),cursor:UUID4|None=None,limit:Annotated[int,Query(ge=1,le=10)]=10):
        return operation('backups',cursor=cursor or '',limit=limit)

    @router.get('/desktop/vault/restore-preview')
    def restore_preview(backup_id:UUID4,actor:str=Depends(owner),commit_sha:Annotated[str,Query(pattern='^([0-9a-f]{40})?$')]=''):
        return operation('restore_preview',backup_id=backup_id,commit_sha=commit_sha)

    @router.get('/desktop/tasks')
    def tasks(actor:str=Depends(owner),q:Annotated[str,Query(max_length=300)]='',state:Annotated[str,Query(pattern='^(open|closed)?$')]='',context_entry_id:ID|None=None):
        return operation('task_listing',q=q,state=state,context_entry_id=context_entry_id)

    @router.get('/desktop/tasks/detail')
    def task(task_id:UUID4,actor:str=Depends(owner)):return operation('task_detail',task_id=task_id)

    @router.post('/desktop/tasks')
    def create_task(value:CreateTask,actor:str=Depends(owner)):
        return operation('task_create',**value.model_dump(exclude={'owner_confirmed'}),actor=actor)

    @router.post('/desktop/tasks/state')
    def task_state(value:TaskState,actor:str=Depends(owner)):
        return operation('task_change_state',**value.model_dump(exclude={'owner_confirmed'}),actor=actor)

    @router.post('/desktop/tasks/sync')
    def sync_tasks(value:Write,actor:str=Depends(owner)):return operation('task_sync_tasks',actor=actor)

    @router.post('/desktop/tasks/refresh')
    def refresh_tasks(value:Write,actor:str=Depends(owner)):return operation('task_refresh')

    @router.post('/desktop/tasks/comments')
    def comments(value:TaskComments,actor:str=Depends(owner)):return operation('task_refresh_comments',task_id=value.task_id)
