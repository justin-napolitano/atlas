import unittest
from unittest.mock import patch
import test_api as base_api
from test_api import MemoryBoundaryStore,jwt


@unittest.skipUnless(jwt,'Install api/test extras')
class SharedLibraryHTTPTests(unittest.TestCase):
    setUp=base_api.APIBoundaryTests.setUp
    headers=base_api.APIBoundaryTests.headers

    def test_owner_only_reads_and_bounded_membership_context(self):
        for path in ['/library/items','/library/item?item_id=synthetic:item','/library/notes?item_id=synthetic:item','/library/resolve?item_id=synthetic:item&document_id=synthetic:doc']:
            with self.subTest(path=path):self.assertEqual(self.client.get('/v1'+path).status_code,401)
        with patch.object(MemoryBoundaryStore,'library_items',return_value=[{'id':'synthetic:1'},{'id':'synthetic:2'}],create=True) as query:
            row=self.client.get('/v1/library/items?limit=1&project_id=synthetic:project',headers=self.headers())
            self.assertEqual(row.status_code,200);self.assertEqual(row.json()['next_cursor'],'synthetic:1')
            self.assertEqual(query.call_args.kwargs['project_id'],'synthetic:project')
            self.assertEqual(query.call_args.kwargs['limit'],2)
        self.assertEqual(self.client.get('/v1/library/items?limit=100',headers=self.headers()).status_code,422)
        with patch.object(MemoryBoundaryStore,'library_item',return_value=None,create=True):
            self.assertEqual(self.client.get('/v1/library/item?item_id=synthetic:item&project_id=synthetic:removed',headers=self.headers()).status_code,404)

    def test_exact_origin_resolver_and_note_cursor_keep_old_id_fields(self):
        target=dict(project_id='synthetic:origin',record_id='synthetic:source',document_id='synthetic:doc',text_sha256='a'*64)
        with patch.object(MemoryBoundaryStore,'library_resolve',return_value=target,create=True) as resolver:
            row=self.client.get('/v1/library/resolve?item_id=synthetic:item&document_id=synthetic:doc&project_id=synthetic:second',headers=self.headers())
            self.assertEqual(row.json(),target)
            self.assertEqual(resolver.call_args.kwargs['project_id'],'synthetic:second')
        with patch.object(MemoryBoundaryStore,'library_notes',return_value=[{'id':'legacy-note','note_key':'entry:legacy-note'},{'id':'another','note_key':'entry:another'}],create=True):
            row=self.client.get('/v1/library/notes?item_id=synthetic:item&limit=1',headers=self.headers())
            self.assertEqual(row.json()['items'][0]['id'],'legacy-note')
            self.assertEqual(row.json()['next_cursor'],'entry:legacy-note')

    def test_writes_require_confirmation_strict_revisions_and_csrf_without_privilege_fields(self):
        item=dict(item_id='synthetic:item',expected_revision=1,on_shelf=True,reading_status='want_to_read',preferred_edition_id=None,owner_confirmed=True)
        with patch.object(MemoryBoundaryStore,'library_update_item',return_value={'id':'synthetic:item','revision':2},create=True) as save:
            self.assertEqual(self.client.put('/v1/library/item',json=item,headers=self.headers()).status_code,200)
            self.assertEqual(save.call_args.kwargs['actor'],base_api.OWNER)
            for patch_value in [{'expected_revision':True},{'on_shelf':1},{'owner_confirmed':False},{'reading_status':'reviewed'},{'review_state':'reviewed'},{'owner':'different'}]:
                self.assertEqual(self.client.put('/v1/library/item',json={**item,**patch_value},headers=self.headers()).status_code,422)
        headers=self.headers();headers.pop('x-research-write')
        self.assertEqual(self.client.put('/v1/library/item',json=item,headers=headers).status_code,403)
        membership=dict(item_id='synthetic:item',project_id='synthetic:second',state='legacy',expected_revision=0,owner_confirmed=True)
        self.assertEqual(self.client.put('/v1/library/project-membership',json=membership,headers=self.headers()).status_code,422)

    def test_no_library_routes_or_schema_in_public_mode(self):
        from fastapi.testclient import TestClient
        from islam_research.api import Settings,create_app
        app=create_app(Settings('synthetic-public-offline',mode='public'),store=MemoryBoundaryStore())
        with TestClient(app) as client:
            for method,path in [('GET','/v1/library/items'),('GET','/v1/library/notes?item_id=synthetic:item'),('POST','/v1/library/index-source'),('PUT','/v1/library/project-membership')]:
                self.assertEqual(client.request(method,path).status_code,404)
        self.assertFalse(any('/library/' in route for route in app.openapi()['paths']))
