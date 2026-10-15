#!/usr/bin/env python3
"""Build/scan/smoke-test a synthetic image on an isolated Linux CI runner only."""
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
sys.path.insert(0, str(ROOT / "src"))
from islam_research.public_site import build_site, _environment
from islam_research.public_container import prepare_context, verify_context, container_policy
from install_container_scanner import install
from test_public_site import fixture


def command(args, *, cwd=ROOT, timeout=120, check=True, env=None):
    result = subprocess.run(args, cwd=cwd, env=env or _environment(), capture_output=True, text=True, timeout=timeout)
    if check and result.returncode: raise RuntimeError("Container validation command failed")
    return result


def run():
    if (sys.platform != "linux" or platform.machine() != "x86_64" or os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RESEARCH_CONTAINER_TESTS") != "isolated-ci-only"):
        raise RuntimeError("Container execution requires the isolated Linux CI workflow; never start Docker on the Mac")
    policy = container_policy(ROOT)
    report_root = ROOT / "research-library/container-validation"; report_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="research-container-ci-") as temporary:
        root = Path(temporary)
        artifact, build = build_site(fixture(root), root / "sites", ROOT)
        context, metadata = prepare_context(artifact, root / "contexts", ROOT)
        verify_context(context, ROOT)
        image = "research-public-fixture:" + uuid.uuid4().hex
        name = "research-public-test-" + uuid.uuid4().hex
        network = "research-public-net-" + uuid.uuid4().hex
        network_created, container_created = False, False
        try:
            command(["docker", "build", "--pull", "--platform", policy["platform"], "--tag", image, str(context)], timeout=300)
            info = json.loads(command(["docker", "image", "inspect", image]).stdout)[0]
            config = info["Config"]
            assert info["Architecture"] == "amd64" and info["Os"] == "linux"
            assert config["User"] == "1000:1000" and config["WorkingDir"] == "/app"
            assert config["Entrypoint"] == ["node"] and config["Cmd"] == ["runtime/public-server.mjs"]
            assert config["Labels"]["org.opencontainers.image.version"] == build["build_id"]
            assert not any(re.search(r"DATABASE|TOKEN|SECRET|PASSWORD|GOOGLE_APPLICATION_CREDENTIALS", value.split("=", 1)[0]) for value in config["Env"])
            restrictions = ["--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=256m", "--cpus=1"]
            version = command(["docker", "run", "--rm", "--network=none", *restrictions, "--entrypoint=node", image, "--version"]).stdout.strip()
            assert version.startswith("v24.")
            probe = "const fs=require('node:fs');if(process.getuid()!==1000||process.getgid()!==1000)process.exit(2);for(const p of ['/app/site/unexpected','/tmp/unexpected']){try{fs.writeFileSync(p,'synthetic');process.exit(3)}catch(e){if(!['EROFS','EACCES'].includes(e.code))throw e}}for(const p of ['/usr/local/bin/npm','/usr/local/bin/npx','/usr/local/bin/yarn','/app/site/workspace.html','/app/release/data/public-graph.json'])if(fs.existsSync(p))process.exit(4);"
            command(["docker", "run", "--rm", "--network=none", *restrictions, "--entrypoint=node", image, "-e", probe])
            command(["docker", "network", "create", "--internal", network]); network_created = True
            command(["docker", "run", "--detach", "--name", name, "--network", network, *restrictions,
                     "--publish", "127.0.0.1::8080", image]); container_created = True
            port = command(["docker", "port", name, "8080/tcp"]).stdout.strip()
            if not re.fullmatch(r"127\.0\.0\.1:[1-9][0-9]{1,4}", port): raise ValueError("Unexpected container test binding")
            origin = "http://" + port
            deadline = time.monotonic() + 30
            while True:
                try:
                    with urllib.request.urlopen(origin + "/health/ready", timeout=1) as response:
                        assert json.load(response)["build_id"] == build["build_id"]
                    break
                except (OSError, urllib.error.URLError):
                    if time.monotonic() > deadline: raise RuntimeError("Container did not become ready")
                    time.sleep(0.25)
            inspect = json.loads(command(["docker", "inspect", name]).stdout)[0]
            assert inspect["HostConfig"]["ReadonlyRootfs"] and not inspect["HostConfig"]["Privileged"]
            assert "ALL" in inspect["HostConfig"]["CapDrop"]
            assert inspect["HostConfig"]["SecurityOpt"] == ["no-new-privileges"]
            assert not inspect["Mounts"]
            env = {**_environment(), "RESEARCH_TEST_PUBLIC_SITE": str(artifact), "RESEARCH_PUBLIC_TEST_ORIGIN": origin,
                   "CHROME_PATH": "/usr/bin/google-chrome"}
            browser = command(["node", "web/scripts/review-public-site.mjs"], env=env, timeout=90)
            for line in browser.stdout.splitlines():
                if line.startswith('{"isolated_public_browser_passed"'): print(line)
            logs = command(["docker", "logs", name]).stdout
            assert "public_runtime_ready" in logs and "public_request" in logs
            scanner = install(root / "scanner")
            archive = root / "image.tar"
            command(["docker", "save", "--output", str(archive), image], timeout=120)
            common = ["--config", "/dev/null", "--cache-dir", str(root / "scanner-cache")]
            scan = command([str(scanner), "image", *common, "--input", str(archive), "--scanners", "vuln",
                "--severity", "HIGH,CRITICAL", "--ignorefile", "/dev/null", "--exit-code", "1", "--exit-on-eol", "1",
                "--db-repository", "ghcr.io/aquasecurity/trivy-db:2", "--timeout", "5m", "--format", "json",
                "--list-all-pkgs", "--output", str(report_root / "scan.json")], cwd=root, timeout=360, check=False)
            report = json.loads((report_root / "scan.json").read_text())
            findings = [v for result in report.get("Results", []) for v in result.get("Vulnerabilities", [])]
            command([str(scanner), "convert", "--config", "/dev/null", "--format", "cyclonedx", "--output",
                     str(report_root / "sbom.cdx.json"), str(report_root / "scan.json")], cwd=root, timeout=60)
            sbom = json.loads((report_root / "sbom.cdx.json").read_text())
            assert sbom["bomFormat"] == "CycloneDX" and sbom.get("components")
            summary = {"container_checks_passed": scan.returncode == 0, "deployed": False, "pushed": False,
                "build_id": build["build_id"], "context_id": metadata["context_id"], "image_id": info["Id"],
                "base_image": policy["base_image"], "node_version": version, "scanner_version": policy["scanner"]["version"],
                "high_critical_findings": len(findings), "sbom_components": len(sbom["components"])}
            (report_root / "summary.json").write_text(json.dumps(summary, sort_keys=True) + "\n")
            print(json.dumps(summary, sort_keys=True))
            assert scan.returncode == 0 and not findings
        finally:
            if container_created: command(["docker", "rm", "--force", name], check=False)
            if network_created: command(["docker", "network", "rm", network], check=False)
            command(["docker", "image", "rm", image], check=False)


if __name__ == "__main__":
    try: run()
    except Exception:
        print("Isolated container validation failed; no image push or deployment was attempted.", file=sys.stderr)
        raise SystemExit(1)
