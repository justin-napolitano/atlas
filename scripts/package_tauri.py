#!/usr/bin/env python3
"""Package the release Tauri shell with the existing allowlisted offline runtime.

Does not install the application or access owner state. Build Rust first with
`cargo build --release --locked --manifest-path desktop/tauri/Cargo.toml`.
"""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, default=ROOT/'research-library/desktop-resources')
    parser.add_argument('--output', type=Path, default=ROOT/'research-library/tauri-build/Atlas.app')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('This verified packaging path targets macOS only')
    resources = args.resources.resolve()
    binary = ROOT/'desktop/tauri/target/release/atlas-desktop'
    for path in [binary, resources/'runtime/atlas-service/atlas-service', resources/'frontend/owner-manifest.json', resources/'postgres/bin/postgres']:
        if not path.is_file():
            parser.error('Build the release shell and offline runtime first')
    info=json.loads(subprocess.check_output([str(binary),'--build-info'],text=True))
    if info!={'shell':'tauri','version':'0.2.0','nativeReview':False}:
        parser.error('Only the production shell can be packaged; native-review builds are excluded')
    # A clean resources tree contains public/runtime assets only. Never accept an
    # arbitrary checkout or state directory as a bundle resource.
    if set(p.name for p in resources.iterdir()) - {'runtime', 'frontend', 'postgres', 'build.json', 'POSTGRES-CREDITS.rtf'}:
        parser.error('Unexpected file in offline resources')
    build = json.loads((resources/'build.json').read_text())
    if build.get('kind') != 'offline-local-postgresql' or build.get('ownerDataIncluded') is not False:
        parser.error('Expected the offline resource builder manifest')
    output = args.output.resolve()
    if output.exists():
        parser.error('Choose a new output directory; existing app was retained')
    macos = output/'Contents/MacOS'; destination = output/'Contents/Resources'
    macos.mkdir(parents=True); destination.mkdir()
    shutil.copy2(binary, macos/'atlas-desktop')
    shutil.copytree(resources, destination/'offline', symlinks=True)
    plist = {
        'CFBundleName': 'Atlas', 'CFBundleDisplayName': 'Atlas',
        'CFBundleIdentifier': 'org.researchatlas.desktop', 'CFBundleExecutable': 'atlas-desktop',
        'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '0.2.0',
        'CFBundleVersion': '2', 'LSMinimumSystemVersion': '11.0',
        'NSHighResolutionCapable': True,
        'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
    }
    # Generate the existing Atlas artwork, without retaining the staging PNGs.
    iconset = output.parent/'Atlas.iconset'
    if iconset.exists():
        parser.error('Icon staging directory already exists')
    iconset.mkdir()
    png = iconset/'atlas.png'
    shutil.copy2(ROOT/'desktop/tauri/icons/icon.png', png)
    for size in [16, 32, 128, 256, 512]:
        for scale in [1, 2]:
            target = iconset/f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png'
            subprocess.run(['/usr/bin/sips', '-z', str(size*scale), str(size*scale), str(png), '--out', str(target)], check=True, capture_output=True)
    png.unlink()
    subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(destination/'Atlas.icns')], check=True)
    shutil.rmtree(iconset)
    plist['CFBundleIconFile'] = 'Atlas.icns'
    (output/'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
    subprocess.run(['/usr/bin/codesign', '--force', '--deep', '--sign', '-', str(output)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(output)], check=True)
    print(json.dumps({'app': str(output), 'shell': 'tauri', 'bundledRuntime': True, 'bundledDatabase': True,
                      'signature': 'ad-hoc', 'notarized': False, 'ownerDataIncluded': False}))


if __name__ == '__main__':
    main()
