"""Offline/conflict/unknown-outcome invariants, using fresh PG and synthetic Git."""
import base64
import copy
import hashlib
import os
import unittest
import uuid

from islam_research import database as db,workspace_store as workspace,vault_format as codec,vault_sync as sync,vault_connection as connection
from islam_research.github_native import GitHubUnavailable
from test_vault_connection import FakeGitHub


class FakeVault(FakeGitHub):
    def __init__(self):
        super().__init__();self.head='a'*40;self.files={};self.snapshots={self.head:{}};self.commits=[];self.posts=0;self.lose=False;self.during_commit=None
    def external(self,patch,message='Synthetic external edit'):
        self.files.update(patch);self.head=hashlib.sha1((self.head+message+str(len(self.commits))).encode()).hexdigest()
        self.snapshots[self.head]=copy.deepcopy(self.files);self.commits.insert(0,dict(sha=self.head,commit={'message':message}))
    def request(self,path,**options):
        if path.endswith('/git/ref/heads/main'):
            self.calls.append((path,options));return dict(data={'object':{'sha':self.head}})
        if '/git/trees/' in path:
            self.calls.append((path,options));head=path.split('/git/trees/')[1].split('?')[0]
            rows=[dict(path=key,type='blob',mode='100644',size=len(value),sha=hashlib.sha1(b'blob '+str(len(value)).encode()+b'\0'+value).hexdigest()) for key,value in self.snapshots[head].items()]
            return dict(data={'truncated':False,'tree':rows})
        if '/git/blobs/' in path:
            self.calls.append((path,options));sha=path.rsplit('/',1)[1]
            for snapshot in self.snapshots.values():
                for value in snapshot.values():
                    if hashlib.sha1(b'blob '+str(len(value)).encode()+b'\0'+value).hexdigest()==sha:return dict(data={'encoding':'base64','content':base64.b64encode(value).decode()})
            raise GitHubUnavailable()
        if '/commits?' in path:self.calls.append((path,options));return dict(data=copy.deepcopy(self.commits[:30]))
        if path=='graphql':
            self.calls.append((path,options));self.posts+=1;value=options['payload']['variables']['input']
            if value['expectedHeadOid']!=self.head:raise GitHubUnavailable('Synthetic expected-head conflict',409)
            if self.during_commit:self.during_commit()
            patch={row['path']:base64.b64decode(row['contents']) for row in value['fileChanges']['additions']}
            self.external(patch,value['message']['headline'])
            if self.lose:self.lose=False;raise GitHubUnavailable('Synthetic lost response')
            return dict(data={'data':{'createCommitOnBranch':{'commit':{'oid':self.head},'clientMutationId':value['clientMutationId']}}})
        return super().request(path,**options)


