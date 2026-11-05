import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Owner assets are never copied into the anonymous publication artifact.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { sourcemap: false, rollupOptions: { input: {
    workspace: fileURLToPath(new URL('./workspace.html', import.meta.url)),
    publication: fileURLToPath(new URL('./publish.html', import.meta.url)),
  } } },
});
