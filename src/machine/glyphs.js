// Type-slug glyph height fields. public/assets/glyphs.gz.bin holds N x N Uint8 height fields, gzipped (see
// tools/bake_glyphs.py); 255 is the printing face, 0 is at or below the relief depth. Works in the
// browser (fetch) and in Node (fs, resolved relative to this module) so tests can load real faces. A machine names
// its set (`machine.glyphs`, default 'glyphs'); a set whose JSON says `gzip` keeps its height fields gzipped.

const SITE_BASE = '/assets/';

/** An asset's bytes: fetched in the browser, read from public/assets/ in Node. */
export async function readAsset(name) {
  if (typeof process !== 'undefined' && process.versions?.node) {
    // Specifiers held in variables so browser bundlers never try to resolve these Node modules, and the path is joined
    // by hand: a `new URL(..., import.meta.url)` here would make Vite emit a hashed copy of every file it could match.
    const fsMod = 'node:fs/promises', urlMod = 'node:url', pathMod = 'node:path';
    const { readFile } = await import(/* @vite-ignore */ fsMod);
    const { fileURLToPath } = await import(/* @vite-ignore */ urlMod);
    const { dirname, join } = await import(/* @vite-ignore */ pathMod);
    return new Uint8Array(await readFile(join(dirname(fileURLToPath(import.meta.url)), '../../public/assets', name)));
  }
  const r = await fetch(`${SITE_BASE}${name}`);
  if (!r.ok) throw new Error(`asset ${name}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Gunzip bytes (zlib in Node, DecompressionStream in the browser); bytes that are not gzip are returned as they are. */
export async function gunzip(bytes) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;   // already unpacked on the way in
  if (typeof process !== 'undefined' && process.versions?.node) {
    const zlibMod = 'node:zlib';
    const { gunzipSync } = await import(/* @vite-ignore */ zlibMod);
    return new Uint8Array(gunzipSync(bytes));
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @returns {Promise<{N:number, texelMm:number, baselineV:number, chars:string, faceAreaMm2:number[],
 *   count:number, data:Uint8Array, indexOf:(c:string)=>number, face:(i:number)=>Uint8Array}>}
 */
export async function loadGlyphs(set = 'glyphs') {
  const metaBytes = await readAsset(`${set}.json`);
  const meta = JSON.parse(new TextDecoder().decode(metaBytes));
  // `.gz.bin`, not `.bin.gz`: servers label a .gz file Content-Encoding gzip and the browser would unpack it first.
  const data = meta.gzip ? await gunzip(await readAsset(`${set}.gz.bin`)) : await readAsset(`${set}.bin`);
  const { N, chars } = meta;
  if (data.length !== N * N * chars.length) throw new Error(`glyph data size mismatch: ${data.length}`);
  return withGlyphApi({ ...meta, data });
}

/** Adds indexOf/face to a plain { N, chars, data } glyph record; returns it unchanged if already present. */
export function withGlyphApi(g) {
  if (g.face && g.indexOf) return g;
  const { N, chars, data } = g;
  const lut = new Map([...chars].map((c, i) => [c, i]));
  return {
    ...g,
    count: chars.length,
    indexOf: (c) => (lut.has(c) ? lut.get(c) : -1),
    face: (i) => data.subarray(i * N * N, (i + 1) * N * N),
  };
}

/** Glyph index printed by bar `b` of a deriveGeometry() result with case 0 (lower) or 1 (upper). */
export function glyphIndexForBar(glyphs, bar, caseIndex) {
  const c = caseIndex ? bar.upper : bar.lower;
  return glyphs.indexOf(c);
}
