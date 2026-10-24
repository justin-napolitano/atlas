"""App-owned Markdown backups with bounded, commit-verified recovery previews."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import uuid
from urllib.parse import quote

from . import database as db,vault_format as codec,vault_connection as connection,workspace_store as workspace,vault_receipt as receipts
from .github_native import GitHubUnavailable,NativeGitHub

MAX_PAGES=10
MODE='app-backup-v1'
COMMIT_MUTATION='''mutation AtlasCommit($input: CreateCommitOnBranchInput!) {
 createCommitOnBranch(input: $input) { commit { oid } clientMutationId }
}'''


def _page(row):
    files=codec.encode_page(row);manifest,body=codec.paths(row['id'])
    return codec.decode_page(manifest,files[manifest],body,files[body])


def decide(local,remote,base):
    """Three-way content comparison; absent remote content never means deletion."""
    if local==remote:return 'unchanged'
    if local is None:return 'pull' if base is None and remote is not None else 'conflict'
    if remote is None:return 'push' if base is None else 'conflict'
    if base is not None and local==base:return 'pull'
    if base is not None and remote==base:return 'push'
    return 'conflict'


def _snapshot(remote,binding,head):
    repo='repos/'+binding['repository']
    tree=remote.request(repo+'/git/trees/'+head+'?recursive=1')['data']
    if not isinstance(tree,dict) or tree.get('truncated') is not False or not isinstance(tree.get('tree'),list) or len(tree['tree'])>5000:
        raise GitHubUnavailable('Vault inventory is incomplete or too large for this sync batch',409)
    result={}
    for item in tree['tree']:
        if not isinstance(item,dict) or not isinstance(item.get('path'),str):raise GitHubUnavailable('Invalid vault inventory',409)
        path=item.get('path','')
        if path.startswith(('.atlas/pages/','notes/','.atlas/backups/')):
            if path in result:raise GitHubUnavailable('Duplicate vault path',409)
            result[path]=item
    return result


def _read_file(remote,binding,item,maximum):
    if not isinstance(item,dict) or item.get('type')!='blob' or item.get('mode')!='100644' or type(item.get('size')) is not int or not 0<=item['size']<=maximum or not isinstance(item.get('sha'),str) or not re.fullmatch('[0-9a-f]{40}',item['sha']):
        raise GitHubUnavailable('Unsupported or missing backup file; no content was replaced',409)
    row=remote.request('repos/'+binding['repository']+'/git/blobs/'+item['sha'])['data']
    try:
        if not isinstance(row,dict) or row.get('encoding')!='base64' or not isinstance(row.get('content'),str):raise ValueError()
        content=base64.b64decode(''.join(row['content'].split()),validate=True)
        digest=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
        if len(content)!=item['size'] or digest!=item['sha']:raise ValueError()
    except (KeyError,ValueError,TypeError):raise GitHubUnavailable('Backup content did not match its Git identity',409) from None
    return content


def _page_files(remote,binding,inventory,entry_id):
    metadata,body=codec.paths(entry_id)
    return {metadata:_read_file(remote,binding,inventory.get(metadata),codec.MAX_MANIFEST_BYTES),
            body:_read_file(remote,binding,inventory.get(body),codec.MAX_MARKDOWN_BYTES)}


def _remote_page(remote,binding,inventory,entry_id):
    metadata,body=codec.paths(entry_id)
    if not any(path in inventory for path in (metadata,body)):return None
    files=_page_files(remote,binding,inventory,entry_id)
    try:return codec.decode_page(metadata,files[metadata],body,files[body])
    except (ValueError,RecursionError):raise GitHubUnavailable('Unsupported or conflicting vault page metadata; both copies were retained',409) from None


def _read_receipt(remote,binding,inventory,identifier):
    filename=receipts.path(identifier)
    raw=_read_file(remote,binding,inventory.get(filename),receipts.MAX_BYTES)
    try:return receipts.decode(filename,raw),raw
    except (ValueError,RecursionError):raise GitHubUnavailable('Unsupported or invalid backup coverage; no writing was changed',409) from None


def _verify_export(remote,binding,row,commit):
    inventory=_snapshot(remote,binding,commit)
    declared,raw=_read_receipt(remote,binding,inventory,str(row['id']))
    if raw!=receipts.encode(row['payload']['receipt']):raise GitHubUnavailable('The commit did not contain this exact backup receipt',409)
    try:
        for item in declared['pages']:receipts.verify_page(item,_page_files(remote,binding,inventory,item['id']))
    except (ValueError,KeyError):raise GitHubUnavailable('Backup bytes do not match their coverage receipt',409) from None
    return declared


def _summary(row):
    return dict(id=str(row['id']),state=row['state'],base_head=row['base_head'],commit_sha=row['commit_sha'],
                actions=[{key:item.get(key) for key in ('id','title','action','reason','revision')} for item in row['payload']['actions']],
                remote_coverage=row['payload'].get('remote_coverage','Selected pages only'),created_at=row['created_at'],
                mode=row['payload'].get('mode','legacy'),coverage=row['payload'].get('receipt'),
                receipt_verified=row['state']=='confirmed' and row['payload'].get('mode')==MODE)


def get_plan(c,*,plan_id,remote=None):
    row=c.execute('SELECT * FROM research.vault_sync_plans WHERE id=%s',(uuid.UUID(plan_id),)).fetchone()
    if not row:raise ValueError('Sync preview not found')
    return _summary(row)


def versions(c,*,plan_id,entry_id,remote=None):
    row=c.execute('SELECT payload FROM research.vault_sync_plans WHERE id=%s',(uuid.UUID(plan_id),)).fetchone()
    if not row:raise ValueError('Sync preview not found')
    for item in row['payload']['actions']:
        if item['id']==entry_id:return dict(local=item.get('local'),vault=item.get('remote'))
    raise ValueError('Page is not part of this sync preview')


def prepare(c,*,request_uuid,entries,include_remote=False,actor,remote=None):
    """Freeze selected local revisions and remote content without uploading anything."""
    if not c.autocommit:raise ValueError('Sync requires an operation-owned connection')
    if include_remote:raise ValueError('Backups never import pages. Use the read-only recovery preview instead.')
    remote=remote or NativeGitHub();request=uuid.UUID(request_uuid)
    if request.version!=4 or str(request)!=request_uuid or type(include_remote) is not bool or not isinstance(entries,list) or len(entries)>MAX_PAGES:
        raise ValueError('Select at most ten pages')
    digest=hashlib.sha256(json.dumps(dict(entries=entries,include_remote=include_remote,mode=MODE),sort_keys=True).encode()).hexdigest()
    old=c.execute('SELECT * FROM research.vault_sync_plans WHERE id=%s',(request,)).fetchone()
    if old:
        if old['input_sha256']!=digest or old['created_by']!=actor:raise GitHubUnavailable('This preview identity belongs to a different selection',409)
        return _summary(old)
    if c.execute("SELECT id FROM research.vault_sync_plans WHERE state='dispatching' LIMIT 1").fetchone():
        raise GitHubUnavailable('Resume the pending sync before creating another selection',409)
    binding=connection.status(c)['connection']
    if not binding:raise GitHubUnavailable('Connect a private vault first',409)
    checked=connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
    inventory=_snapshot(remote,binding,checked['head_sha'])
    selected={}
    for item in entries:
        if not isinstance(item,dict) or set(item)!={'id','revision'} or type(item['revision']) is not int:raise ValueError('Select saved page revisions')
        codec.identity(item['id'])
        if item['id'] in selected:raise ValueError('Duplicate selected page')
        selected[item['id']]=item['revision']
    coverage='Selected pages only'
    if not selected:raise ValueError('Select at least one saved application page')
    actions=[]
    for entry_id,revision in selected.items():
        row=workspace.note(c,entry_id)
        if row and row['revision']!=revision:raise GitHubUnavailable('Local writing changed; refresh the page selection',409)
        if revision is not None and not row:raise GitHubUnavailable('A selected page is unavailable',409)
        reason=codec.exclusion(row) if row else None
        if reason:actions.append(dict(id=entry_id,title=row['title'],revision=revision,action='excluded',reason=reason));continue
        try:local=_page(row) if row else None
        except ValueError:actions.append(dict(id=entry_id,title=row['title'],revision=revision,action='excluded',reason='Reconcile page metadata before syncing'));continue
        other=_remote_page(remote,binding,inventory,entry_id)
        base=c.execute('SELECT base_page FROM research.vault_sync_pages WHERE entry_id=%s',(entry_id,)).fetchone()
        action=decide(local,other,base['base_page'] if base else None)
        if action=='pull':action='conflict'
        actions.append(dict(id=entry_id,title=(local or other or {}).get('title','Unavailable page'),revision=revision,
                            action=action,local=local,remote=other,reason='Remote differences are retained; backups never change Atlas writing' if action=='conflict' else None))
    available_remote={codec.PREFIX+path.rsplit('/',1)[1][:-5] for path in inventory if re.fullmatch(r'\.atlas/pages/[0-9a-f-]{36}\.json',path)}
    pushed={item['id'] for item in actions if item['action']=='push'}
    for item in actions:
        if item['action']=='push' and any(link['id'] not in available_remote|pushed for link in item['local']['links']):
            item.update(action='conflict',reason='Select linked pages too, so their identities remain available')
    receipt=receipts.make(str(request),actions) if any(item['action']!='excluded' for item in actions) else None
    with c.transaction():
        c.execute('''INSERT INTO research.vault_sync_plans(id,input_sha256,repository_id,account_id,branch,base_head,payload,created_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING''',
          (request,digest,binding['repository_id'],binding['account_id'],binding['branch'],checked['head_sha'],db.Jsonb(dict(actions=actions,remote_coverage=coverage,mode=MODE,receipt=receipt)),actor))
    row=c.execute('SELECT * FROM research.vault_sync_plans WHERE id=%s',(request,)).fetchone()
    if row['input_sha256']!=digest or row['created_by']!=actor:raise GitHubUnavailable('Preview identity changed; no content uploaded',409)
    return _summary(row)


def _commit(remote,binding,row):
    additions=[]
    for item in row['payload']['actions']:
        if item['action']=='push' or (item['action']=='unchanged' and row['payload'].get('mode')==MODE):
            additions.extend(dict(path=path,contents=base64.b64encode(content).decode('ascii')) for path,content in codec.encode_page(item['local']).items())
    if row['payload'].get('mode')==MODE:
        additions.append(dict(path=receipts.path(str(row['id'])),contents=base64.b64encode(receipts.encode(row['payload']['receipt'])).decode('ascii')))
    if not additions:return row['base_head']
    payload=dict(query=COMMIT_MUTATION,variables=dict(input=dict(clientMutationId=str(row['id']),
        branch=dict(repositoryNameWithOwner=binding['repository'],branchName=binding['branch']),expectedHeadOid=row['base_head'],
        message=dict(headline='Atlas vault sync '+str(row['id'])),fileChanges=dict(additions=additions))))
    if len(json.dumps(payload).encode())>1_900_000:raise GitHubUnavailable('Selected pages exceed the commit batch size; preview a smaller selection',409)
    value=remote.request('graphql',method='POST',payload=payload)['data']
    try:
        if value.get('errors'):raise ValueError()
        result=value['data']['createCommitOnBranch'];sha=result['commit']['oid']
        if result['clientMutationId']!=str(row['id']) or not re.fullmatch('[0-9a-f]{40}',sha):raise ValueError()
        return sha
    except (TypeError,ValueError,KeyError):raise GitHubUnavailable('GitHub did not confirm this exact commit. Retry to reconcile; no new selection will be sent',409) from None


def _reconcile(remote,binding,row,head):
    """A lost mutation response is recovered by its marker and exact file bytes."""
    commits=remote.request('repos/'+binding['repository']+'/commits?sha='+quote(binding['branch'],safe='')+'&per_page=30')['data']
    if not isinstance(commits,list):raise GitHubUnavailable('GitHub commit history was unavailable',409)
    marker='Atlas vault sync '+str(row['id'])
    for commit in commits:
        if commit.get('commit',{}).get('message','').split('\n',1)[0]!=marker:continue
        sha=commit.get('sha','')
        if not re.fullmatch('[0-9a-f]{40}',sha):continue
        inventory=_snapshot(remote,binding,sha)
        for item in row['payload']['actions']:
            if item['action']=='push' and _remote_page(remote,binding,inventory,item['id'])!=item['local']:
                raise GitHubUnavailable('Commit marker content did not match; both copies were retained',409)
        if row['payload'].get('mode')==MODE:_verify_export(remote,binding,row,sha)
        return sha
    raise GitHubUnavailable('The remote branch moved without a matching confirmed sync. Both versions remain in this operation for review',409)


def apply(c,*,plan_id,actor,remote=None):
    """Apply an explicitly accepted frozen plan, retaining newer local work.

    The remote mutation atomically checks expectedHeadOid. Dispatch intent commits
    before the request. Lost acknowledgements never authorize a blind new commit.
    """
    if not c.autocommit:raise ValueError('Sync requires an operation-owned connection')
    remote=remote or NativeGitHub();identifier=uuid.UUID(plan_id)
    c.execute('SELECT pg_advisory_lock(184514,173125)')
    try:
        row=c.execute('SELECT * FROM research.vault_sync_plans WHERE id=%s',(identifier,)).fetchone()
        if not row or row['created_by']!=actor:raise ValueError('Sync preview is unavailable')
        if row['state']=='confirmed':return _summary(row)
        if row['state']=='conflict':raise GitHubUnavailable('Resolve the retained versions and create a fresh preview',409)
        legacy=row['payload'].get('mode')!=MODE
        if legacy and (row['state']!='dispatching' or any(item['action']=='pull' for item in row['payload']['actions'])):
            if row['state']=='dispatching':
                with c.transaction():c.execute("UPDATE research.vault_sync_plans SET state='conflict',updated_at=clock_timestamp() WHERE id=%s",(identifier,))
            raise GitHubUnavailable('This legacy preview cannot change application writing. Review a new backup selection.',409)
        if any(item['action']=='conflict' for item in row['payload']['actions']) or not any(item['action'] in {'push','unchanged'} for item in row['payload']['actions']):raise GitHubUnavailable('This selection needs review; no files were uploaded',409)
        binding=connection.status(c)['connection']
        if not binding or any(binding[key]!=row[key] for key in ('repository_id','account_id','branch')):raise GitHubUnavailable('Vault binding changed; this selection was not moved',409)
        checked=connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
        if row['state']=='prepared':
            with c.transaction():
                for item in row['payload']['actions']:
                    if item['action']=='excluded':continue
                    local=workspace.note(c,item['id'])
                    if (local['revision'] if local else None)!=item['revision'] or (local and (codec.exclusion(local) or _page(local)!=item['local'])):
                        raise GitHubUnavailable('Local writing changed; preview it again before uploading',409)
                if checked['head_sha']!=row['base_head']:raise GitHubUnavailable('Vault changed; create a fresh preview',409)
                for item in row['payload']['actions']:
                    if item.get('local'):
                        c.execute('''INSERT INTO research.vault_sync_pages(entry_id,dirty_revision,selected_by) VALUES(%s,%s,%s)
                          ON CONFLICT(entry_id) DO NOTHING''',(item['id'],item['revision'],actor))
                c.execute("UPDATE research.vault_sync_plans SET state='dispatching',updated_at=clock_timestamp() WHERE id=%s",(identifier,))
        # From this point the intent is durable even if GitHub or the process dies.
        if row['commit_sha']:commit=row['commit_sha']
        elif checked['head_sha']!=row['base_head']:
            try:commit=_reconcile(remote,binding,row,checked['head_sha'])
            except GitHubUnavailable as error:
                if error.status==409:c.execute("UPDATE research.vault_sync_plans SET state='conflict',updated_at=clock_timestamp() WHERE id=%s",(identifier,))
                raise
        else:commit=_commit(remote,binding,row)
        with c.transaction():c.execute('UPDATE research.vault_sync_plans SET commit_sha=%s,updated_at=clock_timestamp() WHERE id=%s',(commit,identifier))
        if not legacy:_verify_export(remote,binding,row,commit)
        with c.transaction():
            for item in row['payload']['actions']:
                if item['action']=='excluded':continue
                current=workspace.note(c,item['id']);page=item['local']
                if page is not None and current:
                    confirmed=current['revision'] if not codec.exclusion(current) and _page(current)==page else item['revision'] or 0
                    c.execute('''INSERT INTO research.vault_sync_pages(entry_id,base_page,confirmed_head,dirty_revision,confirmed_revision,selected_by)
                      VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(entry_id) DO UPDATE SET base_page=excluded.base_page,
                      confirmed_head=excluded.confirmed_head,confirmed_revision=excluded.confirmed_revision,updated_at=clock_timestamp()''',
                      (item['id'],db.Jsonb(page),commit,current['revision'],confirmed,actor))
            c.execute('UPDATE research.vault_sync_plans SET state=%s,updated_at=clock_timestamp() WHERE id=%s',('confirmed',identifier))
        return get_plan(c,plan_id=str(identifier))
    finally:c.execute('SELECT pg_advisory_unlock(184514,173125)')



def backups(c,*,cursor='',limit=10,remote=None):
    """List bounded coverage manifests; never start a backup or import."""
    if type(limit) is not int or not 1<=limit<=10:raise ValueError('Invalid backup page size')
    if cursor:receipts.path(cursor)
    remote=remote or NativeGitHub();binding=connection.status(c)['connection']
    if not binding:raise GitHubUnavailable('Connect a private vault before inspecting backups',409)
    checked=connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
    inventory=_snapshot(remote,binding,checked['head_sha'])
    identifiers=[]
    for filename in inventory:
        match=re.fullmatch(r'\.atlas/backups/([0-9a-f-]{36})\.json',filename)
        if match:
            try:receipts.path(match[1])
            except ValueError:continue
            if match[1]>cursor:identifiers.append(match[1])
    identifiers.sort();items=[]
    for identifier in identifiers[:limit]:
        value,_=_read_receipt(remote,binding,inventory,identifier)
        items.append(dict(id=value['id'],created_at=value['created_at'],covered_count=value['covered_count'],
                          selected_count=value['selected_count']))
    return dict(items=items,next_cursor=identifiers[limit-1] if len(identifiers)>limit else None,
                read_only=True,coverage='Backup manifests only; no pages have been restored')


def restore_preview(c,*,backup_id,commit_sha='',remote=None):
    """Verify a snapshot and compare with current writing, without any SQL writes."""
    receipts.path(backup_id)
    if commit_sha and not re.fullmatch('[0-9a-f]{40}',commit_sha):raise ValueError('Invalid snapshot commit')
    remote=remote or NativeGitHub();binding=connection.status(c)['connection']
    if not binding:raise GitHubUnavailable('Connect a private vault before inspecting recovery',409)
    checked=connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
    commit=commit_sha
    if not commit:
        filename=receipts.path(backup_id)
        history=remote.request('repos/'+binding['repository']+'/commits?sha='+checked['head_sha']+'&path='+quote(filename,safe='')+'&per_page=1')['data']
        if not isinstance(history,list) or not history or not isinstance(history[0],dict) or not isinstance(history[0].get('sha'),str) or not re.fullmatch('[0-9a-f]{40}',history[0]['sha']):
            raise GitHubUnavailable('The backup snapshot commit could not be identified',409)
        commit=history[0]['sha']
    inventory=_snapshot(remote,binding,commit)
    coverage,_=_read_receipt(remote,binding,inventory,backup_id);pages={}
    try:
        for item in coverage['pages']:pages[item['id']]=receipts.verify_page(item,_page_files(remote,binding,inventory,item['id']))
    except (ValueError,KeyError):raise GitHubUnavailable('Backup bytes do not match their coverage receipt; no writing was changed',409) from None
    items=[]
    for item in coverage['pages']:
        page=pages[item['id']];local=workspace.note(c,item['id']);reason=codec.exclusion(local) if local else None
        if reason:action='blocked'
        elif local:
            try:action='matches' if _page(local)==page else 'conflict'
            except ValueError:action='blocked';reason='Current page metadata needs reconciliation'
            if action=='conflict':reason='Current writing differs; both versions stay unchanged'
        else:action='would_create'
        if any(link['id'] not in pages and workspace.note(c,link['id']) is None for link in page['links']):
            action='blocked';reason='A linked page is outside this backup and unavailable locally'
        items.append(dict(id=item['id'],title=page['title'],application_revision=item['application_revision'],
                          current_revision=local['revision'] if local else None,action=action,reason=reason))
    return dict(id=backup_id,commit_sha=commit,read_only=True,coverage=coverage,items=items,
                restored=0,message='Inspection only. No notes, revisions, drafts, tasks or pending operations were changed.')
