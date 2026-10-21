import os
import unittest
import uuid
from islam_research import database as db,desktop_pages as pages,workspace_store as workspace


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class PageTests(unittest.TestCase):
    def setUp(self):self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
    def tearDown(self):self.c.close()
    def note(self,title=None,**patch):
        return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic '+str(uuid.uuid4()),title=title or 'Page '+str(uuid.uuid4()),actor='synthetic',**patch)
    def move(self,entry,parent=None,revision=0,request=None):
        return pages.move(self.c,request_uuid=request or str(uuid.uuid4()),entry_id=entry['id'],parent_id=parent['id'] if parent else None,expected_revision=revision,actor='synthetic')
    def test_prepared_child_first_save_recovery_and_replay_after_move(self):
        parent=self.note();request=str(uuid.uuid4())
        intent=pages.prepare_child(self.c,request_uuid=request,parent_id=parent['id'],actor='synthetic')
        self.assertTrue(pages.context(self.c,entry_id=intent['entry_id'])['pending'])
        fields=dict(request_uuid=request,body='Synthetic child body العربية 😀',actor='synthetic')
        child=workspace.create_note(self.c,**fields)
        context=pages.context(self.c,entry_id=child['id']);self.assertEqual(context['parent_id'],parent['id'])
        self.assertEqual(context['ancestors'][0]['id'],parent['id'])
        self.move(child,revision=1)
        workspace.create_note(self.c,**fields)
        self.assertIsNone(pages.context(self.c,entry_id=child['id'])['parent_id'])
        self.assertTrue(pages.prepare_child(self.c,request_uuid=request,parent_id=parent['id'],actor='synthetic')['replayed'])
        self.assertEqual(workspace.note(self.c,child['id'])['revision'],1)
    def test_cycles_self_parent_and_stale_moves_fail_without_body_mutation(self):
        a=self.note();b=self.note();d=self.note()
        self.move(b,a);self.move(d,b)
        for node,parent in [(a,d),(a,a)]:
            with self.assertRaises(db.psycopg.errors.CheckViolation):self.move(node,parent)
        request=str(uuid.uuid4());self.move(d,a,1,request)
        self.assertTrue(self.move(d,a,1,request)['replayed'])
        with self.assertRaises(db.RevisionConflict):self.move(d,b,1)
        self.assertEqual(workspace.note(self.c,d['id'])['revision'],1)
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.desktop_page_history WHERE entry_id=%s',(d['id'],)).fetchone()['n'],2)
    def test_trash_parent_does_not_cascade_and_restore_reveals_original_tree(self):
        a=self.note();b=self.note();self.move(b,a)
        workspace.trash(self.c,entry_id=a['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        context=pages.context(self.c,entry_id=b['id']);self.assertTrue(context['ancestors'][0]['unavailable'])
        roots=pages.listing(self.c,q=b['title']);self.assertIn(b['id'],[r['id'] for r in roots['items']])
        workspace.trash(self.c,entry_id=a['id'],target_revision=1,expected_revision=1,state='active',actor='synthetic')
        self.assertFalse(pages.context(self.c,entry_id=b['id'])['ancestors'][0]['unavailable'])
        self.assertNotIn(b['id'],[r['id'] for r in pages.listing(self.c,q=b['title'])['items']])
    def test_global_resolution_ambiguity_pagination_rename_and_backlinks(self):
        label='Duplicate '+str(uuid.uuid4());a=self.note(label);b=self.note(label)
        self.assertEqual(pages.resolve(self.c,target=label)['state'],'ambiguous')
        writer=self.note(links=[dict(kind='entry',id=a['id'],rationale='Markdown page link')])
        self.assertEqual(pages.backlinks(self.c,entry_id=a['id'])['items'][0]['id'],writer['id'])
        workspace.update_note(self.c,entry_id=a['id'],expected_revision=1,body=a['body'],title='Renamed '+str(uuid.uuid4()),actor='synthetic')
        self.assertEqual(pages.resolve(self.c,target=a['id'])['items'][0]['id'],a['id'])
        first=pages.listing(self.c,q=label,all_pages=True,limit=1)
        self.assertEqual(first['items'][0]['id'],b['id'])
        root=self.note();self.move(b,root)
        for _ in range(3):self.move(self.note(),root)
        one=pages.listing(self.c,parent_id=root['id'],limit=2)
        two=pages.listing(self.c,parent_id=root['id'],limit=2,cursor=one['next_cursor'])
        self.assertEqual(len({r['id'] for r in one['items']+two['items']}),4)
        workspace.trash(self.c,entry_id=writer['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        self.assertEqual(pages.backlinks(self.c,entry_id=a['id'])['items'],[])
    def test_sql_trigger_rejects_ancestor_cycles_even_without_api(self):
        a=self.note();b=self.note();self.move(b,a)
        with self.c.transaction():
            with self.assertRaises(db.psycopg.errors.CheckViolation):
                with self.c.transaction():self.c.execute('INSERT INTO research.desktop_page_positions(entry_id,parent_id,changed_by) VALUES(%s,%s,%s)',(a['id'],b['id'],'synthetic'))
    def test_depth_bound_and_moving_a_subtree_are_enforced(self):
        root=self.note();nodes=[root]
        for _ in range(32):
            child=self.note();self.move(child,nodes[-1]);nodes.append(child)
        extra=self.note()
        with self.assertRaises(db.psycopg.errors.CheckViolation):self.move(extra,nodes[-1])
        with self.assertRaises(db.psycopg.errors.CheckViolation):self.move(root,extra)
        self.assertIsNone(pages.context(self.c,entry_id=root['id'])['parent_id'])

    def test_concurrent_opposite_moves_cannot_form_a_cycle(self):
        from concurrent.futures import ThreadPoolExecutor
        a=self.note();b=self.note()
        def run(entry,parent):
            try:
                with db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']) as c:
                    pages.move(c,request_uuid=str(uuid.uuid4()),entry_id=entry['id'],parent_id=parent['id'],expected_revision=0,actor='synthetic')
                return True
            except db.psycopg.errors.CheckViolation:return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=[pool.submit(run,a,b),pool.submit(run,b,a)]
            self.assertEqual(sum(f.result(timeout=10) for f in results),1)


class PageAPITests(unittest.TestCase):
    def test_page_routes_are_desktop_only_and_owner_writes_keep_csrf(self):
        from pathlib import Path
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        from islam_research.api import create_app
        import test_api as base
        base.APIBoundaryTests.setUp(self)
        self.assertFalse(any('/desktop/page' in path for path in self.app.openapi()['paths']))
        client=TestClient(create_app(self.settings,store=base.MemoryBoundaryStore(),verifier=self.verifier,desktop_artifact_root=Path('/synthetic-private-objects')))
        value=dict(request_uuid=str(uuid.uuid4()),entry_id='synthetic:entry',parent_id=None,expected_revision=0,owner_confirmed=True)
        self.assertEqual(client.post('/v1/desktop/pages/parent',json=value).status_code,401)
        headers=base.APIBoundaryTests.headers(self)
        with patch.object(base.MemoryBoundaryStore,'page_operation',return_value={'entry_id':'synthetic:entry'},create=True) as call:
            self.assertEqual(client.post('/v1/desktop/pages/parent',json=value,headers=headers).status_code,200)
            self.assertEqual(call.call_args.kwargs['actor'],base.OWNER)
            self.assertEqual(client.post('/v1/desktop/pages/parent',json={**value,'owner_confirmed':1},headers=headers).status_code,422)
            bad={k:v for k,v in headers.items() if k!='x-research-write'}
            self.assertEqual(client.post('/v1/desktop/pages/parent',json=value,headers=bad).status_code,403)
            self.assertEqual(client.get('/v1/desktop/pages?limit=51',headers=headers).status_code,422)
