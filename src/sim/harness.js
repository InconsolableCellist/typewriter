// Node-side helpers shared by the tests and tools/render_wav.mjs. Not used in the browser.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadGlyphsNode() {
  try {
    const bin = await readFile(path.join(root, 'public/assets/glyphs.bin'));
    const meta = JSON.parse(await readFile(path.join(root, 'public/assets/glyphs.json'), 'utf8'));
    const data = new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength);
    return { ...meta, data };
  } catch {
    return null; // tests fall back to synthetic faces
  }
}