class ThreeWayTests(unittest.TestCase):
    def test_no_delete_or_last_writer_wins(self):
        self.assertEqual(sync.decide('a',None,None),'push');self.assertEqual(sync.decide(None,'a',None),'pull')
        self.assertEqual(sync.decide('a','b','a'),'pull');self.assertEqual(sync.decide('b','a','a'),'push')
        self.assertEqual(sync.decide('b','c','a'),'conflict');self.assertEqual(sync.decide('a',None,'a'),'conflict')


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class VaultSyncTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c);self.c.commit();self.c.autocommit=True
        self.c.execute('DELETE FROM research.vault_sync_plans');self.c.execute('DELETE FROM research.vault_sync_pages');self.c.execute('DELETE FROM research.vault_connections')
        self.remote=FakeVault();connection.connect(self.c,repository='synthetic-owner/private-vault',branch='main',actor='synthetic',remote=self.remote)
    def tearDown(self):self.c.close()
    def note(self,body='Synthetic offline page'):
        return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body=body,actor='synthetic')
    def plan(self,row=None,**patch):
        return sync.prepare(self.c,request_uuid=str(uuid.uuid4()),entries=[] if row is None else [dict(id=row['id'],revision=row['revision'])],actor='synthetic',remote=self.remote,**patch)
    def apply(self,plan):return sync.apply(self.c,plan_id=plan['id'],actor='synthetic',remote=self.remote)
    def test_reviewed_push_remote_edit_pull_and_replay(self):
        note=self.note();plan=self.plan(note);self.assertEqual(self.remote.posts,0);self.assertEqual(plan['actions'][0]['action'],'push')
        result=self.apply(plan);self.assertEqual(result['state'],'confirmed');self.assertEqual(self.remote.posts,1)
        self.assertEqual(self.apply(plan)['commit_sha'],result['commit_sha']);self.assertEqual(self.remote.posts,1)
        manifest,body=codec.paths(note['id']);self.assertEqual(self.remote.files[body],note['body'].encode())
        self.remote.external({body:b'Synthetic edited in a Markdown editor'})
        plan=self.plan(workspace.note(self.c,note['id']));self.assertEqual(plan['actions'][0]['action'],'pull')
        self.apply(plan);self.assertEqual(workspace.note(self.c,note['id'])['body'],'Synthetic edited in a Markdown editor');self.assertEqual(self.remote.posts,1)
    def test_both_sides_changed_or_remote_moved_never_overwrite(self):
        note=self.note();self.apply(self.plan(note));_,body=codec.paths(note['id'])
        local=workspace.update_note(self.c,entry_id=note['id'],expected_revision=1,body='Synthetic local change',actor='synthetic')
        self.remote.external({body:b'Synthetic remote change'});plan=self.plan(local)
        self.assertEqual(plan['actions'][0]['action'],'conflict')
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        self.assertEqual(self.remote.files[body],b'Synthetic remote change');self.assertEqual(workspace.note(self.c,note['id'])['body'],'Synthetic local change')
        other=self.note('Synthetic second page');plan=self.plan(other);self.remote.external({'README.md':b'Synthetic unrelated remote commit'})
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        self.assertNotIn(codec.paths(other['id'])[1],self.remote.files)
    def test_lost_commit_ack_is_durable_and_reconciles_without_second_mutation(self):
        note=self.note();plan=self.plan(note);self.remote.lose=True
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        with db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']) as other:
            state=other.execute('SELECT state FROM research.vault_sync_plans WHERE id=%s',(plan['id'],)).fetchone()['state'];self.assertEqual(state,'dispatching')
        self.assertEqual(self.apply(plan)['state'],'confirmed');self.assertEqual(self.remote.posts,1)
    def test_typing_during_remote_request_survives_and_queues_next_revision(self):
        note=self.note();plan=self.plan(note)
        def newer_typing():
            with db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']) as other:
                workspace.update_note(other,entry_id=note['id'],expected_revision=1,body='Synthetic newer local writing',actor='synthetic')
        self.remote.during_commit=newer_typing
        self.assertEqual(self.apply(plan)['state'],'confirmed')
        current=workspace.note(self.c,note['id']);self.assertEqual(current['body'],'Synthetic newer local writing')
        pending=self.c.execute('SELECT dirty_revision,confirmed_revision FROM research.vault_sync_pages WHERE entry_id=%s',(note['id'],)).fetchone()
        self.assertEqual(pending['dirty_revision'],2);self.assertEqual(pending['confirmed_revision'],1)
        self.remote.during_commit=None;self.assertEqual(self.plan(current)['actions'][0]['action'],'push')
    def test_new_remote_page_import_and_missing_link_selection(self):
        identifier=codec.PREFIX+str(uuid.uuid4());page=dict(id=identifier,title='Synthetic remote page',title_mode='manual',body='Synthetic remote content محفوظ',thought_type='skill',state='active',links=[])
        self.remote.external(codec.encode_page(page));plan=self.plan(include_remote=True);self.assertEqual(plan['actions'][0]['action'],'pull')
        self.apply(plan);self.assertEqual(workspace.note(self.c,identifier)['body'],page['body'])
        target=self.note('Synthetic dependency');writer=self.note('Synthetic writer')
        writer=workspace.update_note(self.c,entry_id=writer['id'],expected_revision=1,body=writer['body'],links=[dict(kind='entry',id=target['id'],rationale='Markdown page link')],actor='synthetic')
        plan=self.plan(writer);self.assertEqual(plan['actions'][0]['action'],'conflict')
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
