// Type-slug glyph height fields. public/assets/glyphs.bin holds N x N Uint8 height fields (see
// tools/bake_glyphs.py); 255 is the printing face, 0 is at or below the relief depth. Works in the
// browser (fetch) and in Node (fs, resolved relative to this module) so tests can load real faces.

const SITE_BASE = '/assets/';

async function readAsset(name) {
  if (typeof process !== 'undefined' && process.versions?.node) {
    // Specifiers held in variables so browser bundlers never try to resolve these Node modules.
    const fsMod = 'node:fs/promises', urlMod = 'node:url';
    const { readFile } = await import(/* @vite-ignore */ fsMod);
    const { fileURLToPath } = await import(/* @vite-ignore */ urlMod);
    const path = fileURLToPath(new URL(`../../public/assets/${name}`, import.meta.url));
    return new Uint8Array(await readFile(path));
  }
  const r = await fetch(`${SITE_BASE}${name}`);
  if (!r.ok) throw new Error(`glyph asset ${name}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * @returns {Promise<{N:number, texelMm:number, baselineV:number, chars:string, faceAreaMm2:number[],
 *   count:number, data:Uint8Array, indexOf:(c:string)=>number, face:(i:number)=>Uint8Array}>}
 */
export async function loadGlyphs() {
  const metaBytes = await readAsset('glyphs.json');
  const meta = JSON.parse(new TextDecoder().decode(metaBytes));
  const data = await readAsset('glyphs.bin');
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
