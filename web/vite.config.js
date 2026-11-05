import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: {
    public: fileURLToPath(new URL('./index.html', import.meta.url)),
    workspace: fileURLToPath(new URL('./workspace.html', import.meta.url)),
    publication: fileURLToPath(new URL('./publish.html', import.meta.url)),
  } } },
});
