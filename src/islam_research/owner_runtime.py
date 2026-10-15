"""Serve a bounded, authenticated owner frontend beside the existing owner API.

The public release server never imports this module. Files are verified once at
startup and served from memory; no URL becomes a filesystem lookup.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

from .api import RequestBoundary, Settings, create_app, problem
from .api_auth import IAPVerifier, IdentityUnavailable, InvalidIdentity

MAX_ARTIFACT = 4_000_000
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "connect-src 'self'; img-src 'self' data:; font-src 'self'; "
       "base-uri 'none'; form-action 'self'; frame-ancestors 'none'")


def load_frontend(directory):
    """Reject extra files, symlinks, tampering, sourcemaps and unbounded artifacts."""
    root = Path(directory)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Owner frontend directory required")
    manifest_path = root / "owner-manifest.json"
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 100000:
        raise ValueError("Invalid owner manifest")
    manifest = json.loads(manifest_path.read_bytes())
    if (set(manifest) != {"format_version", "kind", "source_commit", "files"}
            or manifest["format_version"] != 1 or manifest["kind"] != "private_owner_frontend"
            or not re.fullmatch(r"[a-f0-9]{40}", manifest["source_commit"])
            or not isinstance(manifest["files"], dict)
            or not {"workspace.html", "publish.html"} <= manifest["files"].keys()
            or len(manifest["files"]) > 100):
        raise ValueError("Invalid owner manifest")
    content, total = {}, 0
    actual = set()
    for path in root.rglob("*"):
        if path.is_symlink(): raise ValueError("Owner frontend symlink")
        if path.is_file(): actual.add(path.relative_to(root).as_posix())
    if actual != set(manifest["files"]) | {"owner-manifest.json"}:
        raise ValueError("Unexpected owner frontend file")
    for name, expected in manifest["files"].items():
        if name not in {"workspace.html", "publish.html"} and not re.fullmatch(r"assets/[A-Za-z0-9_-]+\.(js|css)", name):
            raise ValueError("Unsupported owner frontend file")
        path = root / name
        if path.stat().st_size > MAX_ARTIFACT:
            raise ValueError("Owner frontend file too large")
        data = path.read_bytes(); total += len(data)
        if total > MAX_ARTIFACT or expected != {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}:
            raise ValueError("Owner frontend integrity mismatch")
        media = "text/html" if name.endswith(".html") else "text/css" if name.endswith(".css") else "text/javascript"
        content["/" + name] = (data, media)
    return content


class FrontendBoundary(RequestBoundary):
    """Keep API security policy intact; permit only compiled same-origin UI assets."""
    async def __call__(self, scope, receive, send):
        async def frontend_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"content-security-policy"]
                message["headers"].append((b"content-security-policy", CSP.encode()))
            await send(message)
        return await super().__call__(scope, receive, frontend_send)


def create_owner_app(settings=None, *, store=None, verifier=None, directory=None):
    """Use real IAP verification in production; injectable keys/stores are tests only."""
    settings = settings or Settings.from_env()
    if settings.mode != "owner": raise ValueError("Owner runtime requires owner mode")
    verifier = verifier or IAPVerifier(settings.iap_audience, settings.owner_subject)
    api = create_app(settings, store=store, verifier=verifier)
    files = load_frontend(directory or os.environ.get("RESEARCH_OWNER_FRONTEND", "/app/frontend"))
    frontend = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    frontend.add_middleware(FrontendBoundary, requests_per_minute=120)

    @frontend.exception_handler(HTTPException)
    async def error(request, exc):
        return problem(exc.status_code, str(exc.detail), request.state.request_id)

    def owner(request: Request):
        try:
            verifier.verify(request.headers.get("x-goog-iap-jwt-assertion", ""))
        except InvalidIdentity:
            raise HTTPException(401, "Verified owner sign-in required") from None
        except PermissionError:
            raise HTTPException(403, "Owner access required") from None
        except IdentityUnavailable:
            raise HTTPException(503, "Identity verification unavailable") from None

    @frontend.api_route("/{path:path}", methods=["GET", "HEAD"], dependencies=[Depends(owner)])
    def asset(request: Request, path: str):
        if not path:
            return RedirectResponse("/workspace.html", status_code=307)
        found = files.get("/" + path)
        if found is None: raise HTTPException(404, "Owner page not found")
        data, media = found
        return Response(b"" if request.method == "HEAD" else data, media_type=media,
                        headers={"content-length": str(len(data)), "x-robots-tag": "noindex, nofollow"})

    async def application(scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] == "lifespan" or path == "/v1" or path.startswith("/v1/") or path.startswith("/health/"):
            return await api(scope, receive, send)
        return await frontend(scope, receive, send)
    return application
