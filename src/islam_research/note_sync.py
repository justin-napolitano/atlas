"""Explicit, revision-aware private Markdown transfer through the owner API."""
from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .note_format import content, digest, parse_note, render_note


class SyncProblem(Exception):
    def __init__(self, status=503, current=None):
        super().__init__("Owner API access failed; check origin, identity configuration, and connectivity")
        self.status, self.current = status, current


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, target):
        # Never forward owner credentials to a redirected URL or sign-in page.
        return None


class OwnerHTTP:
    def __init__(self, origin, token, *, opener=None):
        parsed = urlsplit(origin)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
            raise ValueError("Configure one HTTPS owner origin without path or credentials")
        if not token or len(token) > 16384 or any(ord(c) < 33 or ord(c) > 126 for c in token):
            raise ValueError("Configure a short-lived IAP ID token outside the vault")
        self.origin, self._token = origin.rstrip("/"), token
        self.opener = opener or build_opener(NoRedirect())

    def request(self, path, params=None, value=None):
        if path not in {"record", "personal-state", "personal-states"}:
            raise ValueError("Unsupported note operation")
        payload = json.dumps(value, ensure_ascii=False).encode() if value is not None else None
        request = Request(self.origin+"/v1/"+path+"?"+urlencode(params or {}), data=payload,
                          method="PUT" if payload is not None else "GET",
                          headers={"Authorization": "Bearer "+self._token, "Accept": "application/json",
                                   **({"Content-Type": "application/json", "X-Research-Write": "1"} if payload is not None else {})})
        try:
            with self.opener.open(request, timeout=20) as response:
                if "json" not in response.headers.get("Content-Type", ""):
                    raise SyncProblem(401)
                body = response.read(4_000_001)
                if len(body) > 4_000_000:
                    raise SyncProblem(502)
                return json.loads(body)
        except HTTPError as error:
            current = None
            if error.code == 409:
                try:
                    raw = error.read(65537)
                    if len(raw) <= 65536:
                        current = json.loads(raw).get("current")
                except (ValueError, AttributeError):
                    pass
            error.close()
            raise SyncProblem(error.code, current) from None
        except (URLError, TimeoutError, ValueError):
            raise SyncProblem() from None


def _read(path):
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError("Refusing a symlinked note path")
    if path.stat().st_size > 65536:
        raise ValueError("Note document exceeds 64 KiB")
    text = path.read_text(encoding="utf-8")
    return text, parse_note(text)


def _write(path, text, expected):
    """Atomic write, detecting changed preimages and retaining an explicit backup."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise ValueError("Refusing a symlinked note path")
    if expected is None:
        if path.exists():
            raise ValueError("A note appeared while preparing the write; retry")
    elif not path.exists() or path.read_text(encoding="utf-8") != expected:
        raise ValueError("Note changed during sync; retry without discarding it")
    handle, temporary = tempfile.mkstemp(prefix=".research-sync-", dir=path.parent)
    try:
        with os.fdopen(handle,"w",encoding="utf-8",newline="\n") as stream:
            stream.write(text); stream.flush(); os.fsync(stream.fileno())
        if expected is not None and path.read_text(encoding="utf-8") != expected:
            raise ValueError("Note changed during sync; retry")
        if expected is None:
            # Atomic creation must not replace a file that appeared after our check.
            os.link(temporary,path)
        else:
            os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _preserve(path, text, label):
    suffix = digest({"text": text})[:16]
    backup = path.with_name(path.stem+f".research-{label}-{suffix}.md")
    if not backup.exists():
        _write(backup, text, None)
    elif backup.read_text(encoding="utf-8") != text:
        raise ValueError("Preserved note filename collision; no file overwritten")
    return backup.name


def transfer(api, path: Path, direction: str, *, apply=False, record_id=None, project_id=None,
             resolution=None, expected_remote_revision=None):
    """Transfer one note. Renames/moves work because identity is in frontmatter.

    Dry-run is the default. Conflicts never auto-push; explicit resolution is
    conditioned on the exact cloud revision the owner inspected.
    """
    if direction not in {"pull", "push"} or resolution not in {None, "cloud", "draft"}:
        raise ValueError("Invalid transfer operation")
    path = Path(os.path.abspath(path))
    text, document = _read(path) if path.exists() else (None, None)
    if document:
        target = document["state"]
        if (record_id and record_id != target["record_id"]) or (project_id and project_id != target["project_id"]):
            raise ValueError("Explicit target differs from note identity")
        record_id, project_id = target["record_id"], target["project_id"]
    elif direction != "pull" or not record_id or not project_id:
        raise ValueError("An initial pull needs an exact record and project ID")
    record = api.request("record", {"record_id": record_id})
    if record["id"] != record_id or record["project_id"] != project_id:
        raise ValueError("Record is not in the selected project")
    if record.get("deleted_at"):
        # A record tombstone must not destroy offline notes or propagate a delete.
        return {"status": "record_removed", "applied": False, "local_note_retained": True}
    try:
        remote = api.request("personal-state", {"project_id": project_id, "record_id": record_id})
    except SyncProblem as error:
        if error.status != 404:
            raise
        remote = {"record_id": record_id, "project_id": project_id, "revision": 0,
                  "reading": "unread", "decision": "unreviewed", "note": ""}
    if remote["record_id"] != record_id or remote["project_id"] != project_id:
        raise ValueError("Owner API returned a different personal-state identity")
    remote_text = render_note(record, remote)
    result = {"status": "unchanged", "applied": False, "remote_revision": remote["revision"]}
    if resolution is not None:
        if type(expected_remote_revision) is not int or expected_remote_revision != remote["revision"]:
            raise ValueError("Resolve only the exact cloud revision you inspected")
        if not document:
            raise ValueError("There is no local draft to resolve")
        direction = "pull" if resolution == "cloud" else "push"
    if document and digest(content(target)) == digest(content(remote)):
        if text != remote_text:
            result["status"] = "base_refreshed"
            if apply:
                _write(path, remote_text, text); result["applied"] = True
        return result
    conflicted = bool(document and document["locally_changed"] and
                      (remote["revision"] != document["metadata"]["base_revision"] or
                       digest(content(remote)) != document["metadata"]["base_sha256"]))
    if conflicted and resolution is None:
        result["status"] = "conflict"
        if apply:
            result["cloud_copy"] = _preserve(path,remote_text,"cloud")
        return result
    if direction == "pull":
        if document and document["locally_changed"] and resolution is None:
            return {**result,"status":"local_changes_pending"}
        result["status"] = "pull_ready"
        if apply:
            if text is not None and text != remote_text:
                result["previous_copy"] = _preserve(path,text,"previous")
            _write(path,remote_text,text); result["applied"] = True
        return result
    if not document["locally_changed"] and resolution is None:
        return {**result,"status":"cloud_changes_pending"}
    result["status"] = "push_ready"
    if apply:
        expected = expected_remote_revision if resolution == "draft" else document["metadata"]["base_revision"]
        try:
            saved = api.request("personal-states", value={**target,"expected_revision":expected})
        except SyncProblem as error:
            if error.status != 409 or error.current is None:
                raise
            # A writer may change the state after our initial read; preserve both.
            return {**result,"status":"conflict","cloud_copy":_preserve(path,render_note(record,error.current),"cloud")}
        result["previous_copy"] = _preserve(path,text,"previous")
        _write(path,render_note(record,saved),text)
        result.update(applied=True,remote_revision=saved["revision"])
    return result
