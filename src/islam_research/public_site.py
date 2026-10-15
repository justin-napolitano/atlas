"""Build a public-only site from one verified release, without database access."""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from .public_release import (
    MAX_RELEASE_BYTES, _read, _safe_root, digest, encoded, strict_json,
    utc_timestamp, verify_bundle,
)

MAX_SITE_BYTES = MAX_RELEASE_BYTES + 5_000_000
ASSET = re.compile(r"assets/[A-Za-z0-9_-]+\.(?:js|css)")
BUILD_ID = re.compile(r"build-[a-f0-9]{64}")
RUNTIME = "runtime/public-server.mjs"
CONTROL_FILES = (
    "config/public-build.json", "web/package.json", "web/package-lock.json",
    "web/scripts/build-public-frontend.mjs", "scripts/build_public_site.py",
    "src/islam_research/public_site.py", "src/islam_research/public_release.py",
    "src/islam_research/publication_contract.py", RUNTIME,
)


def policy(checkout):
    result = strict_json(_read(checkout / "config/public-build.json", 10000))
    if (set(result) != {"version", "entry", "modules", "dependency_packages"}
            or result["version"] != 1 or result["entry"] != "web/index.html"
            or not isinstance(result["modules"], list) or len(result["modules"]) > 100
            or len(set(result["modules"])) != len(result["modules"])
            or any(not re.fullmatch(r"web/(?:index\.html|src/[A-Za-z0-9_-]+\.(?:js|jsx|css))", name)
                   for name in result["modules"])
            or not {"web/index.html", "web/src/main.jsx", "web/src/style.css"} <= set(result["modules"])
            or result["dependency_packages"] != ["react", "react-dom", "scheduler"]):
        raise ValueError("Invalid public build policy")
    return result


def source_inputs(checkout):
    paths = sorted(set(CONTROL_FILES) | set(policy(checkout)["modules"]))
    return {name: {"sha256": digest(data), "bytes": len(data)}
            for name in paths for data in [_read(checkout / name, 2_000_000)]}


def _environment():
    # No application credentials, VITE_* values, NODE_OPTIONS or cloud identity
    # variables reach the compiler. This is minimization, not an OS sandbox.
    return {"PATH": os.environ.get("PATH", os.defpath), "NODE_ENV": "production", "CI": "true"}


def source_commit(checkout, inputs):
    def git(*args):
        result = subprocess.run(["git", "--no-pager", "-c", "core.fsmonitor=false", *args],
            cwd=checkout, env=_environment(), capture_output=True, timeout=30)
        if result.returncode:
            raise ValueError("Public build inputs must be tracked and unchanged in the selected commit")
        return result.stdout.decode().strip()
    git("ls-files", "--error-unmatch", "--", *inputs)
    git("diff", "--no-ext-diff", "--no-textconv", "--quiet", "HEAD", "--", *inputs)
    commit = git("rev-parse", "--verify", "HEAD")
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Invalid public source commit")
    return commit


def _externalize_theme(site):
    path = site / "index.html"
    html = _read(path, 100000).decode("utf-8")
    count = 0
    def externalize(match):
        nonlocal count
        if re.search(r"\bsrc\s*=", match[1], re.I):
            return match[0]
        if match[1].strip():
            raise ValueError("Unregistered inline public script attributes")
        count += 1
        data = match[2].encode("utf-8")
        name = "assets/theme-" + digest(data) + ".js"
        (site / name).write_bytes(data)
        return '<script src="/' + name + '"></script>'
    html = re.sub(r"<script\b([^>]*)>(.*?)</script\s*>", externalize, html, flags=re.S | re.I)
    if count != 1:
        raise ValueError("Expected the single public theme bootstrap")
    path.write_text(html, encoding="utf-8")


