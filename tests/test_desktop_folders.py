import os
import unittest
import uuid
from islam_research import database as db,desktop_folders as folders,desktop_pages as pages,workspace_store as workspace


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires isolated PostgreSQL')
class FolderTests(unittest.TestCase):
    def setUp(self):self.c=db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']);db.migrate(self.c)
    def tearDown(self):self.c.close()
    def folder(self,parent=None,title=None):
        return folders.change(self.c,request_uuid=str(uuid.uuid4()),title=title or 'Folder '+str(uuid.uuid4()),parent_id=parent['id'] if parent else None,actor='synthetic')
    def change(self,folder,action,**patch):
        return folders.change(self.c,request_uuid=str(uuid.uuid4()),folder_id=folder['id'],expected_revision=folder['revision'],action=action,actor='synthetic',**patch)
    def note(self):return workspace.create_note(self.c,request_uuid=str(uuid.uuid4()),body='Synthetic unchanged body '+str(uuid.uuid4()),actor='synthetic')
    def test_folder_creation_is_metadata_only_and_rename_receipt_replays_after_move(self):
        before=self.c.execute('SELECT count(*) AS n FROM research.notebook_entries').fetchone()['n']
        a=self.folder();b=self.folder();request=str(uuid.uuid4())
        value=dict(request_uuid=request,folder_id=a['id'],expected_revision=1,action='rename',title='Renamed folder',actor='synthetic')
        renamed=folders.change(self.c,**value);self.change(renamed,'move',parent_id=b['id'])
        self.assertTrue(folders.change(self.c,**value)['replayed'])
        self.assertEqual(folders.active(self.c,a['id'])['parent_id'],b['id'])
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.notebook_entries').fetchone()['n'],before)
        self.assertEqual(self.c.execute('SELECT count(*) AS n FROM research.desktop_folder_history WHERE folder_id=%s',(a['id'],)).fetchone()['n'],3)
    def test_folder_page_and_root_moves_preserve_identity_body_history_and_backlinks(self):
        folder=self.folder();parent=self.note();note=self.note()
        first=pages.move(self.c,request_uuid=str(uuid.uuid4()),entry_id=note['id'],folder_id=folder['id'],expected_revision=0,actor='synthetic')
        context=pages.context(self.c,entry_id=note['id']);self.assertEqual(context['ancestors'][0]['kind'],'folder')
        self.assertIn(note['id'],[r['id'] for r in folders.tree(self.c,folder_id=folder['id'])['items']])
        self.assertNotIn(note['id'],[r['id'] for r in pages.listing(self.c)['items']])
        pages.move(self.c,request_uuid=str(uuid.uuid4()),entry_id=note['id'],parent_id=parent['id'],expected_revision=first['revision'],actor='synthetic')
        self.assertIsNone(pages.context(self.c,entry_id=note['id'])['folder_id'])
        pages.move(self.c,request_uuid=str(uuid.uuid4()),entry_id=note['id'],expected_revision=2,actor='synthetic')
        row=workspace.note(self.c,note['id']);self.assertEqual(row['revision'],1);self.assertEqual(row['body'],note['body'])
        self.assertIsNone(pages.context(self.c,entry_id=note['id'])['parent_id'])
    def test_child_intent_is_atomic_and_removed_empty_folder_falls_back_to_root(self):
        folder=self.folder();request=str(uuid.uuid4());pages.prepare_child(self.c,request_uuid=request,folder_id=folder['id'],actor='synthetic')
        note=workspace.create_note(self.c,request_uuid=request,body='Synthetic folder child',actor='synthetic')
        self.assertEqual(pages.context(self.c,entry_id=note['id'])['folder_id'],folder['id'])
        other=self.folder();request=str(uuid.uuid4());pages.prepare_child(self.c,request_uuid=request,folder_id=other['id'],actor='synthetic')
        self.change(other,'remove')
        note=workspace.create_note(self.c,request_uuid=request,body='Synthetic retained late writing',actor='synthetic')
        self.assertIsNone(pages.context(self.c,entry_id=note['id'])['folder_id'])
    def test_cycle_depth_and_stale_moves_fail(self):
        root=self.folder();child=self.folder(root)
        for target in (root,child):
            with self.assertRaises(db.psycopg.errors.CheckViolation):self.change(root,'move',parent_id=target['id'])
        self.change(child,'rename',title='Synthetic newer name')
        with self.assertRaises(db.RevisionConflict):self.change(child,'move')
        bottom=child
        for _ in range(14):bottom=self.folder(bottom)
        with self.assertRaises(db.psycopg.errors.CheckViolation):self.folder(bottom)
        outside=self.folder()
        with self.assertRaises(db.psycopg.errors.CheckViolation):self.change(root,'move',parent_id=outside['id'])
    def test_nonempty_folder_removal_never_cascades_including_trashed_notes(self):
        folder=self.folder();child=self.folder(folder)
        with self.assertRaises(db.psycopg.errors.CheckViolation):self.change(folder,'remove')
        self.change(child,'remove');note=self.note()
        pages.move(self.c,request_uuid=str(uuid.uuid4()),entry_id=note['id'],folder_id=folder['id'],expected_revision=0,actor='synthetic')
        workspace.trash(self.c,entry_id=note['id'],target_revision=1,expected_revision=0,state='trashed',actor='synthetic')
        with self.assertRaises(db.psycopg.errors.CheckViolation):self.change(folder,'remove')
        self.assertTrue(workspace.note(self.c,note['id'])['trashed'])
    def test_tree_search_pagination_and_nested_page_path(self):
        label='Folder search '+str(uuid.uuid4());a=self.folder(title=label+' A');b=self.folder(a,title=label+' B')
        request=str(uuid.uuid4());pages.prepare_child(self.c,request_uuid=request,folder_id=b['id'],actor='synthetic')
        parent=workspace.create_note(self.c,request_uuid=request,body='Synthetic parent '+label,actor='synthetic')
        note=self.note();pages.move(self.c,request_uuid=str(uuid.uuid4()),entry_id=note['id'],parent_id=parent['id'],expected_revision=0,actor='synthetic')
        self.assertEqual([r['id'] for r in pages.context(self.c,entry_id=note['id'])['ancestors']],[a['id'],b['id'],parent['id']])
        first=folders.tree(self.c,q=label,all_items=True,limit=1);self.assertEqual(first['items'][0]['id'],a['id'])
        second=folders.tree(self.c,q=label,all_items=True,limit=1,cursor=first['next_cursor']);self.assertEqual(second['items'][0]['id'],b['id'])
        self.assertIn(b['id'],[r['id'] for r in folders.tree(self.c,folder_id=a['id'])['items']])
    def test_raw_sql_enforces_cycle_and_removed_target(self):
        a=self.folder();b=self.folder(a)
        with self.assertRaises(db.psycopg.errors.CheckViolation),self.c.transaction():
            self.c.execute('UPDATE research.desktop_folders SET parent_id=%s,revision=revision+1 WHERE id=%s',(b['id'],a['id']))
        empty=self.folder();self.change(empty,'remove');note=self.note()
        with self.assertRaises(db.psycopg.errors.CheckViolation),self.c.transaction():
            self.c.execute('INSERT INTO research.desktop_page_positions(entry_id,folder_id,changed_by) VALUES(%s,%s,%s)',(note['id'],empty['id'],'synthetic'))

    def test_concurrent_opposite_folder_moves_cannot_create_cycle(self):
        from concurrent.futures import ThreadPoolExecutor
        a=self.folder();b=self.folder();self.c.commit()
        def attempt(entry,parent):
            try:
                with db.connect(os.environ['RESEARCH_TEST_DATABASE_URL']) as c:
                    folders.change(c,request_uuid=str(uuid.uuid4()),folder_id=entry['id'],parent_id=parent['id'],expected_revision=1,action='move',actor='synthetic')
                return 'moved'
            except db.psycopg.errors.CheckViolation:return 'cycle'
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda pair:attempt(*pair),[(a,b),(b,a)]))
        self.assertCountEqual(results,['moved','cycle'])


