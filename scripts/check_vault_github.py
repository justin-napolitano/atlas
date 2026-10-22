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
    from islam_research import database as db,workspace_store as workspace,vault_connection as connection,vault_sync as sync,vault_format as codec
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
                    branch=dict(repositoryNameWithOwner=args.repository,refName='main'),expectedHeadOid=pushed['commit_sha'],
                    message=dict(headline='Synthetic external Markdown edit'),fileChanges=dict(additions=[dict(path=body,contents=base64.b64encode(external_body).decode())]))))
                response=remote.request('graphql',method='POST',payload=payload)['data'];assert not response.get('errors')
                plan=sync.prepare(c,request_uuid=str(uuid.uuid4()),entries=[dict(id=note['id'],revision=1)],actor='synthetic:integration',remote=remote)
                assert plan['actions'][0]['action']=='pull'
                assert sync.apply(c,plan_id=plan['id'],actor='synthetic:integration',remote=remote)['state']=='confirmed'
                assert workspace.note(c,note['id'])['body'].encode()==external_body
                print(json.dumps(dict(real_github=True,private_fixture_only=True,atomic_commit=True,replay=True,external_markdown_pull=True,exact_unicode=True,owner_data_accessed=False)))
        finally:subprocess.run([str(binary/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,stdout=subprocess.DEVNULL)


if __name__=='__main__':main()