class _PublicHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.assets, self.in_script = set(), False

    def handle_starttag(self, tag, attrs):
        if tag not in {"html", "head", "meta", "title", "script", "link", "body", "div"}:
            raise ValueError("Unregistered public HTML element")
        values = dict(attrs)
        allowed = {"html": {"lang"}, "meta": {"charset", "name", "content"}, "title": set(),
                   "head": set(), "body": set(), "div": {"id"},
                   "script": {"src", "type", "crossorigin"}, "link": {"rel", "href", "crossorigin"}}
        if len(values) != len(attrs) or not set(values) <= allowed[tag]:
            raise ValueError("Unregistered public HTML attributes")
        if tag in {"script", "link"}:
            value = values.get("src" if tag == "script" else "href", "")
            if not value.startswith("/") or not ASSET.fullmatch(value[1:]):
                raise ValueError("External or inline public asset")
            if tag == "script" and not value.endswith(".js") or tag == "link" and values.get("rel") != "stylesheet":
                raise ValueError("Unregistered public asset kind")
            self.assets.add(value[1:])
        if tag == "script": self.in_script = True

    def handle_endtag(self, tag):
        if tag == "script": self.in_script = False

    def handle_data(self, data):
        if self.in_script and data.strip():
            raise ValueError("Inline public scripts are forbidden")


def verify_site(directory, checkout):
    directory, checkout = _safe_root(directory), _safe_root(checkout)
    manifest = strict_json(_read(directory / "build-manifest.json", 1_000_000))
    required = {"format_version", "kind", "build_id", "built_at", "source_commit", "source_inputs",
                "release_id", "release_manifest_sha256", "files", "runtime", "deployed"}
    if (not isinstance(manifest, dict) or set(manifest) != required
            or type(manifest["format_version"]) is not int or manifest["format_version"] != 1
            or manifest["kind"] != "approved_public_site" or manifest["runtime"] != "node_http_read_only_v1"
            or manifest["deployed"] is not False
            or not re.fullmatch(r"[a-f0-9]{40}", manifest["source_commit"])):
        raise ValueError("Invalid public site manifest")
    content = {key: value for key, value in manifest.items() if key != "build_id"}
    if manifest["build_id"] != "build-" + digest(encoded(content)):
        raise ValueError("Public build identity mismatch")
    utc_timestamp(manifest["built_at"])
    inputs = manifest["source_inputs"]
    registered = set(CONTROL_FILES) | set(policy(checkout)["modules"])
    if not isinstance(inputs, dict) or set(inputs) != registered:
        raise ValueError("Unregistered public source inputs")
    for info in inputs.values():
        if (not isinstance(info, dict) or set(info) != {"bytes", "sha256"} or type(info["bytes"]) is not int
                or not 0 <= info["bytes"] <= 2_000_000 or not re.fullmatch(r"[a-f0-9]{64}", info["sha256"])):
            raise ValueError("Invalid public source provenance")
    files = manifest["files"]
    if not isinstance(files, dict) or len(files) > 250:
        raise ValueError("Invalid public site file index")
    actual = set()
    for path in directory.rglob("*"):
        if path.is_symlink(): raise ValueError("Public site symlinks are forbidden")
        if path.is_file(): actual.add(path.relative_to(directory).as_posix())
    if actual != set(files) | {"build-manifest.json"}:
        raise ValueError("Unexpected or missing public site files")
    total = 0
    for name, info in files.items():
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Unsafe public site file path")
        if not (name == RUNTIME or name in {"site/index.html", "site/.public-profile.json"}
                or name.startswith("site/") and ASSET.fullmatch(name[5:]) or name.startswith("release/")):
            raise ValueError("Unregistered public site file")
        data = _read(directory / relative, MAX_SITE_BYTES)
        total += len(data)
        if total > MAX_SITE_BYTES or info != {"bytes": len(data), "sha256": digest(data)}:
            raise ValueError("Public site integrity or byte limit mismatch")
    required_files = {RUNTIME, "site/index.html", "site/.public-profile.json"}
    if not required_files <= set(files): raise ValueError("Missing public site entry points")
    release = verify_bundle(directory / "release", expected_id=manifest["release_id"])
    if digest(_read(directory / "release/release-manifest.json", 1_000_000)) != manifest["release_manifest_sha256"]:
        raise ValueError("Public site approved release mismatch")
    if {name[8:] for name in files if name.startswith("release/")} != set(release["files"]) | {"release-manifest.json"}:
        raise ValueError("Public site contains unselected release data")
    profile = strict_json(_read(directory / "site/.public-profile.json", 100000))
    if profile != {"version": 1, "modules": sorted(policy(checkout)["modules"])}:
        raise ValueError("Non-public modules entered the frontend build")
    parser = _PublicHTML()
    parser.feed(_read(directory / "site/index.html", 100000).decode("utf-8")); parser.close()
    if not parser.assets or not any(name.endswith(".js") for name in parser.assets):
        raise ValueError("Missing public scripts")
    if any("site/" + name not in files for name in parser.assets):
        raise ValueError("Missing referenced public asset")
    # Runtime bytes are part of source provenance, not an arbitrary injected server.
    if files[RUNTIME] != inputs[RUNTIME]: raise ValueError("Public runtime source/build mismatch")
    return manifest


