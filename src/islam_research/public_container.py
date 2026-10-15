"""Assemble a minimal verified Docker context; never invoke Docker or a cloud API."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import tempfile

from .public_release import _read, _safe_root, digest, encoded, strict_json
from .public_site import MAX_SITE_BYTES, verify_site

DOCKERIGNORE = b"**\n!Dockerfile\n!.dockerignore\n!artifact\n!artifact/**\n"


def container_policy(checkout):
    result = strict_json(_read(checkout / "config/public-container.json", 10000))
    if (set(result) != {"version", "platform", "base_image", "base_source", "verified_at", "uid", "gid", "scanner"}
            or result["version"] != 1 or result["platform"] != "linux/amd64"
            or not re.fullmatch(r"node:24-alpine@sha256:[a-f0-9]{64}", result["base_image"])
            or result["uid"] != 1000 or result["gid"] != 1000):
        raise ValueError("Invalid public container policy")
    scanner = result["scanner"]
    if (set(scanner) != {"version", "url", "sha256"} or not re.fullmatch(r"\d+\.\d+\.\d+", scanner["version"])
            or scanner["url"] != f'https://github.com/aquasecurity/trivy/releases/download/v{scanner["version"]}/trivy_{scanner["version"]}_Linux-64bit.tar.gz'
            or not re.fullmatch(r"[a-f0-9]{64}", scanner["sha256"])):
        raise ValueError("Invalid pinned public container scanner")
    return result


def dockerfile(policy, manifest):
    # All interpolations are independently verified hashes or a fixed image ref.
    return (f'FROM {policy["base_image"]}\n'
        'RUN rm -rf /usr/local/lib/node_modules /opt/yarn-v* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg\n'
        'WORKDIR /app\n'
        'COPY --chown=0:0 artifact/ /app/\n'
        'ENV NODE_ENV=production PORT=8080\n'
        'USER 1000:1000\n'
        'EXPOSE 8080\n'
        'HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", '
        '"fetch(\'http://127.0.0.1:\'+(process.env.PORT||\'8080\')+\'/health/ready\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]\n'
        'LABEL org.opencontainers.image.source="https://github.com/justin-napolitano/islam-research" '
        f'org.opencontainers.image.revision="{manifest["source_commit"]}" '
        f'org.opencontainers.image.version="{manifest["build_id"]}"\n'
        'ENTRYPOINT ["node"]\n'
        'CMD ["runtime/public-server.mjs"]\n').encode()


def verify_context(directory, checkout):
    directory, checkout = _safe_root(directory), _safe_root(checkout)
    metadata = strict_json(_read(directory / "container-context.json", 100000))
    policy = container_policy(checkout)
    if (set(metadata) != {"format_version", "kind", "context_id", "build_id", "release_id", "base_image", "platform", "files", "deployed"}
            or metadata["format_version"] != 1 or metadata["kind"] != "approved_public_container_context"
            or metadata["base_image"] != policy["base_image"] or metadata["platform"] != policy["platform"]
            or metadata["deployed"] is not False):
        raise ValueError("Invalid public container context")
    content = {key: value for key, value in metadata.items() if key != "context_id"}
    if metadata["context_id"] != "context-" + digest(encoded(content)):
        raise ValueError("Public container context identity mismatch")
    manifest = verify_site(directory / "artifact", checkout)
    if manifest["build_id"] != metadata["build_id"] or manifest["release_id"] != metadata["release_id"]:
        raise ValueError("Public container artifact identity mismatch")
    actual = set()
    for path in directory.rglob("*"):
        if path.is_symlink(): raise ValueError("Public container context symlink")
        if path.is_file(): actual.add(path.relative_to(directory).as_posix())
    expected = {"Dockerfile", ".dockerignore", "container-context.json", "artifact/build-manifest.json"} | {"artifact/"+name for name in manifest["files"]}
    if actual != expected or set(metadata["files"]) != expected - {"container-context.json"}:
        raise ValueError("Unexpected public container context file")
    total = 0
    for name, info in metadata["files"].items():
        data = _read(directory / name, MAX_SITE_BYTES); total += len(data)
        if total > MAX_SITE_BYTES + 1_000_000 or info != {"bytes": len(data), "sha256": digest(data)}:
            raise ValueError("Public container context integrity mismatch")
    if _read(directory / "Dockerfile", 10000) != dockerfile(policy, manifest) or _read(directory / ".dockerignore", 10000) != DOCKERIGNORE:
        raise ValueError("Unregistered public container instructions")
    for path in (directory / "artifact").rglob("*"):
        if path.stat().st_mode & 0o222: raise ValueError("Public artifact must be read-only in its build context")
    if (directory / "artifact").stat().st_mode & 0o222:
        raise ValueError("Public artifact root must be read-only")
    return metadata


def prepare_context(artifact, output, checkout):
    artifact, output, checkout = map(_safe_root, (artifact, output, checkout))
    if output == artifact or artifact in output.parents:
        raise ValueError("Container output must be outside the public artifact")
    manifest = verify_site(artifact, checkout)
    policy = container_policy(checkout)
    output.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".staging-", dir=output))
    try:
        copied = stage / "artifact"; copied.mkdir()
        for name in [*manifest["files"], "build-manifest.json"]:
            target = copied / name; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(_read(artifact / name, MAX_SITE_BYTES))
        verify_site(copied, checkout)
        (stage / "Dockerfile").write_bytes(dockerfile(policy, manifest))
        (stage / ".dockerignore").write_bytes(DOCKERIGNORE)
        records = {path.relative_to(stage).as_posix(): {"bytes": len(data), "sha256": digest(data)}
                   for path in sorted(stage.rglob("*")) if path.is_file() for data in [_read(path, MAX_SITE_BYTES)]}
        metadata = {"format_version": 1, "kind": "approved_public_container_context", "build_id": manifest["build_id"],
                    "release_id": manifest["release_id"], "base_image": policy["base_image"], "platform": policy["platform"],
                    "files": records, "deployed": False}
        metadata["context_id"] = "context-" + digest(encoded(metadata))
        (stage / "container-context.json").write_bytes(encoded(metadata))
        for path in sorted(copied.rglob("*"), reverse=True):
            path.chmod(0o555 if path.is_dir() else 0o444)
        copied.chmod(0o555)
        verify_context(stage, checkout)
        target = output / metadata["context_id"]
        if target.exists():
            if verify_context(target, checkout) != metadata: raise ValueError("Immutable public context collision")
        else:
            os.rename(stage, target)
        return target, metadata
    finally:
        if stage.exists():
            # Restore only our owned staging directories for cleanup; retained
            # completed contexts remain read-only and are never removed here.
            for path in stage.rglob("*"):
                if path.is_dir(): path.chmod(0o755)
            shutil.rmtree(stage)
