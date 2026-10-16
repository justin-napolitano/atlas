"""Real owner API regression: editorial withdrawal must disable auto-resume."""
import os
import unittest
import uuid

import test_api as boundary


@unittest.skipUnless(boundary.jwt and os.environ.get('RESEARCH_TEST_DATABASE_URL'),'Requires API extras and real PostgreSQL')
class ReadingResumeWithdrawalTests(unittest.TestCase):
    setUp=boundary.APIBoundaryTests.setUp
    headers=boundary.APIBoundaryTests.headers

    def test_withdrawn_bookmark_is_404_and_saved_library_excludes_source(self):
        from islam_research import database as db
        dsn=os.environ['RESEARCH_TEST_DATABASE_URL']
        with db.connect(dsn) as connection:db.migrate(connection)
        settings=boundary.Settings(dsn,owner_subject=boundary.OWNER,iap_audience=boundary.AUDIENCE,owner_origin=boundary.ORIGIN)
        client=boundary.TestClient(boundary.create_app(settings,verifier=self.verifier))
        project,source='test:'+uuid.uuid4().hex,'test:'+uuid.uuid4().hex
        client.post('/v1/projects',json=dict(project_id=project,title='Synthetic withdrawal project'),headers=self.headers()).raise_for_status()
        client.put('/v1/records',json=dict(project_id=project,record_id=source,kind='source',title='Synthetic withdrawal source'),headers=self.headers()).raise_for_status()
        document=client.post('/v1/reading/documents',json=dict(project_id=project,source_record_id=source,edition='Synthetic edition',locator='p. 2',text='Synthetic exact reading'),headers=self.headers()).json()
        payload=dict(project_id=project,record_id=source,document_id=document['id'],expected_revision=0)
        client.put('/v1/reading/desk',json=payload,headers=self.headers()).raise_for_status()
        self.assertEqual(client.get('/v1/reading/desk',params=dict(project_id=project),headers=self.headers()).status_code,200)
        with db.connect(dsn) as connection:
            connection.execute("UPDATE research.records SET review_state='withdrawn',revision=revision+1 WHERE id=%s",(source,))
        self.assertEqual(client.get('/v1/reading/desk',params=dict(project_id=project),headers=self.headers()).status_code,404)
        library=client.get('/v1/reading/library',params=dict(project_id=project),headers=self.headers())
        self.assertEqual(library.status_code,200,library.text)
        self.assertEqual(library.json()['items'],[])
        self.assertEqual(client.put('/v1/reading/desk',json={**payload,'expected_revision':1},headers=self.headers()).status_code,422)
        with db.connect(dsn) as connection:
            self.assertEqual(connection.execute('SELECT count(*) AS n FROM research.reading_desk_revisions WHERE project_id=%s',(project,)).fetchone()['n'],1)
