import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5317, strictPort: false, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  build: { target: 'es2022' },
});
