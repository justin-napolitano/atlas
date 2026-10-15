#!/usr/bin/env python3
"""Build, run and scan the real owner image only on the isolated Linux CI runner."""
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from islam_research.public_container import container_policy, frontend_bom


def validate_scan(scan, image_id):
    """Require identified OS/Python coverage and honor Trivy's omitted false EOSL."""
    metadata = scan.get('Metadata', {})
    operating_system = metadata.get('OS', {})
    # Trivy v0.76.0's OS.Eosl has json:"EOSL,omitempty": absent means false.
    # Unknown/missing OS identity still fails, as do true or malformed flags.
    assert metadata.get('ImageID') == image_id
    assert operating_system.get('Family') == 'alpine'
    assert re.fullmatch(r'3\.\d+\.\d+', operating_system.get('Name', ''))
    assert operating_system.get('EOSL', False) is False
    results = scan.get('Results', [])
    assert any(result.get('Type') == 'alpine' for result in results)
    assert any(result.get('Type') == 'python-pkg' for result in results)
    assert not any(result.get('Vulnerabilities') for result in results)


def main():
    from install_container_scanner import install
    if sys.platform != 'linux' or platform.machine() != 'x86_64' or os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RESEARCH_CONTAINER_TESTS') != 'isolated-ci-only':
        raise RuntimeError('Use isolated Linux CI; never start a Mac Docker daemon')
    evidence = ROOT / 'research-library/owner-container-validation'; evidence.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='owner-container-ci-') as tmp:
        temp = Path(tmp); config = temp / 'docker-config'; config.mkdir()
        def run(args, timeout=300, check=True):
            if args[0] == 'docker': args = ['docker', '--config', str(config), *args[1:]]
            result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
            if check and result.returncode:
                print(result.stderr[-2500:], file=sys.stderr)
                raise RuntimeError('Isolated owner container check failed')
            return result
        frontend, context = temp / 'frontend', temp / 'context'
        run([sys.executable, 'scripts/build_owner_frontend.py', '--output', str(frontend)])
        run([sys.executable, 'scripts/prepare_owner_container.py', '--frontend', str(frontend), '--output', str(context)])
        image, name, network = ['research-owner-' + uuid.uuid4().hex for _ in range(3)]
        run(['docker', 'build', '--pull', '--platform', 'linux/amd64', '--tag', image, str(context)], timeout=480)
        try:
            info = json.loads(run(['docker', 'image', 'inspect', image]).stdout)[0]
            assert info['Config']['User'] == '1000:1000'
            assert info['Config']['Entrypoint'] == ['python', '-m', 'islam_research.owner_server']
            run(['docker', 'network', 'create', '--internal', network])
            restrictions = ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=64', '--memory=768m', '--cpus=1']
            probe = """import errno,os,pathlib
assert os.getuid()==1000 and os.getgid()==1000
assert not pathlib.Path('/app/.git').exists()
assert not pathlib.Path('/app/frontend/data/public-graph.json').exists()
for name in ['/app/private-write','/tmp/private-write']:
    try: pathlib.Path(name).write_text('synthetic')
    except OSError as error: assert error.errno in {errno.EROFS,errno.EACCES}
    else: raise AssertionError('Runtime filesystem unexpectedly writable')
"""
            run(['docker', 'run', '--rm', '--network=none', *restrictions, '--entrypoint=python', image, '-c', probe])
            run(['docker', 'run', '-d', '--name', name, '--network', network, *restrictions,
                 '-e', 'RESEARCH_MODE=owner', '-e', 'RESEARCH_DATABASE_URL=host=127.0.0.1 port=1 dbname=synthetic connect_timeout=1',
                 '-e', 'RESEARCH_OWNER_SUBJECT=synthetic-owner', '-e', 'RESEARCH_IAP_AUDIENCE=/projects/123/locations/us-central1/services/synthetic-owner',
                 '-e', 'RESEARCH_OWNER_ORIGIN=https://owner.example.invalid', image])
            address = json.loads(run(['docker', 'inspect', name]).stdout)[0]['NetworkSettings']['Networks'][network]['IPAddress']
            origin = 'http://' + address + ':8080'
            def get(path):
                try:
                    with urllib.request.urlopen(origin + path, timeout=3) as response: return response.status, response.read(), response.headers
                except urllib.error.HTTPError as error: return error.code, error.read(), error.headers
            for attempt in range(60):
                try:
                    if get('/health/live')[0] == 200: break
                except (OSError, urllib.error.URLError): pass
                time.sleep(0.2)
            else: raise RuntimeError('Owner image did not start')
            assert get('/health/ready')[0] == 503
            for path in ['/', '/workspace.html', '/publish.html', '/assets/unknown.js', '/v1/me', '/v1/projects']:
                status, body, headers = get(path)
                assert status == 401 and headers['Cache-Control'] == 'no-store'
                assert b'synthetic-owner' not in body
            assert get('/v1/public/snapshots/example')[0] == 404
            stop = run(['docker', 'stop', '--time=15', name])
            assert json.loads(run(['docker', 'inspect', name]).stdout)[0]['State']['ExitCode'] == 0
            archive = temp / 'owner-image.tar'; run(['docker', 'save', '--output', str(archive), image])
            scanner = install(temp / 'tools')
            run([str(scanner), 'image', '--input', str(archive), '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--format', 'json', '--output', str(evidence / 'scan.json')], timeout=300)
            scan = json.loads((evidence / 'scan.json').read_text())
            validate_scan(scan, info['Id'])
            run([str(scanner), 'convert', '--format', 'cyclonedx', '--output', str(evidence / 'sbom.cdx.json'), str(evidence / 'scan.json')])
            (evidence / 'frontend.sbom.cdx.json').write_text(json.dumps(frontend_bom(ROOT)))
            run([str(scanner), 'sbom', '--scanners', 'vuln', '--severity', 'HIGH,CRITICAL', '--exit-code', '1', '--format', 'json', '--output', str(evidence / 'frontend-scan.json'), str(evidence / 'frontend.sbom.cdx.json')], timeout=300)
            (evidence / 'summary.json').write_text(json.dumps({'owner_image_id': info['Id'], 'checks': ['actual production entrypoint', 'non-root read-only runtime', 'missing IAP rejects pages/assets/API', 'readiness fails without database', 'no public API', 'graceful shutdown', 'OS and installed Python vulnerability scan', 'bundled npm scan'], 'authenticated_live_iap_verified': False, 'live_cloud_sql_verified': False, 'deployed': False}, indent=2))
        finally:
            run(['docker', 'rm', '-f', name], check=False)
            run(['docker', 'network', 'rm', network], check=False)
            run(['docker', 'image', 'rm', image], check=False)


if __name__ == '__main__': main()
