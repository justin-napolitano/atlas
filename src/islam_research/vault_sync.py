"""Reviewed, bounded Markdown sync using GitHub's atomic expected-head mutation."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import uuid
from urllib.parse import quote

from . import database as db,vault_format as codec,vault_connection as connection,workspace_store as workspace
from .github_native import GitHubUnavailable,NativeGitHub

MAX_PAGES=10
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
        path=item.get('path','')
        if path.startswith(('.atlas/pages/','notes/')):
            if path in result:raise GitHubUnavailable('Duplicate vault path',409)
            result[path]=item
    return result


def _remote_page(remote,binding,inventory,entry_id):
    manifest_path,body_path=codec.paths(entry_id)
    pair=[inventory.get(path) for path in (manifest_path,body_path)]
    if not any(pair):return None
    if not all(pair):raise GitHubUnavailable('A vault page is missing its Markdown or identity record',409)
    blobs=[]
    for item,maximum in zip(pair,(codec.MAX_MANIFEST_BYTES,codec.MAX_MARKDOWN_BYTES)):
        if item.get('type')!='blob' or item.get('mode')!='100644' or type(item.get('size')) is not int or item['size']>maximum or not re.fullmatch('[0-9a-f]{40}',item.get('sha','')):
            raise GitHubUnavailable('Unsupported vault file or size; no content was replaced',409)
        row=remote.request('repos/'+binding['repository']+'/git/blobs/'+item['sha'])['data']
        try:
            if row['encoding']!='base64':raise ValueError()
            content=base64.b64decode(''.join(row['content'].split()),validate=True)
            digest=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()
            if digest!=item['sha']:raise ValueError()
        except (KeyError,ValueError,TypeError):raise GitHubUnavailable('Vault content did not match its Git identity',409) from None
        blobs.append(content)
    try:return codec.decode_page(manifest_path,blobs[0],body_path,blobs[1])
    except ValueError:raise GitHubUnavailable('Unsupported or conflicting vault page metadata; both copies were retained',409) from None


def _summary(row):
    return dict(id=str(row['id']),state=row['state'],base_head=row['base_head'],commit_sha=row['commit_sha'],
                actions=[{key:item.get(key) for key in ('id','title','action','reason','revision')} for item in row['payload']['actions']],
                remote_coverage=row['payload'].get('remote_coverage','Selected pages only'),created_at=row['created_at'])


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
    remote=remote or NativeGitHub();request=uuid.UUID(request_uuid)
    if request.version!=4 or str(request)!=request_uuid or type(include_remote) is not bool or not isinstance(entries,list) or len(entries)>MAX_PAGES:
        raise ValueError('Select at most ten pages')
    digest=hashlib.sha256(json.dumps(dict(entries=entries,include_remote=include_remote),sort_keys=True).encode()).hexdigest()
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
    if include_remote:
        discovered=[]
        for path in sorted(inventory):
            match=re.fullmatch(r'\.atlas/pages/([0-9a-f-]{36})\.json',path)
            if match:
                entry_id=codec.PREFIX+match[1];codec.identity(entry_id)
                if not workspace.note(c,entry_id):discovered.append(entry_id)
        remaining=MAX_PAGES-len(selected)
        for entry_id in discovered[:remaining]:selected[entry_id]=None
        coverage='New remote pages included'+(' · more remain for another batch' if len(discovered)>remaining else '')
    if not selected:raise ValueError('Select a page or include new vault pages')
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
        actions.append(dict(id=entry_id,title=(local or other or {}).get('title','Unavailable page'),revision=revision,
                            action=action,local=local,remote=other,reason='Both versions need review' if action=='conflict' else None))
    available_remote={codec.PREFIX+path.rsplit('/',1)[1][:-5] for path in inventory if re.fullmatch(r'\.atlas/pages/[0-9a-f-]{36}\.json',path)}
    pushed={item['id'] for item in actions if item['action']=='push'}
    for item in actions:
        if item['action']=='push' and any(link['id'] not in available_remote|pushed for link in item['local']['links']):
            item.update(action='conflict',reason='Select linked pages too, so their identities remain available')
    with c.transaction():
        c.execute('''INSERT INTO research.vault_sync_plans(id,input_sha256,repository_id,account_id,branch,base_head,payload,created_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING''',
          (request,digest,binding['repository_id'],binding['account_id'],binding['branch'],checked['head_sha'],db.Jsonb(dict(actions=actions,remote_coverage=coverage)),actor))
    row=c.execute('SELECT * FROM research.vault_sync_plans WHERE id=%s',(request,)).fetchone()
    if row['input_sha256']!=digest or row['created_by']!=actor:raise GitHubUnavailable('Preview identity changed; no content uploaded',409)
    return _summary(row)


def _commit(remote,binding,row):
    additions=[]
    for item in row['payload']['actions']:
        if item['action']=='push':
            additions.extend(dict(path=path,contents=base64.b64encode(content).decode('ascii')) for path,content in codec.encode_page(item['local']).items())
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
        if any(item['action'] in {'conflict','excluded'} for item in row['payload']['actions']):raise GitHubUnavailable('This selection needs review; no files were uploaded',409)
        binding=connection.status(c)['connection']
        if not binding or any(binding[key]!=row[key] for key in ('repository_id','account_id','branch')):raise GitHubUnavailable('Vault binding changed; this selection was not moved',409)
        checked=connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
        if row['state']=='prepared':
            with c.transaction():
                for item in row['payload']['actions']:
                    local=workspace.note(c,item['id'])
                    if (local['revision'] if local else None)!=item['revision'] or (local and (codec.exclusion(local) or _page(local)!=item['local'])):
                        raise GitHubUnavailable('Local writing changed; preview it again before uploading',409)
                if checked['head_sha']!=row['base_head']:raise GitHubUnavailable('Vault changed; create a fresh preview',409)
                for item in row['payload']['actions']:
                    if item['local']:
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
        conflicted=False
        with c.transaction():
            new=[item['remote'] for item in row['payload']['actions'] if item['action']=='pull' and item['local'] is None]
            if new:codec.import_new_pages(c,new,actor=actor)
            for item in row['payload']['actions']:
                current=workspace.note(c,item['id']);page=item['local'] if item['action']=='push' else item['remote']
                if item['action']=='pull' and item['local'] is not None:
                    if not current or current['revision']!=item['revision']:
                        conflicted=True;continue
                    current=workspace.update_note(c,entry_id=item['id'],expected_revision=item['revision'],body=page['body'],title=page['title'] if page['title_mode']=='manual' else '',
                        title_mode=page['title_mode'],thought_type=page['thought_type'],links=page['links'],actor=actor)
                if page is not None and current:
                    confirmed=current['revision'] if not codec.exclusion(current) and _page(current)==page else item['revision'] or 0
                    c.execute('''INSERT INTO research.vault_sync_pages(entry_id,base_page,confirmed_head,dirty_revision,confirmed_revision,selected_by)
                      VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(entry_id) DO UPDATE SET base_page=excluded.base_page,
                      confirmed_head=excluded.confirmed_head,confirmed_revision=excluded.confirmed_revision,updated_at=clock_timestamp()''',
                      (item['id'],db.Jsonb(page),commit,current['revision'],confirmed,actor))
            c.execute('UPDATE research.vault_sync_plans SET state=%s,updated_at=clock_timestamp() WHERE id=%s',('conflict' if conflicted else 'confirmed',identifier))
        return get_plan(c,plan_id=str(identifier))
    finally:c.execute('SELECT pg_advisory_unlock(184514,173125)')