def build_site(release_directory, output_root, checkout, *, built_at=None):
    checkout, release_directory, output_root = map(_safe_root, (checkout, release_directory, output_root))
    if output_root == release_directory or release_directory in output_root.parents:
        raise ValueError("Build output must be outside its approved release input")
    release = verify_bundle(release_directory)
    inputs = source_inputs(checkout)
    commit = source_commit(checkout, inputs)
    created = utc_timestamp(built_at or datetime.now(timezone.utc).isoformat())
    output_root.mkdir(parents=True, exist_ok=True)
    builds = output_root / "builds"
    if builds.is_symlink(): raise ValueError("Public build storage cannot be a symlink")
    builds.mkdir(exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=builds))
    pointer = None
    try:
        copied = stage / "release"; copied.mkdir()
        for name in [*release["files"], "release-manifest.json"]:
            target = copied / name; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(_read(release_directory / name, MAX_RELEASE_BYTES))
        verify_bundle(copied, expected_id=release["release_id"])
        result = subprocess.run(["node", str(checkout / "web/scripts/build-public-frontend.mjs"), str(stage / "site")],
            cwd=checkout / "web", env=_environment(), capture_output=True, timeout=120)
        if result.returncode: raise ValueError("Isolated public frontend compilation failed")
        _externalize_theme(stage / "site")
        (stage / "runtime").mkdir()
        (stage / RUNTIME).write_bytes(_read(checkout / RUNTIME, 100000))
        if source_inputs(checkout) != inputs or source_commit(checkout, inputs) != commit:
            raise ValueError("Public source inputs changed during compilation")
        records = {}
        for path in sorted(stage.rglob("*")):
            if path.is_symlink(): raise ValueError("Public build symlink")
            if path.is_file():
                data = _read(path, MAX_SITE_BYTES)
                records[path.relative_to(stage).as_posix()] = {"bytes": len(data), "sha256": digest(data)}
        manifest = {"format_version": 1, "kind": "approved_public_site", "built_at": created,
            "source_commit": commit, "source_inputs": inputs, "release_id": release["release_id"],
            "release_manifest_sha256": digest(_read(copied / "release-manifest.json", 1_000_000)),
            "files": records, "runtime": "node_http_read_only_v1", "deployed": False}
        identifier = "build-" + digest(encoded(manifest)); manifest["build_id"] = identifier
        (stage / "build-manifest.json").write_bytes(encoded(manifest))
        verify_site(stage, checkout)
        target = builds / identifier
        if target.exists():
            if verify_site(target, checkout) != manifest: raise ValueError("Immutable public build collision")
        else:
            os.rename(stage, target)
        current = output_root / "current.json"
        if current.is_symlink(): raise ValueError("Public build pointer cannot be a symlink")
        descriptor, temporary = tempfile.mkstemp(prefix=".current-", dir=output_root); pointer = Path(temporary)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(encoded({"build_id": identifier, "manifest_sha256": digest(encoded(manifest))}))
            handle.flush(); os.fsync(handle.fileno())
        os.replace(pointer, current); pointer = None
        return target, manifest
    finally:
        if stage.exists(): shutil.rmtree(stage)
        if pointer is not None: pointer.unlink(missing_ok=True)


def current_site(root, checkout):
    root = _safe_root(root)
    value = strict_json(_read(root / "current.json", 1000))
    if set(value) != {"build_id", "manifest_sha256"} or not BUILD_ID.fullmatch(value["build_id"]):
        raise ValueError("Invalid current public build pointer")
    if (root / "builds").is_symlink(): raise ValueError("Public build storage cannot be a symlink")
    directory = root / "builds" / value["build_id"]
    manifest = verify_site(directory, checkout)
    if manifest["build_id"] != value["build_id"] or digest(encoded(manifest)) != value["manifest_sha256"]:
        raise ValueError("Current public build pointer mismatch")
    return directory, manifest
