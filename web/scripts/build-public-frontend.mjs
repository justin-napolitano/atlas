// This profile does not load vite.config.js, publicDir or .env files.
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {readFile, writeFile, realpath, lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, relative, sep} from 'node:path';

const checkout = fileURLToPath(new URL('../..', import.meta.url));
const web = resolve(checkout, 'web');
const policy = JSON.parse(await readFile(resolve(checkout, 'config/public-build.json'), 'utf8'));
const allowed = new Set(policy.modules);
const virtual = new Set(['commonjsHelpers.js', 'vite/modulepreload-polyfill.js', 'vite/preload-helper.js']);

function normalized(path) { return relative(checkout, path).split(sep).join('/'); }

export async function buildPublicFrontend(outDir) {
  const modules = new Set();
  await build({
    root: web, configFile: false, envFile: false, envDir: false, envPrefix: [], publicDir: false,
    mode: 'production', logLevel: 'silent', plugins: [react(), {
      name: 'approved-public-module-boundary',
      async generateBundle(_options, bundle) {
        for (const raw of this.getModuleIds()) {
          const clean = raw.replace(/^\0/, '').split('?')[0];
          if (virtual.has(clean)) continue;
          if (!clean.startsWith('/')) throw new Error('Unregistered public build module');
          const canonical = await realpath(clean);
          if ((await lstat(clean)).isSymbolicLink() || canonical !== clean)
            throw new Error('Symlinked public build module');
          const name = normalized(canonical);
          if (allowed.has(name)) { modules.add(name); continue; }
          const dependency = name.match(/^web\/node_modules\/([^/]+)\//)?.[1];
          if (!policy.dependency_packages.includes(dependency) || this.getModuleInfo(raw)?.isExternal)
            throw new Error('A non-public module entered the frontend build');
        }
        const outputs = new Set(Object.keys(bundle));
        for (const item of Object.values(bundle)) {
          if (item.type === 'chunk' && [...item.imports, ...item.dynamicImports].some(name => !outputs.has(name)))
            throw new Error('External runtime imports cannot enter the public build');
        }
      }
    }],
    build: {outDir, emptyOutDir: true, sourcemap: false, manifest: false, reportCompressedSize: false,
      rollupOptions: {input: resolve(checkout, policy.entry), output: {
        entryFileNames: 'assets/public-[hash].js', chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/public-[hash][extname]'
      }}}
  });
  const profile = {version: 1, modules: [...modules].sort()};
  await writeFile(resolve(outDir, '.public-profile.json'), JSON.stringify(profile)+'\n');
  return profile;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Supply one staging output directory');
    await buildPublicFrontend(resolve(process.argv[2]));
    console.log(JSON.stringify({public_frontend_built: true, deployed: false}));
  } catch {
    console.error('Public frontend build failed; no deployment was attempted.');
    process.exitCode = 1;
  }
}
