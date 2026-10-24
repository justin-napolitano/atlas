"""Private-vault boundaries using synthetic API responses and isolated PostgreSQL."""
import copy
import json
import os
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import uuid

from islam_research import database as db,workspace_store as workspace,notebook,vault_connection as vault
from islam_research.github_native import NativeGitHub,GitHubUnavailable


class FakeGitHub:
    def __init__(self):self.calls=[];self.private=True;self.account=17;self.repo_id=81;self.push=True
    def request(self,path,**options):
        self.calls.append((path,options));assert options.get('method','GET')=='GET','Connection slice must not mutate GitHub'
        if path=='user':value=dict(id=self.account,login='synthetic-owner')
        elif path=='repos/synthetic-owner/private-vault':value=dict(id=self.repo_id,full_name='synthetic-owner/private-vault',private=self.private,owner={'id':17},permissions={'push':self.push})
        elif path=='repos/synthetic-owner/private-vault/git/ref/heads/main':value={'object':{'sha':'a'*40}}
        else:raise GitHubUnavailable('Synthetic access failure',403)
        return dict(status=200,headers={},data=value)


class NativeBridgeTests(unittest.TestCase):
    def test_fixed_host_sanitized_environment_and_bounded_errors(self):
        seen=[]
        def run(args,**kwargs):
            seen.append((args,kwargs));kwargs['stdout'].write(b'HTTP/2.0 200 OK\r\nETag: "synthetic"\r\n\r\n{"id":17}')
            return subprocess.CompletedProcess(args,0)
        with patch('islam_research.github_native.subprocess.run',side_effect=run),patch.dict(os.environ,{'GH_TOKEN':'synthetic-token-not-to-forward','GH_HOST':'untrusted.invalid'}):
            row=NativeGitHub(executable='/synthetic/gh').request('user')
        self.assertEqual(row['data']['id'],17);self.assertEqual(row['headers']['etag'],'"synthetic"')
        args,kwargs=seen[0];self.assertIn('github.com',args);self.assertNotIn('GH_TOKEN',kwargs['env']);self.assertNotIn('GH_HOST',kwargs['env']);self.assertNotIn('shell',kwargs)
        def denied(args,**kwargs):
            kwargs['stdout'].write(b'HTTP/2.0 404 Not Found\r\n\r\n{"message":"synthetic private context"}')
            kwargs['stderr'].write(b'synthetic-secret');return subprocess.CompletedProcess(args,1)
        with patch('islam_research.github_native.subprocess.run',side_effect=denied),self.assertRaises(GitHubUnavailable) as error:NativeGitHub(executable='/synthetic/gh').request('user')
        self.assertNotIn('synthetic-secret',str(error.exception));self.assertNotIn('private context',str(error.exception));self.assertEqual(error.exception.status,403)
        for path in ['https://untrusted.invalid/','repos/a/b/../../secret','user\n--hostname=untrusted.invalid']:
            with self.assertRaises(ValueError):NativeGitHub(executable='/synthetic/gh').request(path)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class ConnectionTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c);self.remote=FakeGitHub()
        # A separate fresh database runner owns these synthetic connection rows.
        self.c.execute('DELETE FROM research.vault_connections')
    def tearDown(self):self.c.close()
    def connect(self):return vault.connect(self.c,repository='synthetic-owner/private-vault',branch='main',actor='synthetic',remote=self.remote)
    def test_connect_repeat_and_preview_do_not_upload_or_change_notes(self):
        row=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic connection preview محفوظ 😀',actor='synthetic')
        connected=self.connect();self.assertEqual(connected['connection']['repository_id'],81);self.assertFalse(connected['sync_enabled'])
        self.assertEqual(self.connect()['connection']['revision'],1)
        preview=vault.preview(self.c,remote=self.remote,limit=50)
        item=next(item for item in preview['items'] if item['id']==row['id']);self.assertTrue(item['eligible']);self.assertNotIn('body',item)
        self.assertEqual(preview['uploaded'],0);self.assertTrue(preview['uploads_enabled'])
        self.assertEqual(workspace.note(self.c,row['id'])['revision'],1);self.assertTrue(all(not options for _,options in self.remote.calls))
        self.remote.private=False
        with self.assertRaises(GitHubUnavailable):vault.preview(self.c,remote=self.remote)
        self.remote.private=True;self.remote.account=99
        with self.assertRaises(GitHubUnavailable):vault.preview(self.c,remote=self.remote)
        self.assertEqual(vault.status(self.c)['connection']['account_id'],17)
    def test_rebinding_and_public_or_read_only_repositories_fail_closed(self):
        self.remote.private=False
        with self.assertRaises(GitHubUnavailable):self.connect()
        self.assertIsNone(vault.status(self.c)['connection'])
        self.remote.private=True;self.remote.push=False
        with self.assertRaises(GitHubUnavailable):self.connect()
        self.remote.push=True;self.connect();self.remote.repo_id=82
        with self.assertRaises(GitHubUnavailable):self.connect()
        with self.assertRaises(GitHubUnavailable):vault.connect(self.c,repository='different/repo',branch='main',actor='synthetic',remote=self.remote)
    def test_legacy_source_and_frontmatter_disagreement_are_explicit(self):
        project='synthetic:vault:'+uuid.uuid4().hex;db.create_project(self.c,project,'Synthetic legacy')
        legacy=notebook.create(self.c,project_id=project,request_uuid=str(uuid.uuid4()),thought_type='note',title='Synthetic legacy',body='Needs its original context',links=[],actor='synthetic')
        mismatch=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='---\ntype: skill\n---\nSynthetic mismatched role',actor='synthetic')
        self.connect();page=vault.preview(self.c,remote=self.remote,limit=50);rows={item['id']:item for item in page['items']}
        self.assertFalse(rows[legacy['id']]['eligible']);self.assertIn('Legacy',rows[legacy['id']]['reason'])
        self.assertFalse(rows[mismatch['id']]['eligible']);self.assertIn('reconciliation',rows[mismatch['id']]['reason'])


