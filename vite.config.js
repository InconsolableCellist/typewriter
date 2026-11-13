import { defineConfig } from 'vite';
import assets from './vite/assets.js';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5317, strictPort: false, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  // Vite's own hashed output in its own folder, apart from the content-hashed files of public/assets/ (vite/assets.js);
  // public/_headers makes both immutable.
  build: {
    target: 'es2022', assetsDir: '_app',
    // three.js in a chunk of its own, so its name (and the cached copy) changes only when the three version does. The
    // loaders under three/examples stay with the code that imports them.
    rollupOptions: { output: { manualChunks: (id) => (id.includes('/node_modules/three/build/') ? 'three' : undefined) } },
    chunkSizeWarningLimit: 600,   // three.js alone is 560 KB (144 KB gzip) and cannot be split further
  },
  plugins: [assets()],
});
