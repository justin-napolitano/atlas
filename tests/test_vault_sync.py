"""Offline/conflict/unknown-outcome invariants, using fresh PG and synthetic Git."""
import base64
import copy
import hashlib
import json
import os
import unittest
import uuid
from urllib.parse import urlsplit,parse_qs

from islam_research import database as db,workspace_store as workspace,vault_format as codec,vault_sync as sync,vault_connection as connection
from islam_research.github_native import GitHubUnavailable
from test_vault_connection import FakeGitHub


class FakeVault(FakeGitHub):
    def __init__(self):
        super().__init__();self.head='a'*40;self.files={};self.snapshots={self.head:{}};self.commits=[];self.posts=0;self.lose=False;self.during_commit=None
    def external(self,patch,message='Synthetic external edit'):
        self.files.update(patch);self.head=hashlib.sha1((self.head+message+str(len(self.commits))).encode()).hexdigest()
        self.snapshots[self.head]=copy.deepcopy(self.files);self.commits.insert(0,dict(sha=self.head,commit={'message':message},paths=list(patch)))
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
        if '/commits?' in path:
            self.calls.append((path,options));query=parse_qs(urlsplit(path).query);rows=self.commits
            if query.get('sha',[None])[0] in self.snapshots:
                head=query['sha'][0];offset=next((i for i,row in enumerate(rows) if row['sha']==head),len(rows));rows=rows[offset:]
            if query.get('path'):rows=[row for row in rows if query['path'][0] in row.get('paths',[])]
            return dict(data=copy.deepcopy(rows[:int(query.get('per_page',['30'])[0])]))
        if path=='graphql':
            self.calls.append((path,options));self.posts+=1;value=options['payload']['variables']['input']
            assert set(value['branch'])=={'repositoryNameWithOwner','branchName'}
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

    def test_invalid_blob_shapes_are_sanitized_before_decoding(self):
        from unittest.mock import Mock
        raw=b'Synthetic exact bytes';sha=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        item=dict(type='blob',mode='100644',size=len(raw),sha=sha)
        for malformed in (None,[],{'encoding':'base64','content':3}):
            with self.subTest(malformed=malformed):
                remote=Mock();remote.request.return_value={'data':malformed}
                with self.assertRaises(GitHubUnavailable):sync._read_file(remote,{'repository':'synthetic-owner/private-vault'},item,100)


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
    def test_reviewed_backup_remote_edit_never_replaces_app_and_replay(self):
        note=self.note();plan=self.plan(note);self.assertEqual(self.remote.posts,0);self.assertEqual(plan['actions'][0]['action'],'push')
        result=self.apply(plan);self.assertEqual(result['state'],'confirmed');self.assertEqual(self.remote.posts,1)
        self.assertEqual(self.apply(plan)['commit_sha'],result['commit_sha']);self.assertEqual(self.remote.posts,1)
        manifest,body=codec.paths(note['id']);self.assertEqual(self.remote.files[body],note['body'].encode())
        self.remote.external({body:b'Synthetic edited in a Markdown editor'})
        plan=self.plan(workspace.note(self.c,note['id']));self.assertEqual(plan['actions'][0]['action'],'conflict')
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        self.assertEqual(workspace.note(self.c,note['id'])['body'],note['body']);self.assertEqual(self.remote.posts,1)
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
        self.remote.external(codec.encode_page(page))
        with self.assertRaises(ValueError):self.plan(include_remote=True)
        self.assertIsNone(workspace.note(self.c,identifier))
        target=self.note('Synthetic dependency');writer=self.note('Synthetic writer')
        writer=workspace.update_note(self.c,entry_id=writer['id'],expected_revision=1,body=writer['body'],links=[dict(kind='entry',id=target['id'],rationale='Markdown page link')],actor='synthetic')
        plan=self.plan(writer);self.assertEqual(plan['actions'][0]['action'],'conflict')
        with self.assertRaises(GitHubUnavailable):self.apply(plan)

    def test_receipt_recovery_preview_preserves_newer_writing_and_uses_historical_commit(self):
        from islam_research import vault_receipt
        note=self.note('Synthetic first snapshot محفوظ 😀');first=self.apply(self.plan(note))
        self.assertTrue(first['receipt_verified']);self.assertEqual(first['coverage']['pages'][0]['application_revision'],1)
        current=workspace.update_note(self.c,entry_id=note['id'],expected_revision=1,body='Synthetic newer text',actor='synthetic')
        second=self.apply(self.plan(current));self.assertNotEqual(first['commit_sha'],second['commit_sha'])
        posts=self.remote.posts
        preview=sync.restore_preview(self.c,backup_id=first['id'],remote=self.remote)
        self.assertTrue(preview['read_only']);self.assertEqual(preview['restored'],0)
        self.assertEqual(preview['commit_sha'],first['commit_sha']);self.assertEqual(preview['items'][0]['action'],'conflict')
        self.assertEqual(workspace.note(self.c,note['id'])['body'],current['body']);self.assertEqual(self.remote.posts,posts)
        listing=sync.backups(self.c,remote=self.remote);self.assertIn(first['id'],[item['id'] for item in listing['items']])
        self.assertIn(vault_receipt.path(first['id']),self.remote.files)

    def test_fresh_database_recovery_preview_reports_new_pages_without_creating_them(self):
        from psycopg import sql
        from psycopg.conninfo import make_conninfo
        note=self.note('Synthetic recovery محفوظ 😀');confirmed=self.apply(self.plan(note))
        name='atlas_backup_restore_'+uuid.uuid4().hex
        self.c.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
        try:
            with db.connect(make_conninfo(os.environ['RESEARCH_TEST_DATABASE_URL'],dbname=name)) as destination:
                db.migrate(destination);destination.commit();destination.autocommit=True
                connection.connect(destination,repository='synthetic-owner/private-vault',branch='main',actor='synthetic',remote=self.remote)
                before=destination.execute('SELECT count(*) AS n FROM research.notebook_entries').fetchone()['n']
                preview=sync.restore_preview(destination,backup_id=confirmed['id'],commit_sha=confirmed['commit_sha'],remote=self.remote)
                self.assertEqual(preview['items'][0]['action'],'would_create');self.assertEqual(preview['restored'],0)
                self.assertEqual(destination.execute('SELECT count(*) AS n FROM research.notebook_entries').fetchone()['n'],before)
                # A separately explicit, existing codec import proves the exported identity/body.
                inventory=sync._snapshot(self.remote,connection.status(destination)['connection'],confirmed['commit_sha'])
                recovered=sync._remote_page(self.remote,connection.status(destination)['connection'],inventory,note['id'])
                codec.import_new_pages(destination,[recovered],actor='synthetic')
                self.assertEqual(workspace.note(destination,note['id'])['body'],note['body'])
                self.assertEqual(sync.restore_preview(destination,backup_id=confirmed['id'],commit_sha=confirmed['commit_sha'],remote=self.remote)['items'][0]['action'],'matches')
        finally:self.c.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))

    def test_receipt_digest_rejects_modified_snapshot_before_any_import(self):
        from islam_research import vault_receipt
        note=self.note();confirmed=self.apply(self.plan(note));_,body=codec.paths(note['id'])
        self.remote.external({body:b'Synthetic tampered snapshot'})
        with self.assertRaises(GitHubUnavailable):sync.restore_preview(self.c,backup_id=confirmed['id'],commit_sha=self.remote.head,remote=self.remote)
        self.assertEqual(workspace.note(self.c,note['id'])['body'],note['body'])

    def test_matching_remote_metadata_formatting_receives_exact_export_coverage(self):
        note=self.note();self.apply(self.plan(note));metadata,_=codec.paths(note['id'])
        self.remote.external({metadata:json.dumps(json.loads(self.remote.files[metadata]),indent=4).encode()})
        plan=self.plan(note);self.assertEqual(plan['actions'][0]['action'],'unchanged')
        result=self.apply(plan);self.assertTrue(result['receipt_verified'])
        self.assertEqual(sync.restore_preview(self.c,backup_id=result['id'],remote=self.remote)['items'][0]['action'],'matches')

    def test_exclusions_are_reported_and_no_all_excluded_backup_is_confirmed(self):
        from islam_research import notebook
        project='synthetic:excluded:'+uuid.uuid4().hex;db.create_project(self.c,project,'Synthetic excluded')
        legacy=notebook.create(self.c,project_id=project,request_uuid=str(uuid.uuid4()),thought_type='note',title='Synthetic legacy',body='Synthetic legacy content',links=[],actor='synthetic')
        plan=self.plan(legacy);self.assertIsNone(plan['coverage'])
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        note=self.note();plan=sync.prepare(self.c,request_uuid=str(uuid.uuid4()),entries=[dict(id=x['id'],revision=x['revision']) for x in [note,legacy]],actor='synthetic',remote=self.remote)
        result=self.apply(plan);self.assertEqual(result['coverage']['covered_count'],1);self.assertEqual(result['coverage']['selected_count'],2)
        self.assertEqual(result['coverage']['excluded'][0]['id'],legacy['id'])

    def test_recovery_preview_blocks_dependencies_outside_snapshot(self):
        target=self.note('Synthetic link target');self.apply(self.plan(target))
        note=self.note();note=workspace.update_note(self.c,entry_id=note['id'],expected_revision=1,body=note['body'],links=[dict(kind='entry',id=target['id'],rationale='Synthetic link')],actor='synthetic')
        result=self.apply(self.plan(note))
        from unittest.mock import patch
        original=workspace.note
        with patch.object(workspace,'note',side_effect=lambda c,identifier:None if identifier==target['id'] else original(c,identifier)):
            preview=sync.restore_preview(self.c,backup_id=result['id'],remote=self.remote)
        self.assertEqual(preview['items'][0]['action'],'blocked');self.assertIn('linked page',preview['items'][0]['reason'])

    def test_legacy_preview_cannot_import_and_inflight_push_can_reconcile_without_receipt(self):
        note=self.note();plan=self.plan(note)
        self.c.execute("UPDATE research.vault_sync_plans SET payload=payload-'mode'-'receipt' WHERE id=%s",(plan['id'],))
        with self.assertRaises(GitHubUnavailable):self.apply(plan)
        self.assertEqual(self.remote.posts,0)
        # An old already-dispatched push may have reached GitHub before upgrade.
        self.c.execute("UPDATE research.vault_sync_plans SET state='dispatching' WHERE id=%s",(plan['id'],))
        row=self.c.execute('SELECT * FROM research.vault_sync_plans WHERE id=%s',(plan['id'],)).fetchone()
        sync._commit(self.remote,connection.status(self.c)['connection'],row)
        result=self.apply(plan)
        self.assertEqual(result['state'],'confirmed');self.assertFalse(result['receipt_verified']);self.assertEqual(self.remote.posts,1)
        self.assertEqual(workspace.note(self.c,note['id'])['body'],note['body'])
        other=self.note('Synthetic legacy pull');blocked=self.plan(other)
        self.c.execute("""UPDATE research.vault_sync_plans SET state='dispatching',
            payload=jsonb_set(payload-'mode'-'receipt','{actions,0,action}','\"pull\"') WHERE id=%s""",(blocked['id'],))
        with self.assertRaises(GitHubUnavailable):self.apply(blocked)
        self.assertEqual(self.remote.posts,1)
        self.assertEqual(sync.get_plan(self.c,plan_id=blocked['id'])['state'],'conflict')
        self.assertEqual(self.plan(other)['state'],'prepared')
