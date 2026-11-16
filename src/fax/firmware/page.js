// Page data between bitmaps and the T.30 station: T.4 coding with the negotiated parameters, the bit form the
// station and the modem ports carry (one 0/1 per array element, in line order), and the receiving side's decode.
// Used by the firmware and by the far ends. Pure.
//
// A page bitmap is { width: 1728, height, vres, rows: Uint8Array } with packed rows (first pel in the most significant
// bit, 1 = black), as src/fax/t4/ and the printer interface take.

import { T4Encoder } from '../t4/encode.js';
import { T4Decoder } from '../t4/decode.js';
import { msltBits } from '../t4/tables.js';

export const PAGE_WIDTH = 1728;
export const STRIDE = PAGE_WIDTH >>> 3;
/** Lines per millimetre by vertical resolution [S]. */
export const LINES_PER_MM = Object.freeze({ standard: 3.85, fine: 7.7, superfine: 15.4 });

/** MR's K by vertical resolution: 2 standard, 4 fine (T.4 [M]); 8 super fine [A]. */
const K = { standard: 2, fine: 4, superfine: 8 };

/** The coder options for the station's page parameters { rate, vres, twoD, scanMs }. */
export function coderOptions(params) {
  const vres = params.vres ?? (params.fine ? 'fine' : 'standard');
  return {
    width: PAGE_WIDTH,
    coding: params.twoD ? 'mr' : 'mh',
    k: K[vres] ?? 2,
    minLineBits: msltBits(params.scanMs ?? 20, params.rate ?? 9600),
    bitOrder: 'lsb',
  };
}

/** Bytes (lsb first, as on the line) to one-bit-per-element form. */
export function bytesToBits(bytes, nbits = bytes.length * 8) {
  const out = new Uint8Array(nbits);
  for (let i = 0; i < nbits; i++) out[i] = (bytes[i >> 3] >> (i & 7)) & 1;
  return out;
}

export function bitsToBytes(bits) {
  const out = new Uint8Array((bits.length + 7) >> 3);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

/**
 * Code rows as a page. `rowAt(i)` gives row i's packed bytes (or null to end the page early); `n` rows at most.
 * Returns { bits, lines, lineStarts } where lineStarts[i] is the bit at which line i begins (for pacing).
 */
export function encodeRows(rowAt, n, params) {
  const enc = new T4Encoder(coderOptions(params));
  enc.startPage();
  const lineStarts = [];
  let lines = 0;
  for (let i = 0; i < n; i++) {
    const row = rowAt(i);
    if (!row) break;
    lineStarts.push(enc.bitLength);
    enc.encodeRow(row, 0);
    lines++;
  }
  const bytes = enc.finishPage();
  return { bits: bytesToBits(bytes), lines, lineStarts };
}

/** Code a page bitmap at the station's parameters, converting its vertical resolution if they differ. */
export function encodePageBitmap(page, params) {
  const vres = params.vres ?? (params.fine ? 'fine' : 'standard');
  const map = rowMapper(page, vres);
  return encodeRows(map.rowAt, map.count, params);
}

/** Rows of a bitmap seen at another vertical resolution (nearest line). */
export function rowMapper(page, vres) {
  const ratio = LINES_PER_MM[page.vres ?? 'fine'] / LINES_PER_MM[vres];
  const count = Math.max(1, Math.floor(page.height / ratio));
  return {
    count,
    rowAt: (i) => {
      if (i >= count) return null;
      const y = Math.min(page.height - 1, Math.floor(i * ratio));
      return page.rows.subarray(y * STRIDE, (y + 1) * STRIDE);
    },
  };
}

/** Decode the station's page bits. Returns the page bitmap and the counts T.30 judges by. */
export function decodeBits(bits, params) {
  const vres = params.vres ?? (params.fine ? 'fine' : 'standard');
  const dec = new T4Decoder({ width: PAGE_WIDTH, coding: params.twoD ? 'mr' : 'mh', bitOrder: 'lsb' });
  const r = dec.decodePage(bitsToBytes(bits));
  return {
    page: { width: PAGE_WIDTH, height: r.height, vres, rows: r.bitmap.slice() },
    lines: r.height, badLines: r.errorLines, maxConsecutiveBad: r.maxConsecutive, rtc: r.rtc,
  };
}

/**
 * A page source for a T.30 station from a list of page bitmaps (the far ends' virtual scanner).
 * `decorate(page, index, params)` may return a page to send instead (a header line).
 */
export function bitmapSource(pages, decorate = null) {
  return {
    get pageCount() { return pages.length; },
    pageBits(index, params) {
      const p = decorate ? decorate(pages[index], index, params) : pages[index];
      return encodePageBitmap(p, params).bits;
    },
  };
}

/**
 * The receiving side's page checker (the station's `checker`): decodes and hands each page to `onPage(page, result,
 * params)`. The result's counts drive MCF / RTP / RTN. `refuse()` returning true makes every line count as bad
 * (the machine cannot print it), so the page draws RTN.
 */
export function pageChecker(onPage, refuse = null) {
  return (bits, params) => {
    const d = decodeBits(bits, params);
    if (refuse?.()) return { lines: Math.max(1, d.lines), badLines: Math.max(1, d.lines), maxConsecutiveBad: Math.max(1, d.lines) };
    onPage?.(d.page, d, params);
    return { lines: d.lines, badLines: d.badLines, maxConsecutiveBad: d.maxConsecutiveBad };
  };
}

/** A blank page bitmap of `height` rows at `vres`. */
export function blankPage(height, vres = 'fine') {
  return { width: PAGE_WIDTH, height, vres, rows: new Uint8Array(height * STRIDE) };
}

/** Rows of `top` drawn over the start of `page` (same vres), as a new page. */
export function overlayTop(page, top) {
  const out = { ...page, rows: page.rows.slice() };
  const n = Math.min(top.height, page.height) * STRIDE;
  for (let i = 0; i < n; i++) out.rows[i] |= top.rows[i];
  return out;
}

/** Black pels in a page (tests). */
export function inkOf(page) {
  let n = 0;
  for (const b of page.rows) { let v = b; while (v) { n += v & 1; v >>>= 1; } }
  return n;
}
