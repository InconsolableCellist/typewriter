// Build step for public/assets/, which Vite copies into dist/ as it is. Each file there is replaced by a copy whose name
// carries a hash of its own bytes (`models/frame.glb` -> `models/frame.3f9a0c1b2d.glb.gz.bin`), and the map from one to
// the other is compiled into the code as __ASSET_MAP__, which src/asset-version.js applies to every request. So:
// - an unchanged file keeps its URL from one deploy to the next and stays in the browser's cache (public/_headers makes
//   /assets/* immutable);
// - a changed file gets a new URL, and a URL only ever names one content, so new code can never be handed an old cached
//   copy (nor old code a new one: the old name is gone from the deploy).
// Models are meshopt-compressed on the way (tools/gen/compress_glb.mjs) and gzipped as `.glb.gz.bin`, which no CDN
// re-encodes; src/render/gltf.js decodes both. The repository keeps the plain (quantized) GLBs, which Blender and the
// tests read. Documentation beside the assets (.md, .txt) is copied as it is and not mapped.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { compressGlb } from '../tools/gen/compress_glb.mjs';

const UNMAPPED = /\.(md|txt)$/i;

/** First 10 hex digits of the SHA-256 of the bytes. */
export const contentHash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 10);

/** `dir/name.ext...` with the hash after the name's first part: `models/frame.<h>.glb`, `glyphs.<h>.gz.bin`. */
export function hashedName(rel, hash, suffix = '') {
  const slash = rel.lastIndexOf('/') + 1, dot = rel.indexOf('.', slash);
  return dot < 0 ? `${rel}.${hash}${suffix}` : `${rel.slice(0, dot)}.${hash}${rel.slice(dot)}${suffix}`;
}

async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Every file under `assetsDir` as it ships: [{ rel, out, bytes }], `rel` its path under /assets/, `out` the hashed
 * path the deploy serves it at, `bytes` what is served there.
 */
export async function processAssets(assetsDir) {
  const entries = [];
  for (const rel of await walk(assetsDir)) {
    if (UNMAPPED.test(rel)) continue;
    let bytes = new Uint8Array(await readFile(path.join(assetsDir, rel))), suffix = '';
    if (rel.endsWith('.glb')) { bytes = new Uint8Array(gzipSync(await compressGlb(bytes), { level: 9 })); suffix = '.gz.bin'; }
    entries.push({ rel, out: hashedName(rel, contentHash(bytes), suffix), bytes });
  }
  return entries;
}

/** { rel: out } for __ASSET_MAP__. */
export const assetMap = (entries) => Object.fromEntries(entries.map((e) => [e.rel, e.out]));

export default function assets() {
  let entries = null, outDir = null;
  return {
    name: 'typewriter-assets',
    async config(cfg, { command }) {
      // The dev server serves public/ as it is, unversioned: an empty map leaves every URL alone.
      if (command !== 'build') return { define: { __ASSET_MAP__: 'null' } };
      const root = path.resolve(cfg.root ?? process.cwd());
      entries = await processAssets(path.join(path.resolve(root, cfg.publicDir ?? 'public'), 'assets'));
      return { define: { __ASSET_MAP__: JSON.stringify(assetMap(entries)) } };
    },
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    async closeBundle() {
      if (!entries) return;
      const dir = path.join(outDir, 'assets');
      for (const e of entries) {
        await writeFile(path.join(dir, e.out), e.bytes);
        await rm(path.join(dir, e.rel), { force: true });
      }
    },
  };
}