class FolderAPITests(unittest.TestCase):
    def test_desktop_only_owner_csrf_strict_confirmation_and_bounds(self):
        from pathlib import Path
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import test_api_boundary as base
        from islam_research.api import create_app
        context=base.APIBoundaryTests();context.setUp()
        headers=base.APIBoundaryTests.headers(context)
        plain=TestClient(create_app(context.settings,store=base.MemoryBoundaryStore(),verifier=context.verifier))
        self.assertEqual(plain.get('/v1/desktop/tree',headers=headers).status_code,404)
        local=TestClient(create_app(context.settings,store=base.MemoryBoundaryStore(),verifier=context.verifier,desktop_artifact_root=Path('/synthetic-private-objects')))
        value=dict(request_uuid=str(uuid.uuid4()),title='Synthetic folder',owner_confirmed=True)
        self.assertEqual(local.post('/v1/desktop/folders',json=value).status_code,401)
        with patch.object(base.MemoryBoundaryStore,'folder_operation',return_value={'id':'synthetic:folder'},create=True) as call:
            self.assertEqual(local.post('/v1/desktop/folders',json=value,headers=headers).status_code,201)
            self.assertEqual(call.call_args.kwargs['actor'],base.OWNER)
            self.assertEqual(local.post('/v1/desktop/folders',json={**value,'owner_confirmed':1},headers=headers).status_code,422)
            self.assertEqual(local.post('/v1/desktop/folders',json=value,headers={k:v for k,v in headers.items() if k!='x-research-write'}).status_code,403)
            self.assertEqual(local.get('/v1/desktop/tree?limit=51',headers=headers).status_code,422)
