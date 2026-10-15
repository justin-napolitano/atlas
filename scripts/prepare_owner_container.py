#!/usr/bin/env python3
"""Create an explicit owner build context; never invoke Docker or a cloud API."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from islam_research.owner_runtime import load_frontend


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frontend', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    frontend, output = args.frontend.resolve(), args.output.resolve()
    load_frontend(frontend)
    if output.exists(): raise ValueError('Choose a new owner context directory')
    policy = json.loads((ROOT / 'config/owner-container.json').read_text())
    if policy['platform'] != 'linux/amd64' or not re.fullmatch(r'python:3\.12-slim-bookworm@sha256:[a-f0-9]{64}', policy['base_image']):
        raise ValueError('Invalid owner image policy')
    output.mkdir(parents=True)
    shutil.copytree(frontend, output / 'frontend')
    # Copy tracked package code/resources only: no checkout, credentials, local
    # research library, node_modules, .git or browser fixture state.
    paths = subprocess.check_output(['git', 'ls-files', '-z', 'src/islam_research'], cwd=ROOT).decode().split('\0')
    for name in filter(None, paths):
        path = ROOT / name
        if path.is_symlink() or not path.is_file(): raise ValueError('Unsupported tracked runtime file')
        target = output / name; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(path, target)
    if not (output / 'src/islam_research/owner_runtime.py').is_file():
        raise ValueError('Commit owner runtime before preparing the image')
    subprocess.run(['uv', 'export', '--frozen', '--no-dev', '--no-emit-project', '--extra', 'api', '--extra', 'database', '--format', 'requirements-txt', '--output-file', str(output / 'requirements.txt')], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    dockerfile = f'''FROM {policy['base_image']} AS dependencies
WORKDIR /build
COPY requirements.txt /build/requirements.txt
RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: --target /packages -r requirements.txt
FROM {policy['base_image']}
WORKDIR /app
COPY --from=dependencies /packages /packages
COPY --chown=0:0 src/ /app/src/
COPY --chown=0:0 frontend/ /app/frontend/
ENV PYTHONPATH=/packages:/app/src PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RESEARCH_OWNER_FRONTEND=/app/frontend PORT=8080
RUN chmod -R a-w /app /packages
USER 1000:1000
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health/live',timeout=2)"]
ENTRYPOINT ["python", "-m", "islam_research.owner_server"]
'''
    (output / 'Dockerfile').write_text(dockerfile)
    (output / '.dockerignore').write_text('**\n!Dockerfile\n!requirements.txt\n!src\n!src/**\n!frontend\n!frontend/**\n')
    records = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'context-manifest.json').write_text(json.dumps({'kind': 'private_owner_container_context', 'platform': policy['platform'], 'base_image': policy['base_image'], 'files': records, 'deployed': False}, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'kind': 'private_owner_container_context', 'files': len(records), 'deployed': False}))


if __name__ == '__main__': main()
