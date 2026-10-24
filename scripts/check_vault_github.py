"""Opt-in real GitHub protocol check, restricted to a dedicated synthetic repository.

Creates synthetic files/commits only. Never reads the owner's database or vault.
The caller creates and subsequently archives the private fixture repository.
"""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'src'))


def main():
    from psycopg.conninfo import make_conninfo
    from islam_research import database as db,workspace_store as workspace,vault_connection as connection,vault_sync as sync,vault_format as codec,vault_tasks as tasks
    from islam_research.github_native import NativeGitHub,GitHubUnavailable
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repository',required=True)
    args=parser.parse_args()
    owner,name=args.repository.split('/',1)
    if not name.startswith('atlas-vault-sync-fixture-'):raise ValueError('Use a dedicated synthetic fixture repository')
    binary=ROOT/'research-library/desktop-resources/postgres/bin'
    with tempfile.TemporaryDirectory(prefix='atlas-real-vault-',dir='/private/tmp') as temp:
        root=Path(temp);socket=root/'socket';socket.mkdir(mode=0o700);data=root/'pg'
        subprocess.run([str(binary/'initdb'),'-D',str(data),'-A','trust','--no-locale','-E','UTF8'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        subprocess.run([str(binary/'pg_ctl'),'-D',str(data),'-l',str(root/'pg.log'),'-o',f"-k {socket} -p 55442 -c listen_addresses=''",'-w','start'],check=True,stdout=subprocess.DEVNULL)
        try:
            with db.connect(make_conninfo(host=str(socket),port=55442,dbname='postgres')) as c:
                db.migrate(c);c.commit();c.autocommit=True;remote=NativeGitHub()
                connection.connect(c,repository=args.repository,branch='main',actor='synthetic:integration',remote=remote)
                note=workspace.create_note(c,request_uuid=str(uuid.uuid4()),body='# Synthetic GitHub fixture\n\nSynthetic محفوظ 😀',actor='synthetic:integration')
                plan=sync.prepare(c,request_uuid=str(uuid.uuid4()),entries=[dict(id=note['id'],revision=1)],actor='synthetic:integration',remote=remote)
                pushed=sync.apply(c,plan_id=plan['id'],actor='synthetic:integration',remote=remote);assert pushed['state']=='confirmed'
                assert sync.apply(c,plan_id=plan['id'],actor='synthetic:integration',remote=remote)['commit_sha']==pushed['commit_sha']
                _,body=codec.paths(note['id']);external_body=b'# Synthetic external editor\n\nSynthetic Markdown edit only.'
                payload=dict(query=sync.COMMIT_MUTATION,variables=dict(input=dict(clientMutationId=str(uuid.uuid4()),
                    branch=dict(repositoryNameWithOwner=args.repository,branchName='main'),expectedHeadOid=pushed['commit_sha'],
                    message=dict(headline='Synthetic external Markdown edit'),fileChanges=dict(additions=[dict(path=body,contents=base64.b64encode(external_body).decode())]))))
                response=remote.request('graphql',method='POST',payload=payload)['data'];assert not response.get('errors')
                plan=sync.prepare(c,request_uuid=str(uuid.uuid4()),entries=[dict(id=note['id'],revision=1)],actor='synthetic:integration',remote=remote)
                assert plan['actions'][0]['action']=='conflict'
                assert workspace.note(c,note['id'])['body']==note['body']
                recovery=sync.restore_preview(c,backup_id=pushed['id'],commit_sha=pushed['commit_sha'],remote=remote)
                assert recovery['read_only'] and recovery['restored']==0 and recovery['items'][0]['action']=='matches'
                # Use a separate private synthetic issue, never the actual vault.
                task=tasks.create(c,request_uuid=str(uuid.uuid4()),title='Synthetic Atlas task protocol',body='Synthetic fixture only محفوظ',actor='synthetic:integration')['task']
                first=tasks.sync_tasks(c,actor='synthetic:integration',remote=remote);assert first['more_pending']==0
                confirmed=tasks.detail(c,task_id=str(task['id']))['task'];assert confirmed['remote_number']
                tasks.sync_tasks(c,actor='synthetic:integration',remote=remote)
                comment=remote.request('repos/'+args.repository+'/issues/'+str(confirmed['remote_number'])+'/comments',method='POST',payload=dict(body='Synthetic issue comment backup fixture'))['data']
                cached=tasks.refresh_comments(c,task_id=str(task['id']),remote=remote);assert any(row['id']==comment['id'] for row in cached['comments'])
                tasks.change_state(c,request_uuid=str(uuid.uuid4()),task_id=str(task['id']),expected_revision=confirmed['revision'],state='closed',actor='synthetic:integration')
                assert tasks.sync_tasks(c,actor='synthetic:integration',remote=remote)['more_pending']==0
                assert tasks.detail(c,task_id=str(task['id']))['task']['remote_snapshot']['state']=='closed'
                print(json.dumps(dict(real_github=True,issue_create_and_replay=True,state_only_update=True,comment_cache=True,private_fixture_only=True,atomic_commit=True,replay=True,remote_edit_preserved=True,read_only_recovery=True,exact_unicode=True,owner_data_accessed=False)))
        finally:subprocess.run([str(binary/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)


if __name__=='__main__':main()
