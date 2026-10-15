#!/usr/bin/env python3
"""Install the checksum-pinned Trivy executable into an owned CI directory."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import platform
import sys
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def install(directory):
    if sys.platform != "linux" or platform.machine() not in {"x86_64", "AMD64"}:
        raise ValueError("Scanner installation is Linux x86-64 CI only")
    policy = json.loads((ROOT / "config/public-container.json").read_text())["scanner"]
    expected = f'https://github.com/aquasecurity/trivy/releases/download/v{policy["version"]}/trivy_{policy["version"]}_Linux-64bit.tar.gz'
    if policy["url"] != expected: raise ValueError("Unregistered scanner URL")
    with urllib.request.urlopen(policy["url"], timeout=60) as response:
        archive = response.read(100_000_001)
    if len(archive) > 100_000_000 or hashlib.sha256(archive).hexdigest() != policy["sha256"]:
        raise ValueError("Scanner download integrity mismatch")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        member = package.getmember("trivy")
        if not member.isfile() or member.size > 250_000_000:
            raise ValueError("Invalid scanner executable")
        stream = package.extractfile(member)
        data = stream.read(250_000_001)
    directory.mkdir(parents=True, exist_ok=True)
    if directory.is_symlink(): raise ValueError("Scanner output must not be a symlink")
    target = directory / "trivy"
    with target.open("xb") as handle: handle.write(data)
    target.chmod(0o755)
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--path", type=Path, required=True)
    args = parser.parse_args()
    try:
        install(args.path)
        print(json.dumps({"scanner_installed": True, "checksum_verified": True}))
    except Exception:
        print("Pinned container scanner installation failed.", file=sys.stderr)
        raise SystemExit(1)
