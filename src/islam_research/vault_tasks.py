"""Private issue-backed work. Capture is local; network dispatch is explicit."""
from __future__ import annotations

import hashlib
import json
import re
import uuid

from . import database as db,workspace_store as workspace,vault_connection as connection,vault_format as codec
from .github_native import GitHubUnavailable,NativeGitHub


def _hash(value):return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def _uuid(value):
    parsed=uuid.UUID(value)
    if parsed.version!=4 or str(parsed)!=value:raise ValueError('Use a canonical task UUID4')
    return parsed


def listing(c,*,q='',state='',context_entry_id=None,limit=50,remote=None):
    if state not in ('','open','closed') or not isinstance(q,str) or len(q)>300 or not 1<=limit<=50:raise ValueError('Invalid task filter')
    rows=c.execute('''SELECT * FROM research.vault_tasks WHERE (%s='' OR state=%s)
      AND (%s::text IS NULL OR context_entry_id=%s) AND strpos(lower(title||' '||body||' '||coalesce(remote_snapshot->>'body','')),lower(%s))>0 ORDER BY updated_at DESC,id LIMIT %s''',(state,state,context_entry_id,context_entry_id,q,limit+1)).fetchall()
    return dict(items=rows[:limit],more_available=len(rows)>limit,coverage='Cached tasks; refresh GitHub to fetch remote changes')


def detail(c,*,task_id,remote=None):
    row=c.execute('SELECT * FROM research.vault_tasks WHERE id=%s',(_uuid(task_id),)).fetchone()
    if not row:raise ValueError('Task unavailable')
    comments=[]
    if row['remote_id']:
        comments=c.execute('SELECT snapshot FROM research.vault_issue_comments WHERE repository_id=%s AND issue_id=%s ORDER BY comment_id LIMIT 100',(row['repository_id'],row['remote_id'])).fetchall()
    return dict(task=row,comments=[item['snapshot'] for item in comments],comments_coverage='Cached comments; explicit refresh fetches up to 100 at a time')


