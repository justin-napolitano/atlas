import hashlib
import json
from pathlib import Path
import secrets
import tempfile
import unittest

from fastapi.testclient import TestClient
from islam_research.api import Settings, create_app
from islam_research.local_owner import LocalOwner, COOKIE


class Store:
    def ready(self, mode): return True
    def projects(self): return []
    def create_project(self, **value): return value


class LocalOwnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        files={'workspace.html':b'<html>Workspace</html>','publish.html':b'<html>Publication</html>'}
        for name,data in files.items():(self.root/name).write_bytes(data)
        (self.root/'owner-manifest.json').write_text(json.dumps({'format_version':1,
            'kind':'private_owner_frontend','source_commit':'a'*40,
            'files':{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in files.items()}}))
        self.keys={key:secrets.token_urlsafe(48) for key in ('launch','session')}
        self.app=LocalOwner(database_url='synthetic',directory=self.root,port=5187,credentials=self.keys,store=Store())
        self.origin='http://127.0.0.1:5187'
        self.client=TestClient(self.app,base_url=self.origin,client=('127.0.0.1',50000),follow_redirects=False)
        self.write={'origin':self.origin,'x-research-write':'1'}

    def tearDown(self):self.tmp.cleanup()
    def login(self):return self.client.post('/local/session',json={'token':self.keys['launch']},headers=self.write)

    def test_browser_headers_and_unsigned_requests_cannot_authorize(self):
        self.assertEqual(self.client.get('/v1/projects').status_code,401)
        self.assertEqual(self.client.get('/workspace.html').status_code,303)
        self.assertEqual(self.client.get('/v1/projects',headers={'x-goog-iap-jwt-assertion':self.keys['session']}).status_code,401)
        self.assertEqual(self.client.post('/local/session',json={'token':'incorrect'},headers=self.write).status_code,401)
        response=self.login();self.assertEqual(response.status_code,200)
        cookie=response.headers['set-cookie']
        self.assertIn('HttpOnly',cookie);self.assertIn('SameSite=strict',cookie)
        self.assertNotIn(self.keys['launch'],response.text)
        self.assertEqual(self.client.get('/v1/projects').status_code,200)
        self.assertEqual(self.client.get('/workspace.html').content,b'<html>Workspace</html>')

    def test_external_hosts_peers_and_cross_origin_writes_fail_closed(self):
        self.login()
        self.assertEqual(self.client.get('/v1/projects',headers={'host':'attacker.invalid'}).status_code,403)
        self.assertEqual(self.client.get('/v1/projects',headers={'sec-fetch-site':'cross-site'}).status_code,403)
        remote=TestClient(self.app,base_url=self.origin,client=('192.0.2.1',50000))
        self.assertEqual(remote.get('/v1/projects',headers={'cookie':COOKIE+'='+self.keys['session']}).status_code,403)
        for headers in ({},{'origin':'https://attacker.invalid','x-research-write':'1'},{'origin':self.origin}):
            self.assertEqual(self.client.post('/v1/projects',json={'project_id':'synthetic','title':'Synthetic'},headers=headers).status_code,403)
        self.assertEqual(self.client.post('/v1/projects',json={'project_id':'synthetic','title':'Synthetic'},headers=self.write).status_code,201)

    def test_private_session_survives_an_application_restart(self):
        self.login()
        restarted=LocalOwner(database_url='synthetic',directory=self.root,port=5187,credentials=self.keys,store=Store())
        client=TestClient(restarted,base_url=self.origin,client=('127.0.0.1',50000))
        self.assertEqual(client.get('/v1/projects',headers={'cookie':COOKIE+'='+self.keys['session']}).status_code,200)

    def test_production_authentication_does_not_accept_local_session(self):
        production=TestClient(create_app(Settings('synthetic',owner_subject='owner',iap_audience='/projects/123',owner_origin='https://owner.example.invalid'),store=Store()))
        self.assertEqual(production.get('/v1/projects',headers={'cookie':COOKIE+'='+self.keys['session']}).status_code,401)
        with self.assertRaises(ValueError):Settings('synthetic',owner_subject='owner',iap_audience='/projects/123',owner_origin=self.origin)

    def test_launch_is_bounded_and_secret_not_reflected(self):
        for value in ({'token':self.keys['launch'],'extra':'not allowed'}, {'token':'x'*1100}, {'token':123}):
            response=self.client.post('/local/session',json=value,headers=self.write)
            self.assertEqual(response.status_code,401)
            self.assertNotIn(self.keys['launch'],response.text)
        self.assertEqual(self.client.get('/local/login').headers['cache-control'],'no-store')
        self.assertNotIn(self.keys['launch'],self.client.get('/local/login.js').text)

    def test_repeated_launch_attempts_are_rate_limited(self):
        for _ in range(30):
            self.assertEqual(self.client.post('/local/session',json={'token':'incorrect'},headers=self.write).status_code,401)
        self.assertEqual(self.login().status_code,429)
