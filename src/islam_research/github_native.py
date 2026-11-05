"""Desktop-only GitHub CLI bridge. Credentials never enter Atlas API responses."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


class GitHubUnavailable(Exception):
    """Sanitized, actionable failure without remote bodies, credentials or paths."""
    def __init__(self,reason='GitHub request failed; check your connection and GitHub CLI login',status=503):
        self.reason=reason;self.status=status
        super().__init__(reason)


class NativeGitHub:
    """Use the installed CLI's credential provider with a fixed host and no shell.

    V1 is a local integration requiring an installed/authenticated GitHub CLI, not
    a new bundled OAuth provider. Only trusted Python construction can inject a
    test executable; no environment switch or HTTP request may choose it.
    """
    def __init__(self,*,executable=None):
        self.executable=executable

    def request(self,path,*,method='GET',payload=None,headers=None):
        if not re.fullmatch(r'(?:graphql|user|repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_./%?=&-]+)?)',path) or '..' in path:
            raise ValueError('Unsupported GitHub API path')
        if method not in {'GET','POST','PATCH'}:raise ValueError('Unsupported GitHub method')
        executable=self.executable or next((str(p) for p in (Path('/opt/homebrew/bin/gh'),Path('/usr/local/bin/gh')) if p.is_file()),None)
        if not executable:raise GitHubUnavailable('Install GitHub CLI and sign in before connecting the vault')
        env={key:os.environ[key] for key in ('HOME','USER','LOGNAME','TMPDIR') if key in os.environ}
        env.update(PATH='/usr/bin:/bin',GH_PROMPT_DISABLED='1',GH_PAGER='cat',GH_NO_UPDATE_NOTIFIER='1',GH_NO_EXTENSION_UPDATE_NOTIFIER='1')
        args=[executable,'api','--hostname','github.com','--include','--method',method,'-H','Accept: application/vnd.github+json',path]
        for key,value in (headers or {}).items():
            if key not in {'If-Match','If-None-Match'} or not isinstance(value,str) or re.search(r'[\r\n]',value):raise ValueError('Invalid conditional header')
            args+=['-H',key+': '+value]
        data=None
        if payload is not None:
            data=json.dumps(payload,ensure_ascii=False).encode();args+=['--input','-']
            if len(data)>2_000_000:raise ValueError('GitHub request is too large')
        # Bound process lifetime and read size; redirect output to anonymous files
        # instead of buffering unbounded private responses or printing CLI stderr.
        with tempfile.TemporaryFile() as output,tempfile.TemporaryFile() as error:
            try:
                result=subprocess.run(args,input=data,stdout=output,stderr=error,env=env,timeout=25,check=False)
            except (OSError,subprocess.TimeoutExpired):raise GitHubUnavailable() from None
            size=output.tell()
            if size>8_000_000:raise GitHubUnavailable('GitHub response exceeded the supported batch size')
            output.seek(0);raw=output.read()
        head,separator,body=raw.partition(b'\r\n\r\n')
        if not separator:head,separator,body=raw.partition(b'\n\n')
        try:
            lines=head.decode('ascii').splitlines();status=int(lines[0].split()[1])
            response_headers={key.lower():value.strip() for line in lines[1:] if ':' in line for key,value in [line.split(':',1)]}
        except (UnicodeError,ValueError,IndexError):raise GitHubUnavailable() from None
        if status in (403,429) and ('retry-after' in response_headers or response_headers.get('x-ratelimit-remaining')=='0'):
            raise GitHubUnavailable('GitHub rate limit reached; wait before trying again',429)
        if status in (401,403,404):raise GitHubUnavailable('GitHub access could not be confirmed; reconnect the same private account and repository',403)
        if status==304:return dict(status=status,headers=response_headers,data=None)
        if status in (409,412,422):raise GitHubUnavailable('GitHub changed or rejected the operation; refresh before resolving it',409)
        if status<200 or status>=300:raise GitHubUnavailable()
        try:parsed=json.loads(body) if body else None
        except (UnicodeError,json.JSONDecodeError,RecursionError):raise GitHubUnavailable('GitHub returned an unsupported response') from None
        if result.returncode and not (path=='graphql' and isinstance(parsed,dict) and parsed.get('errors')):raise GitHubUnavailable()
        return dict(status=status,headers=response_headers,data=parsed)
