// Helper for tools/fax/make_vectors.py: encode each page with our T.4 encoder using the options libtiff used,
// and write the stream (<id>.ours.bin) and the stream wrapped as a TIFF (<id>.ours.tif) for libtiff to read.
// Usage: node tools/fax/encode_vectors.mjs jobs.json
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { T4Encoder } from '../../src/fax/t4/encode.js';
import { wrapTiff } from '../../src/fax/t4/tiff.js';

const { dir, vectors } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
for (const v of vectors) {
  const bitmap = new Uint8Array(readFileSync(join(dir, `${v.page}.raw`)));
  const enc = new T4Encoder(libtiffOptions(v));
  const strip = enc.encodePage(bitmap, v.height);
  writeFileSync(join(dir, `${v.id}.ours.bin`), strip);
  writeFileSync(join(dir, `${v.id}.ours.tif`), wrapTiff(strip, { ...v, xdpi: 204 }));
}

/** The encoder options that match how libtiff writes a TIFF strip: leading EOL, no RTC (EOFB for T.6), no MSLT. */
export function libtiffOptions(v) {
  return {
    width: v.width, coding: v.coding, k: v.k ?? 2, alignEol: v.alignEol, bitOrder: v.bitOrder,
    leadingEol: true, rtc: v.coding === 'mmr', minLineBits: 0,
  };
}