class VaultAPITests(unittest.TestCase):
    def test_only_trusted_desktop_registration_exposes_owner_protected_routes(self):
        import test_api as base
        from fastapi.testclient import TestClient
        from islam_research.api import create_app,Settings
        base.APIBoundaryTests.setUp(self)
        for mode in ('owner','public'):
            app=create_app(self.settings if mode=='owner' else Settings('synthetic',mode='public'),store=base.MemoryBoundaryStore(),verifier=self.verifier)
            with TestClient(app) as client:
                for path in ('/v1/desktop/vault','/v1/desktop/tasks','/v1/desktop/vault/backups','/v1/desktop/vault/restore-preview?backup_id='+str(uuid.uuid4())):
                    self.assertEqual(client.get(path,headers=base.APIBoundaryTests.headers(self)).status_code,404)
        app=create_app(self.settings,store=base.MemoryBoundaryStore(),verifier=self.verifier,desktop_artifact_root=Path('/synthetic/objects'),desktop_github=FakeGitHub())
        with TestClient(app) as client:
            value=dict(repository='synthetic-owner/private-vault',owner_confirmed=True)
            self.assertEqual(client.post('/v1/desktop/vault/connect',json=value).status_code,401)
            headers=base.APIBoundaryTests.headers(self);missing={key:value for key,value in headers.items() if key!='x-research-write'}
            self.assertEqual(client.post('/v1/desktop/vault/connect',headers=missing,json=value).status_code,403)
            with patch.object(base.MemoryBoundaryStore,'vault_operation',return_value={'connection':None},create=True) as call:
                self.assertEqual(client.post('/v1/desktop/vault/connect',headers=headers,json=value).status_code,200)
                self.assertEqual(call.call_args.kwargs['actor'],base.OWNER)
                self.assertEqual(client.post('/v1/desktop/vault/connect',headers=headers,json={**value,'token':'synthetic'}).status_code,422)
                self.assertEqual(client.get('/v1/desktop/vault/preview?limit=51',headers=headers).status_code,422)
                self.assertEqual(client.get('/v1/desktop/vault/backups').status_code,401)
                self.assertEqual(client.get('/v1/desktop/vault/backups?limit=11',headers=headers).status_code,422)
                self.assertEqual(client.get('/v1/desktop/vault/backups',headers=headers).status_code,200)
                self.assertEqual(call.call_args.args[0],'backups')
                backup_id=str(uuid.uuid4())
                self.assertEqual(client.get('/v1/desktop/vault/restore-preview?backup_id='+backup_id).status_code,401)
                self.assertEqual(client.get('/v1/desktop/vault/restore-preview?backup_id=invalid',headers=headers).status_code,422)
                self.assertEqual(client.get('/v1/desktop/vault/restore-preview?backup_id='+backup_id+'&commit_sha=invalid',headers=headers).status_code,422)
                self.assertEqual(client.get('/v1/desktop/vault/restore-preview?backup_id='+backup_id,headers=headers).status_code,200)
                self.assertEqual(call.call_args.args[0],'restore_preview')

                task=dict(request_uuid=str(uuid.uuid4()),title='Synthetic API task',owner_confirmed=True)
                self.assertEqual(client.post('/v1/desktop/tasks',json=task).status_code,401)
                self.assertEqual(client.post('/v1/desktop/tasks',headers=missing,json=task).status_code,403)
                self.assertEqual(client.post('/v1/desktop/tasks',headers=headers,json=task).status_code,200)
                self.assertEqual(call.call_args.args[0],'task_create')
                self.assertEqual(client.post('/v1/desktop/tasks',headers=headers,json={**task,'repository':'other/private'}).status_code,422)
