import unittest
from unittest.mock import patch
import test_api as base_api
from test_api import MemoryBoundaryStore, jwt
from islam_research import gutenberg


@unittest.skipUnless(jwt,'Install api/test extras')
class GutenbergHTTPTests(unittest.TestCase):
    setUp=base_api.APIBoundaryTests.setUp
    headers=base_api.APIBoundaryTests.headers

    def test_catalog_requires_owner_and_validated_query_without_generic_urls(self):
        with patch.object(gutenberg,'search',return_value={'items':[]}) as search:
            self.assertEqual(self.client.get('/v1/catalog/gutenberg/search?q=Plato').status_code,401)
            self.assertEqual(self.client.get('/v1/catalog/gutenberg/search?q=Plato',headers=self.headers()).status_code,200)
            self.assertEqual(search.call_count,1)
            self.assertEqual(self.client.get('/v1/catalog/gutenberg/book?project_id=synthetic&book_id=https://localhost',headers=self.headers()).status_code,422)
        with patch.object(gutenberg,'search',side_effect=gutenberg.Unavailable('Sensitive provider error')):
            response=self.client.get('/v1/catalog/gutenberg/search?q=Plato',headers=self.headers())
            self.assertEqual(response.status_code,503)
            self.assertNotIn('Sensitive',response.text)

    def test_binding_and_private_resume_reject_extra_authority_and_invalid_ranges(self):
        value=dict(project_id='synthetic',book_id=1497,version='a'*64,section=0)
        with patch.object(MemoryBoundaryStore,'gutenberg_binding',return_value={'record_id':'synthetic:book'},create=True) as binding:
            self.assertEqual(self.client.post('/v1/catalog/gutenberg/binding',json=value,headers=self.headers()).status_code,201)
            self.assertEqual(binding.call_count,1)
            self.assertEqual(self.client.post('/v1/catalog/gutenberg/binding',json={**value,'source_url':'http://127.0.0.1'},headers=self.headers()).status_code,422)
            self.assertEqual(self.client.post('/v1/catalog/gutenberg/binding',json={**value,'section':True},headers=self.headers()).status_code,422)
        response=self.client.put('/v1/catalog/gutenberg/place',json={**value,'position':-1,'expected_revision':0},headers=self.headers())
        self.assertEqual(response.status_code,422)
        headers=self.headers();headers.pop('x-research-write')
        self.assertEqual(self.client.post('/v1/catalog/gutenberg/binding',json=value,headers=headers).status_code,403)

    def test_public_runtime_has_no_catalog_authoring_routes(self):
        from fastapi.testclient import TestClient
        from islam_research.api import Settings,create_app
        with TestClient(create_app(Settings('synthetic-public-offline',mode='public'),store=MemoryBoundaryStore())) as client:
            self.assertEqual(client.get('/v1/catalog/gutenberg/search?q=Plato').status_code,404)
            self.assertEqual(client.post('/v1/catalog/gutenberg/binding',json={}).status_code,404)