def create(c,*,request_uuid,title,body='',context_entry_id=None,context_revision=None,actor,remote=None):
    identifier=_uuid(request_uuid);title=db._text(title,'task title',300);body=db._text(body,'task body',20000,empty=True)
    value=dict(title=title,body=body,context_entry_id=context_entry_id,context_revision=context_revision,actor=actor);digest=_hash(value)
    with c.transaction():
        old=c.execute('SELECT * FROM research.vault_tasks WHERE id=%s',(identifier,)).fetchone()
        if old:
            if old['creation_sha256']!=digest:raise db.RevisionConflict(None)
            return dict(task=old,replayed=True)
        context=None
        if context_entry_id:
            note=workspace.note(c,context_entry_id)
            if not note or note['trashed'] or note['revision']!=context_revision:raise ValueError('Save this exact page version before attaching task context')
            if not codec.exclusion(note):
                encoded=codec.encode_page(note);m,b=codec.paths(note['id']);context=codec.decode_page(m,encoded[m],b,encoded[b])
        elif context_revision is not None:raise ValueError('Task context requires its page')
        c.execute('''INSERT INTO research.vault_tasks(id,creation_sha256,title,body,context_entry_id,context_revision,context_page,created_by)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',(identifier,digest,title,body,context_entry_id,context_revision,db.Jsonb(context) if context else None,actor))
        c.execute('''INSERT INTO research.vault_task_operations(id,task_id,input_sha256,kind,payload,created_by)
          VALUES(%s,%s,%s,'create',%s,%s)''',(identifier,identifier,digest,db.Jsonb(value),actor))
    return dict(task=detail(c,task_id=request_uuid)['task'],replayed=False)


def change_state(c,*,request_uuid,task_id,expected_revision,state,actor,remote=None):
    identifier=_uuid(request_uuid);task=_uuid(task_id)
    if state not in ('open','closed') or type(expected_revision) is not int or expected_revision<1:raise ValueError('Invalid task revision/state')
    payload=dict(state=state,expected_revision=expected_revision,task_id=task_id);digest=_hash(payload)
    with c.transaction():
        old=c.execute('SELECT * FROM research.vault_task_operations WHERE id=%s',(identifier,)).fetchone()
        if old:
            if old['input_sha256']!=digest:raise db.RevisionConflict(None)
            return detail(c,task_id=task_id)
        row=c.execute('SELECT * FROM research.vault_tasks WHERE id=%s FOR UPDATE',(task,)).fetchone()
        if not row or row['revision']!=expected_revision:raise db.RevisionConflict(row)
        if row['write_state']=='uncertain':raise GitHubUnavailable('Reconcile the pending issue creation before changing its state',409)
        c.execute("UPDATE research.vault_tasks SET state=%s,write_state='pending',revision=revision+1,updated_at=clock_timestamp() WHERE id=%s",(state,task))
        c.execute('''INSERT INTO research.vault_task_operations(id,task_id,input_sha256,kind,payload,created_by)
          VALUES(%s,%s,%s,'state',%s,%s)''',(identifier,task,digest,db.Jsonb(payload),actor))
    return detail(c,task_id=task_id)


def _issue(row):
    if not isinstance(row,dict) or 'pull_request' in row or type(row.get('id')) is not int or type(row.get('number')) is not int or row.get('state') not in ('open','closed'):
        raise ValueError('Not a supported GitHub issue')
    if not isinstance(row.get('title'),str) or not row['title'].strip() or len(row['title'])>300:raise ValueError('Unsupported issue title')
    if row.get('body') is not None and (not isinstance(row['body'],str) or len(row['body'])>65536):raise ValueError('Unsupported issue body')
    return row


def _cache(c,binding,issue,*,task_id=None):
    issue=_issue(issue)
    if task_id is None:
        old=c.execute('SELECT id FROM research.vault_tasks WHERE remote_id=%s',(issue['id'],)).fetchone()
        marker=re.search(r'<!-- atlas-task:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) -->',issue.get('body') or '')
        local=c.execute('SELECT id FROM research.vault_tasks WHERE id=%s AND remote_id IS NULL AND repository_id=%s',(marker[1],binding['repository_id'])).fetchone() if marker else None
        task_id=old['id'] if old else local['id'] if local else uuid.uuid4()
    c.execute('''INSERT INTO research.vault_tasks(id,creation_sha256,title,body,state,repository_id,remote_id,remote_number,remote_node_id,
      remote_snapshot,write_state,created_by) VALUES(%s,%s,%s,'',%s,%s,%s,%s,%s,%s,'synced','github-import')
      ON CONFLICT(id) DO UPDATE SET remote_snapshot=excluded.remote_snapshot,repository_id=excluded.repository_id,
      remote_id=excluded.remote_id,remote_number=excluded.remote_number,remote_node_id=excluded.remote_node_id,
      title=excluded.title,revision=research.vault_tasks.revision+CASE WHEN research.vault_tasks.remote_snapshot IS DISTINCT FROM excluded.remote_snapshot THEN 1 ELSE 0 END,updated_at=clock_timestamp()''',
      (task_id,_hash(dict(repository=binding['repository_id'],issue=issue['id'])),issue['title'],issue['state'],binding['repository_id'],issue['id'],issue['number'],issue.get('node_id',''),db.Jsonb(issue)))
    pending=c.execute("SELECT id FROM research.vault_task_operations WHERE task_id=%s AND state IN ('pending','dispatching') LIMIT 1",(task_id,)).fetchone()
    if not pending:c.execute("UPDATE research.vault_tasks SET state=%s,write_state='synced',status_note='' WHERE id=%s",(issue['state'],task_id))
    return task_id


def _issues(remote,binding):
    result=[]
    for page in range(1,11):
        rows=remote.request('repos/'+binding['repository']+f'/issues?state=all&per_page=50&page={page}')['data']
        if not isinstance(rows,list):raise GitHubUnavailable('GitHub issue coverage could not be confirmed')
        result.extend(row for row in rows if 'pull_request' not in row)
        if len(rows)<50:return result,True
    return result,False


def _context_commit(c,row):
    if not row['context_entry_id']:return None
    if not row['context_page']:raise GitHubUnavailable('Task context is not portable yet; this task stays local',409)
    match=c.execute('''SELECT p.commit_sha FROM research.vault_sync_plans p,
      LATERAL jsonb_array_elements(p.payload->'actions') a WHERE p.state='confirmed' AND p.commit_sha IS NOT NULL
      AND a->>'id'=%s AND (CASE WHEN a->>'action'='push' THEN a->'local' ELSE a->'remote' END)=%s::jsonb
      ORDER BY p.updated_at DESC LIMIT 1''',(row['context_entry_id'],db.Jsonb(row['context_page']))).fetchone()
    if not match:raise GitHubUnavailable('Sync the saved context page before sending this task',409)
    return match['commit_sha']


def _body(c,binding,row):
    commit=_context_commit(c,row);body=row['body']
    if commit:
        _,path=codec.paths(row['context_entry_id'])
        body+='\n\n[Context page](https://github.com/'+binding['repository']+'/blob/'+commit+'/'+path+')\n\nAtlas page: `'+row['context_entry_id']+'`'
    return body+'\n\n<!-- atlas-task:'+str(row['id'])+' -->'


def sync_tasks(c,*,actor,remote=None):
    """Explicit bounded dispatch. Uncertain creates only reconcile; never re-POST."""
    if not c.autocommit:raise ValueError('Tasks sync needs an operation-owned connection')
    remote=remote or NativeGitHub();binding=connection.status(c)['connection']
    if not binding:raise GitHubUnavailable('Connect a private vault first',409)
    connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
    c.execute('SELECT pg_advisory_lock(184514,173126)')
    try:
        issues,complete=_issues(remote,binding)
        operations=c.execute("SELECT * FROM research.vault_task_operations WHERE state IN ('pending','dispatching') ORDER BY created_at,id LIMIT 10").fetchall()
        results=[]
        for operation in operations:
            row=detail(c,task_id=str(operation['task_id']))['task']
            if row['repository_id'] is not None and row['repository_id']!=binding['repository_id']:raise GitHubUnavailable('Task belongs to another vault',409)
            try:
                if operation['kind']=='create':
                    if row['remote_id']:
                        with c.transaction():
                            c.execute("UPDATE research.vault_task_operations SET state='confirmed' WHERE id=%s",(operation['id'],))
                            _cache(c,binding,row['remote_snapshot'],task_id=row['id'])
                        continue
                    marker='<!-- atlas-task:'+str(row['id'])+' -->'
                    found=[issue for issue in issues if marker in (issue.get('body') or '')]
                    if len(found)>1:raise GitHubUnavailable('More than one issue matches this task; keep both for review',409)
                    if found:issue=found[0]
                    elif operation['state']=='dispatching':raise GitHubUnavailable('GitHub has not confirmed this task. No duplicate issue was created; retry reconciliation later',409)
                    else:
                        if not complete:raise GitHubUnavailable('Issue lookup is incomplete; creation paused to avoid a duplicate',409)
                        body=_body(c,binding,row)
                        with c.transaction():
                            c.execute("UPDATE research.vault_task_operations SET state='dispatching' WHERE id=%s",(operation['id'],))
                            c.execute("UPDATE research.vault_tasks SET write_state='uncertain',repository_id=%s WHERE id=%s",(binding['repository_id'],row['id']))
                        issue=remote.request('repos/'+binding['repository']+'/issues',method='POST',payload=dict(title=row['title'],body=body))['data']
                    issue=_issue(issue)
                    if marker not in (issue.get('body') or ''):raise GitHubUnavailable('GitHub did not confirm the task identity; keep it local for reconciliation',409)
                    with c.transaction():
                        c.execute("UPDATE research.vault_task_operations SET state='confirmed' WHERE id=%s",(operation['id'],))
                        _cache(c,binding,issue,task_id=row['id'])
                    issues.append(issue);results.append(dict(id=str(row['id']),state='synced'))
                else:
                    if not row['remote_number']:
                        results.append(dict(id=str(row['id']),state='pending',reason='Create the GitHub issue first'));continue
                    current=_issue(remote.request('repos/'+binding['repository']+'/issues/'+str(row['remote_number']))['data'])
                    desired=operation['payload']['state']
                    # State-only updates never replace remote title/body/comment edits.
                    if current['state']!=desired:
                        with c.transaction():c.execute("UPDATE research.vault_task_operations SET state='dispatching' WHERE id=%s",(operation['id'],))
                        current=_issue(remote.request('repos/'+binding['repository']+'/issues/'+str(row['remote_number']),method='PATCH',payload=dict(state=desired))['data'])
                    with c.transaction():
                        c.execute("UPDATE research.vault_task_operations SET state='confirmed' WHERE id=%s",(operation['id'],))
                        _cache(c,binding,current,task_id=row['id'])
                    results.append(dict(id=str(row['id']),state='synced'))
            except GitHubUnavailable as error:
                c.execute('UPDATE research.vault_tasks SET status_note=%s WHERE id=%s',(error.reason,row['id']))
                results.append(dict(id=str(row['id']),state='pending',reason=error.reason))
                if error.status in (403,429,503):break
        return dict(items=results,issue_lookup_complete=complete,more_pending=c.execute("SELECT count(*) AS n FROM research.vault_task_operations WHERE state IN ('pending','dispatching')").fetchone()['n'])
    finally:c.execute('SELECT pg_advisory_unlock(184514,173126)')


def refresh(c,*,remote=None):
    remote=remote or NativeGitHub();binding=connection.status(c)['connection']
    if not binding:raise GitHubUnavailable('Connect a private vault first',409)
    connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
    rows,complete=_issues(remote,binding)
    with c.transaction():
        for row in rows:_cache(c,binding,row)
    return dict(refreshed=len(rows),complete=complete,coverage='Up to 500 issues; missing issues are retained in the local cache')


def refresh_comments(c,*,task_id,remote=None):
    remote=remote or NativeGitHub();binding=connection.status(c)['connection'];row=detail(c,task_id=task_id)['task']
    if not binding or row['repository_id']!=binding['repository_id'] or not row['remote_number']:raise ValueError('Task has no confirmed remote issue')
    connection.verify(remote,binding['repository'],binding['branch'],binding=binding)
    comments=remote.request('repos/'+binding['repository']+'/issues/'+str(row['remote_number'])+'/comments?per_page=100')['data']
    if not isinstance(comments,list):raise GitHubUnavailable()
    with c.transaction():
        for comment in comments:
            if type(comment.get('id')) is not int or not isinstance(comment.get('body'),str) or len(comment['body'])>65536:raise ValueError('Unsupported comment')
            c.execute('''INSERT INTO research.vault_issue_comments(repository_id,issue_id,comment_id,snapshot) VALUES(%s,%s,%s,%s)
              ON CONFLICT(repository_id,issue_id,comment_id) DO UPDATE SET snapshot=excluded.snapshot''',(binding['repository_id'],row['remote_id'],comment['id'],db.Jsonb(comment)))
    return detail(c,task_id=task_id)
