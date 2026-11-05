import os
import unittest

import test_api as boundary


class TrashBoundaryTests(unittest.TestCase):
    setUp=boundary.APIBoundaryTests.setUp
    headers=boundary.APIBoundaryTests.headers

    def test_owner_origin_strict_target_and_public_absence(self):
        class Store(boundary.MemoryBoundaryStore):
            def private_trash(self,*args):return []
            def change_private_trash(self,**values):return {**values,'revision':1}
        client=boundary.TestClient(boundary.create_app(self.settings,store=Store(),verifier=self.verifier))
        value=dict(project_id='synthetic:project',target_kind='entry',target_id='synthetic:entry',target_revision=1,expected_revision=0,state='trashed')
        response=client.put('/v1/writing/trash',json=value,headers=self.headers());self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['actor'],boundary.OWNER)
        self.assertEqual(client.put('/v1/writing/trash',json=value).status_code,401)
        self.assertEqual(client.put('/v1/writing/trash',json=value,headers=self.headers(sub='other')).status_code,403)
        self.assertEqual(client.put('/v1/writing/trash',json=value,headers=self.headers(origin='https://other.invalid')).status_code,403)
        for patch in [dict(actor='forged'),dict(state='purged'),dict(target_kind='claim'),dict(expected_revision=-1)]:
            self.assertEqual(client.put('/v1/writing/trash',json={**value,**patch},headers=self.headers()).status_code,422)
        self.assertIn('no-store',client.get('/v1/writing/trash',params=dict(project_id='synthetic'),headers=self.headers()).headers['cache-control'])
        public=boundary.TestClient(boundary.create_app(boundary.Settings('synthetic',mode='public'),store=Store()))
        self.assertEqual(public.get('/v1/writing/trash').status_code,404)
        self.assertEqual(public.put('/v1/writing/trash',json=value).status_code,404)


@unittest.skipUnless(os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires real isolated PostgreSQL')
class TrashStoreTests(unittest.TestCase):
    from test_notebook import NotebookStoreTests as Setup
    setUpClass=classmethod(Setup.setUpClass.__func__)
    tearDownClass=classmethod(Setup.tearDownClass.__func__)
    setUp=Setup.setUp

    def test_notebook_trash_restore_preserves_identity_links_and_rejects_late_edits(self):
        from islam_research import private_trash as trash,research_search
        with self.db.connect(self.owner_dsn) as connection:
            saved=self.store.create(connection,**self.values)
            value=dict(project_id=self.project,target_kind='entry',target_id=saved['id'],target_revision=1,expected_revision=0,state='trashed',actor='owner')
            first=trash.change(connection,**value);self.assertEqual(first,trash.change(connection,**value))
            self.assertTrue(self.store.get(connection,self.project,saved['id'])['trashed'])
            self.assertEqual(self.store.items(connection,self.project,'','','active','',25,item_scope='writing'),[])
            self.assertEqual(self.store.network(connection,self.project,25),[])
            self.assertFalse(any(row['id']==saved['id'] for row in research_search.search(connection,self.project,'running')['items']))
            with self.assertRaises(ValueError):self.store.update(connection,project_id=self.project,entry_id=saved['id'],expected_revision=1,thought_type='question',title='Late title',body='Late body',links=[],state='active',actor='owner')
            restored=trash.change(connection,**{**value,'expected_revision':1,'state':'active'})
            self.assertEqual(restored['revision'],2)
            row=self.store.get(connection,self.project,saved['id']);self.assertFalse(row['trashed'])
            self.assertEqual(row['body'],self.values['body']);self.assertEqual(row['annotation_id'],self.annotation['id']);self.assertEqual(row['revision'],1)
            self.assertEqual(len(self.store.history(connection,self.project,saved['id'],None,25)),1)
            self.assertEqual(trash.listing(connection,self.project),[])

    def test_margin_trash_filters_default_views_but_preserves_exact_anchor(self):
        from islam_research import private_trash as trash
        from psycopg.errors import CheckViolation,InsufficientPrivilege
        value=dict(project_id=self.project,target_kind='annotation',target_id=self.annotation['id'],target_revision=1,expected_revision=0,state='trashed',actor='owner')
        with self.db.connect(self.owner_dsn) as connection:
            first=trash.change(connection,**value)
            self.assertEqual(self.passages.annotations(connection,self.project,self.document['id'],'',25),[])
            bundle=self.passages.annotation(connection,self.project,self.annotation['id']);self.assertTrue(bundle['anchor']['anchored'])
            self.assertEqual(bundle['annotation']['body'],'Original passage notebook marker')
            self.assertEqual(trash.listing(connection,self.project)[0]['document_id'],self.document['id'])
            self.assertEqual(trash.listing(connection,'foreign'),[])
            with self.assertRaises(ValueError):self.passages.update_annotation(connection,annotation_id=self.annotation['id'],project_id=self.project,body='Late overwrite',expected_revision=1,actor='owner')
            with self.assertRaises(CheckViolation):
                with connection.transaction():connection.execute('UPDATE research.reading_annotations SET body=%s,revision=revision+1 WHERE id=%s',('Late SQL edit',self.annotation['id']))
            with self.assertRaises(InsufficientPrivilege):
                with connection.transaction():connection.execute('DELETE FROM research.note_trash')
            with self.assertRaises(InsufficientPrivilege):
                with connection.transaction():connection.execute("UPDATE research.note_trash_revisions SET snapshot='{}'")
        with self.db.connect(self.publisher_dsn) as connection:
            for table in ['note_trash','note_trash_revisions']:
                with self.assertRaises(InsufficientPrivilege):
                    with connection.transaction():connection.execute('SELECT * FROM research.'+table)
        with self.db.connect(self.owner_dsn) as other:
            self.assertEqual(trash.listing(other,self.project)[0]['revision'],first['revision'])
            with self.assertRaises(self.db.RevisionConflict):trash.change(other,**{**value,'target_revision':99})
            with self.assertRaises(ValueError):trash.change(other,**{**value,'project_id':'foreign'})
            trash.change(other,**{**value,'expected_revision':1,'state':'active'})
            self.assertEqual(self.passages.annotations(other,self.project,self.document['id'],'',25)[0]['id'],self.annotation['id'])
