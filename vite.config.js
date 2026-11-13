import { defineConfig } from 'vite';
import assets from './vite/assets.js';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5317, strictPort: false, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  // Vite's own hashed output in its own folder, apart from the content-hashed files of public/assets/ (vite/assets.js);
  // public/_headers makes both immutable.
  build: { target: 'es2022', assetsDir: '_app' },
  plugins: [assets()],
});
