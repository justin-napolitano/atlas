"""Read-only vault connection/preview slice; uploads are explicitly unavailable."""
from __future__ import annotations

import re
from urllib.parse import quote

from . import vault_format,workspace_store,vault_context
from .github_native import GitHubUnavailable,NativeGitHub


def target(repository,branch):
    if not isinstance(repository,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}',repository) or '..' in repository:
        raise ValueError('Use an owner/repository name')
    if not isinstance(branch,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./-]{0,127}',branch) or any(part in branch for part in ('..','//','@{')) or branch.endswith(('/','.','.lock')):
        raise ValueError('Invalid GitHub branch')
    return repository,branch


def verify(remote,repository,branch,*,binding=None):
    """Pin a private personal repository and branch to the authenticated owner."""
    target(repository,branch)
    user=remote.request('user')['data'];repo=remote.request('repos/'+repository)['data']
    if not isinstance(user,dict) or not isinstance(repo,dict):raise GitHubUnavailable()
    if repo.get('private') is not True or repo.get('visibility') not in (None,'private') or repo.get('archived') or repo.get('disabled'):
        raise GitHubUnavailable('Choose an active private repository; no content was uploaded',403)
    if type(user.get('id')) is not int or type(repo.get('id')) is not int or user['id']<=0 or repo['id']<=0:
        raise GitHubUnavailable()
    if repo.get('owner',{}).get('id')!=user['id'] or repo.get('permissions',{}).get('push') is not True:
        raise GitHubUnavailable('The signed-in owner needs write access to their own private vault',403)
    if binding and (user['id']!=binding['account_id'] or repo['id']!=binding['repository_id']):
        raise GitHubUnavailable('The GitHub account or repository identity changed; pending data was not moved',403)
    full=repo.get('full_name','')
    if not isinstance(full,str) or full.lower()!=repository.lower():raise GitHubUnavailable('Repository identity did not match',403)
    head=remote.request('repos/'+repository+'/git/ref/heads/'+quote(branch,safe=''))['data']
    sha=head.get('object',{}).get('sha') if isinstance(head,dict) else None
    if not isinstance(sha,str) or not re.fullmatch('[0-9a-f]{40}',sha):raise GitHubUnavailable('Initialize the selected private branch before connecting')
    return dict(repository=full,repository_id=repo['id'],account_id=user['id'],account_login=user.get('login',''),branch=branch,head_sha=sha)


def status(c,*,remote=None):
    """Local metadata only; loading the workspace never fetches or uploads notes."""
    row=c.execute("SELECT * FROM research.vault_connections WHERE workspace_id='owner'").fetchone()
    pending=c.execute('SELECT count(*) AS n FROM research.vault_sync_pages WHERE dirty_revision>confirmed_revision').fetchone()['n']
    latest=c.execute("SELECT id,state,updated_at,payload->>'mode' AS mode FROM research.vault_sync_plans WHERE state IN ('dispatching','confirmed','conflict') ORDER BY updated_at DESC LIMIT 1").fetchone()
    pending_plan=c.execute("SELECT id,state FROM research.vault_sync_plans WHERE state='dispatching' ORDER BY updated_at LIMIT 1").fetchone()
    return dict(connection=row,sync_enabled=False,uploads_enabled=True,manual_sync_available=True,pending_pages=pending,last_sync=latest,
                pending_plan=pending_plan,auth_provider='installed-github-cli',capability='reviewed-markdown-backup',
                application_authority=True,automatic_backup=False)


def connect(c,*,repository,branch,actor,remote=None):
    target(repository,branch)
    remote=remote or NativeGitHub()
    old=status(c)['connection']
    if old and (old['repository'].lower()!=repository.lower() or old['branch']!=branch):
        raise GitHubUnavailable('A vault is already bound; switching repositories needs a reviewed migration',409)
    verified=verify(remote,repository,branch,binding=old)
    with c.transaction():
        c.execute('SELECT pg_advisory_xact_lock(184514,173124)')
        current=status(c)['connection']
        if current:
            if any(current[key]!=verified[key] for key in ('repository_id','account_id','branch')):raise GitHubUnavailable('The vault binding changed; refresh',409)
            return status(c)
        c.execute('''INSERT INTO research.vault_connections(workspace_id,repository,repository_id,account_id,account_login,branch,connected_by)
          VALUES('owner',%s,%s,%s,%s,%s,%s)''',(verified['repository'],verified['repository_id'],verified['account_id'],verified['account_login'],branch,actor))
    return status(c)


def preview(c,*,cursor='',limit=30,kind='entry',remote=None):
    """Return bounded local candidates after rechecking private remote identity.

    Metadata only is returned. This operation never creates files/commits/issues,
    reads remote note bodies, or treats a local candidate as a reviewed upload.
    """
    binding=status(c)['connection']
    if not binding:raise GitHubUnavailable('Connect a private vault before previewing',409)
    verified=verify(remote or NativeGitHub(),binding['repository'],binding['branch'],binding=binding)
    if kind not in ('entry','annotation') or type(limit) is not int or not 1<=limit<=50:raise ValueError('Invalid backup preview')
    if kind=='entry':page=workspace_store.notes(c,limit=limit,cursor=cursor)
    else:
        if cursor:vault_format.identity(cursor)
        candidates=c.execute("""SELECT id FROM research.reading_annotations a WHERE id>%s AND length(btrim(body))>0
          AND NOT EXISTS(SELECT 1 FROM research.workspace_annotation_trash t WHERE t.annotation_id=a.id AND t.state='trashed')
          AND NOT EXISTS(SELECT 1 FROM research.note_trash t WHERE t.target_kind='annotation' AND t.target_id=a.id AND t.state='trashed')
          ORDER BY id LIMIT %s""",(cursor,limit+1)).fetchall()
        page=dict(items=[vault_context.local(c,row['id']) for row in candidates[:limit]],next_cursor=candidates[limit-1]['id'] if len(candidates)>limit else None)
    items=[]
    for row in page['items']:
        if row is None:continue
        reason=None
        try:vault_format.encode_page(vault_context.portable(c,row))
        except (ValueError,KeyError):reason='Source context or page metadata needs reconciliation; retained locally'
        if row.get('project_id') is not None:reason='Legacy project context is not portable yet'
        items.append(dict(id=row['id'],title=row['title'],revision=row['revision'],eligible=reason is None,reason=reason,
                          kind=kind,has_source=bool(row.get('record_id') or any(link['kind']!='entry' for link in row.get('links',[]))),
                          linked_page_ids=[link['id'] for link in row.get('links',[]) if link.get('kind')=='entry']))
    return dict(items=items,next_cursor=page['next_cursor'],head_sha=verified['head_sha'],uploaded=0,uploads_enabled=True,
                kind=kind,coverage='This page only; no upload selection has been applied')
