import { defineConfig } from 'vite';

// A fresh id per build: the deploy's unhashed /assets/ files are fetched with it (src/asset-version.js).
const buildId = process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 12) || Date.now().toString(36);

export default defineConfig({
  server: { host: '127.0.0.1', port: 5317, strictPort: false, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  build: { target: 'es2022' },
  define: { __BUILD_ID__: JSON.stringify(buildId) },
});
