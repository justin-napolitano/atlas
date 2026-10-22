"""Task capture/replay/network-loss proof against isolated synthetic PostgreSQL."""
import copy
import os
import unittest
import uuid
from islam_research import database as db,workspace_store as workspace,vault_tasks as tasks,vault_connection as connection,vault_sync as sync
from islam_research.github_native import GitHubUnavailable
from test_vault_sync import FakeVault

class FakeIssues(FakeVault):
    def __init__(self):super().__init__();self.issues=[];self.issue_posts=0;self.lose_issue=False;self.comments=[]
    def request(self,path,**options):
        method=options.get('method','GET')
        if '/issues' in path:
            self.calls.append((path,options))
            if '/comments' in path:return dict(data=copy.deepcopy(self.comments))
            if '?' in path:return dict(data=copy.deepcopy(self.issues))
            if path.endswith('/issues') and method=='POST':
                self.issue_posts+=1;value=options['payload'];issue=dict(id=1000+self.issue_posts,number=self.issue_posts,node_id='synthetic',state='open',title=value['title'],body=value['body'])
                self.issues.append(issue)
                if self.lose_issue:self.lose_issue=False;raise GitHubUnavailable('Synthetic response lost')
                return dict(data=copy.deepcopy(issue))
            issue=next(row for row in self.issues if row['number']==int(path.rsplit('/',1)[1]))
            if method=='PATCH':
                assert set(options['payload'])=={'state'};issue.update(options['payload'])
            return dict(data=copy.deepcopy(issue))
        return super().request(path,**options)

@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class TaskTests(unittest.TestCase):
    def setUp(self):
        self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c);self.c.commit();self.c.autocommit=True
        for table in ['vault_issue_comments','vault_task_operations','vault_tasks','vault_sync_plans','vault_sync_pages','vault_connections']:self.c.execute('DELETE FROM research.'+table)
        self.remote=FakeIssues()
    def tearDown(self):self.c.close()
    def connect(self):connection.connect(self.c,repository='synthetic-owner/private-vault',branch='main',actor='synthetic',remote=self.remote)
    def create(self,**kwargs):return tasks.create(self.c,request_uuid=str(uuid.uuid4()),title='Synthetic task',actor='synthetic',**kwargs)['task']
    def test_offline_capture_exact_replay_restart_and_state_cas(self):
        identifier=str(uuid.uuid4());value=dict(request_uuid=identifier,title='Synthetic محفوظ',body='# Evidence',actor='synthetic')
        first=tasks.create(self.c,**value);self.assertTrue(tasks.create(self.c,**value)['replayed']);self.assertFalse(self.remote.calls)
        with db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']) as other:self.assertEqual(tasks.detail(other,task_id=identifier)['task']['body'],'# Evidence')
        with self.assertRaises(db.RevisionConflict):tasks.create(self.c,**{**value,'title':'Different'})
        update=dict(request_uuid=str(uuid.uuid4()),task_id=identifier,expected_revision=1,state='closed',actor='synthetic')
        self.assertEqual(tasks.change_state(self.c,**update)['task']['revision'],2)
        self.assertEqual(tasks.change_state(self.c,**update)['task']['revision'],2)
        with self.assertRaises(db.RevisionConflict):tasks.change_state(self.c,**{**update,'request_uuid':str(uuid.uuid4())})
    def test_lost_ack_refresh_marker_reconciliation_never_creates_duplicate(self):
        row=self.create();self.connect();self.remote.lose_issue=True
        result=tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote);self.assertEqual(result['more_pending'],1)
        self.assertEqual(tasks.detail(self.c,task_id=str(row['id']))['task']['write_state'],'uncertain')
        tasks.refresh(self.c,remote=self.remote)
        self.assertEqual(len(tasks.listing(self.c)['items']),1)
        tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote)
        self.assertEqual(self.remote.issue_posts,1);self.assertEqual(tasks.detail(self.c,task_id=str(row['id']))['task']['write_state'],'synced')
        tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote);self.assertEqual(self.remote.issue_posts,1)
    def test_unknown_create_without_marker_never_reposts(self):
        row=self.create();self.connect();self.remote.lose_issue=True;tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote)
        self.remote.issues=[];tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote);self.assertEqual(self.remote.issue_posts,1)
        self.assertEqual(tasks.detail(self.c,task_id=str(row['id']))['task']['write_state'],'uncertain')
    def test_exact_context_commit_and_remote_body_comments_remain_authoritative(self):
        note=workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic context',actor='synthetic');row=self.create(context_entry_id=note['id'],context_revision=1)
        self.connect();tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote);self.assertEqual(self.remote.issue_posts,0)
        plan=sync.prepare(self.c,request_uuid=str(uuid.uuid4()),entries=[dict(id=note['id'],revision=1)],actor='synthetic',remote=self.remote)
        result=sync.apply(self.c,plan_id=plan['id'],actor='synthetic',remote=self.remote)
        tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote);self.assertEqual(self.remote.issue_posts,1);self.assertIn('/blob/'+result['commit_sha']+'/',self.remote.issues[0]['body'])
        self.remote.issues[0]['body']='Synthetic external changes';tasks.refresh(self.c,remote=self.remote)
        current=tasks.detail(self.c,task_id=str(row['id']))['task'];self.assertEqual(len(tasks.listing(self.c,q='external changes')['items']),1)
        tasks.change_state(self.c,request_uuid=str(uuid.uuid4()),task_id=str(row['id']),expected_revision=current['revision'],state='closed',actor='synthetic')
        tasks.sync_tasks(self.c,actor='synthetic',remote=self.remote)
        self.assertEqual(self.remote.issues[0]['body'],'Synthetic external changes');self.assertEqual(self.remote.issues[0]['state'],'closed')
        self.remote.comments=[dict(id=2001,body='Synthetic **comment**',user={'login':'synthetic'})]
        self.assertEqual(tasks.refresh_comments(self.c,task_id=str(row['id']),remote=self.remote)['comments'][0]['body'],'Synthetic **comment**')
