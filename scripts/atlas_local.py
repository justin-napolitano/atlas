#!/usr/bin/env python3
"""Run an empty, private SQLite Atlas workspace from a source checkout."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path,
                        default=Path.home()/'.local/share/atlas-open-source')
    parser.add_argument('--no-open', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    args = parser.parse_args()
    state = args.state_dir.expanduser().resolve()
    if state == ROOT or state.is_relative_to(ROOT):
        parser.error('Choose a private state directory outside the checkout')
    if args.port and not 1024 <= args.port <= 65535:
        parser.error('Choose a local port between 1024 and 65535')
    os.umask(0o077)
    import desktop_sqlite as embedded
    import local_workspace as local

    with embedded.service_lease(state):
        embedded.bootstrap(argparse.Namespace(state_dir=state))
        output = state/'frontend'/str(time.time_ns())
        subprocess.run([sys.executable, str(ROOT/'scripts/build_owner_frontend.py'),
                        '--output', str(output)], cwd=ROOT, check=True)
        manifest = json.loads((output/'owner-manifest.json').read_text())
        for name in ('workspace.html', 'publish.html'):
            path = output/name
            path.write_text(path.read_text().replace(
                '<head>', '<head><meta name="research-storage-mode" content="local-sqlite">', 1))
            data = path.read_bytes()
            manifest['files'][name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        (output/'owner-manifest.json').write_text(json.dumps(manifest))
        # A child owns the listening socket and private session adapter. Its
        # handshake contains a port only; launch credentials never enter stdout.
        child = subprocess.Popen([sys.executable, __file__, '--serve', str(state),
                                  str(output), str(args.port)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, text=True)
        try:
            import selectors
            with selectors.DefaultSelector() as selector:
                selector.register(child.stdout, selectors.EVENT_READ)
                if not selector.select(timeout=30):
                    raise RuntimeError('Local service did not become ready')
                ready = json.loads(child.stdout.readline())
            port = ready['port']
            origin = f'http://127.0.0.1:{port}'
            # Confirm HTTP readiness before opening a browser. No credential is
            # sent to this readiness request or written into console logs.
            for attempt in range(100):
                try:
                    with urllib.request.urlopen(origin+'/local/login', timeout=1):
                        break
                except OSError:
                    if child.poll() is not None:
                        raise RuntimeError('Local service exited during startup')
                    time.sleep(.1)
            else:
                raise RuntimeError('Local service did not become ready')
            print(f'Atlas is running at {origin}. Private storage: {state}', flush=True)
            if not args.no_open:
                credentials = json.loads((state/'local-session.json').read_text())
                webbrowser.open(origin+'/local/login#'+credentials['launch'])
            else:
                print('Browser opening disabled. The private launch credential is in local-session.json.', flush=True)
            # The child drains no logs into the parent. Keep its stdin lease
            # alive until Ctrl+C, then wait for a graceful shutdown.
            child.wait()
            return child.returncode
        except KeyboardInterrupt:
            return 0
        finally:
            if child.stdin:
                child.stdin.close()
            if child.poll() is None:
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.send_signal(signal.SIGTERM)
                    child.wait(timeout=10)


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--serve':
        import local_workspace as local
        local._serve(argparse.Namespace(state_dir=Path(sys.argv[2]),
            frontend=Path(sys.argv[3]), port=int(sys.argv[4]), sqlite=True,
            desktop_managed=True))
    else:
        raise SystemExit(main())
