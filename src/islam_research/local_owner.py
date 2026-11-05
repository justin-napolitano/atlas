"""Explicit loopback-only development host; production IAP entrypoints are unchanged.

An OS-private launch credential opens an HttpOnly local session. The adapter checks
the actual browser origin before dispatching to the unchanged owner API. It never
accepts browser-supplied IAP headers or exposes a database credential to JavaScript.
"""
from __future__ import annotations

import asyncio
from collections import deque
import time
from http.cookies import SimpleCookie, CookieError
import json
import secrets

from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from .api import Settings
from .api_auth import InvalidIdentity
from .owner_runtime import create_owner_app

COOKIE = 'atlas_local_owner'
LOGIN_JS = b'''const token=location.hash.slice(1);history.replaceState(null,'','/local/login');
if(token)fetch('/local/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Research-Write':'1'},body:JSON.stringify({token})}).then(r=>{if(!r.ok)throw Error();location.replace('/workspace.html')}).catch(()=>{document.querySelector('p').textContent='Local sign-in failed. Open the workspace using its local launcher.';});'''


class LocalVerifier:
    def __init__(self, token): self.token = token

    def verify(self, token):
        if not isinstance(token, str) or not secrets.compare_digest(token, self.token):
            raise InvalidIdentity('Local session required')
        return 'local-owner'


class LocalOwner:
    def __init__(self, *, database_url, directory, port, credentials, store=None,desktop_artifact_root=None,desktop_github=None):
        if type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError('Invalid local port')
        if set(credentials) != {'launch', 'session'} or any(
                not isinstance(v, str) or not v.isascii() or len(v) < 43 for v in credentials.values()):
            raise ValueError('Private local credentials required')
        self.origin = f'http://127.0.0.1:{port}'
        self.host = f'127.0.0.1:{port}'
        self.credentials = credentials
        self.storage = 'local_sqlite' if database_url.startswith('sqlite:') else 'local_postgresql'
        self.launch_attempts = deque()
        # Settings' HTTPS requirement remains intact for every production entrypoint.
        # Only this local gate translates a separately verified loopback origin.
        self.settings = Settings(database_url, owner_subject='local-owner',
            iap_audience='/projects/local-development-only',
            owner_origin=f'https://127.0.0.1:{port}')
        self.application = create_owner_app(self.settings, store=store,
            verifier=LocalVerifier(credentials['session']), directory=directory,desktop_artifact_root=desktop_artifact_root,desktop_github=desktop_github)

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'lifespan':
            return await self.application(scope, receive, send)
        if scope['type'] != 'http': return
        headers = {k.decode('latin1').lower(): v.decode('latin1') for k,v in scope['headers']}
        peer = (scope.get('client') or ('',0))[0]
        same_site = headers.get('sec-fetch-site') not in {'cross-site'}
        if (peer not in {'127.0.0.1','::1'} or scope.get('scheme') != 'http'
                or headers.get('host') != self.host or not same_site):
            return await self.reply(JSONResponse({'detail':'Local workspace only'},403), scope, receive, send)
        write = scope['method'] not in {'GET','HEAD','OPTIONS'}
        if write and (headers.get('origin') != self.origin or headers.get('x-research-write') != '1'):
            return await self.reply(JSONResponse({'detail':'Local origin and explicit write required'},403),scope,receive,send)
        path = scope['path']
        if path == '/local/login' and scope['method'] == 'GET':
            return await self.reply(HTMLResponse('<!doctype html><meta name="viewport" content="width=device-width"><title>Open local Atlas</title><p>Open the workspace using its local launcher.</p><script src="/local/login.js"></script>'),scope,receive,send)
        if path == '/local/login.js' and scope['method'] == 'GET':
            return await self.reply(Response(LOGIN_JS,media_type='text/javascript'),scope,receive,send)
        if path == '/local/session' and scope['method'] == 'POST':
            now=time.monotonic()
            while self.launch_attempts and self.launch_attempts[0]<now-60:self.launch_attempts.popleft()
            if len(self.launch_attempts)>=30:
                return await self.reply(JSONResponse({'detail':'Retry local sign-in shortly'},429),scope,receive,send)
            self.launch_attempts.append(now)
            if headers.get('content-type','').split(';')[0] != 'application/json':
                return await self.reply(JSONResponse({'detail':'JSON required'},415),scope,receive,send)
            try:
                body = b''
                while True:
                    message = await asyncio.wait_for(receive(),5)
                    if message['type'] != 'http.request': raise ValueError()
                    body += message.get('body',b'')
                    if len(body)>1024: raise ValueError()
                    if not message.get('more_body'): break
                value = json.loads(body)
                valid = (isinstance(value,dict) and set(value)=={'token'}
                    and isinstance(value['token'],str)
                    and secrets.compare_digest(value['token'],self.credentials['launch']))
            except (ValueError,TypeError,asyncio.TimeoutError): valid = False
            if not valid:
                return await self.reply(JSONResponse({'detail':'Local launch credential required'},401),scope,receive,send)
            response = JSONResponse({'authenticated':True,'storage':self.storage})
            response.set_cookie(COOKIE,self.credentials['session'],httponly=True,
                samesite='strict',max_age=2592000,path='/')
            return await self.reply(response,scope,receive,send)
        try:
            cookie = SimpleCookie();cookie.load(headers.get('cookie',''))
            token = cookie[COOKIE].value if COOKIE in cookie else ''
        except CookieError: token = ''
        if not token.isascii() or not secrets.compare_digest(token,self.credentials['session']):
            response = JSONResponse({'detail':'Local owner sign-in required'},401) if path.startswith('/v1/') else RedirectResponse('/local/login',303)
            return await self.reply(response,scope,receive,send)
        # Trust derives from the verified local session, never an incoming identity header.
        copied = dict(scope)
        copied['headers'] = [(k,v) for k,v in scope['headers'] if k.lower() not in {
            b'x-goog-iap-jwt-assertion',b'x-goog-authenticated-user-email',b'origin'}]
        copied['headers'].append((b'x-goog-iap-jwt-assertion',self.credentials['session'].encode()))
        if write: copied['headers'].append((b'origin',self.settings.owner_origin.encode()))
        return await self.application(copied,receive,send)

    @staticmethod
    async def reply(response,scope,receive,send):
        response.headers.update({'cache-control':'no-store','x-content-type-options':'nosniff',
            'x-frame-options':'DENY','referrer-policy':'no-referrer',
            'content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"})
        return await response(scope,receive,send)
