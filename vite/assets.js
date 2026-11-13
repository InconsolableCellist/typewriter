// Build step for public/assets/: Vite copies the folder into dist/ as it is; this replaces each model there with its
// meshopt-compressed form (tools/gen/compress_glb.mjs). The repository keeps the plain (quantized) GLBs, which Blender
// and the tests read; three decodes the compressed ones with MeshoptDecoder (src/render/gltf.js).
import path from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { compressGlb } from '../tools/gen/compress_glb.mjs';

export default function assets() {
  let outDir, publicDir, build = false;
  return {
    name: 'typewriter-assets',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); publicDir = c.publicDir; build = c.command === 'build'; },
    async closeBundle() {
      if (!build || !publicDir) return;
      const dir = path.join(publicDir, 'assets', 'models');
      for (const f of (await readdir(dir)).filter((n) => n.endsWith('.glb'))) {
        await writeFile(path.join(outDir, 'assets', 'models', f), await compressGlb(new Uint8Array(await readFile(path.join(dir, f)))));
      }
    },
  };
}
