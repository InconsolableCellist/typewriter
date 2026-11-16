// A real page into the call: the T.30 page source that scans a page image through the CIS model (optics.js), the
// video path (video.js) and the T.4 coder (src/fax/t4/). It has the shape of the stub source (src/fax/t30/stub-page.js)
// and replaces it as the `source` option of T30Caller / T30Answerer, over the ideal pipe (transport.js) or the
// audio link (modem/audio-port.js) alike:
//
//   const src = scannedSource({ pages: [chartPage()], mode: 'text', contrast: 'normal' });
//   new T30Caller({ source: src, vres: 'fine' })
//   src.pageBits(index, params) -> Uint8Array of 0/1     params: { rate, vres, twoD, scanMs, width }
//   src.scanned(index, vres) -> { bitmap, height, width, stride, vres, lpmm }   the coded page, for comparison
//
// The feeder here is ideal (the mechanism's feeder is another module): the sheet moves `1 / lpmm` a line, the bar
// integrating while it moves; `skewRad`, `xMm` and `liftMm` place the sheet if wanted. Standard, fine and super fine
// are the feed step (3.85, 7.7, 15.4 lines a mm) [S]; MR uses K = 2, 4, 8 (plan.md P1). The minimum scan line time
// is honoured by fill (T4Encoder minLineBits). A page scanned once at a resolution is kept, so a page sent again
// after RTN is the same page coded again at the new rate [A: the FO-70 has no page memory as far as known (P10); a
// real resend would need the sheet; the simulation keeps the scan].
//
// Pure module: the scan's buffers are allocated once per page and resolution.

import { CisSensor } from '../image/optics.js';
import { VideoProcessor } from '../image/video.js';
import { T4Encoder } from '../t4/encode.js';

/** Lines a mm for each vertical resolution [S]. */
export const LPMM = Object.freeze({ standard: 3.85, fine: 7.7, superfine: 15.4 });
/** MR's K for each (T.4; K = 8 at 15.4 lines a mm per plan.md P1 [M]). */
export const MR_K = Object.freeze({ standard: 2, fine: 4, superfine: 8 });

export const vresOf = (params) => params.vres ?? (params.superFine ? 'superfine' : params.fine ? 'fine' : 'standard');

/** Lines of a page of heightMm at a resolution. */
export const linesFor = (heightMm, vres) => Math.round(heightMm * LPMM[vres]);

/**
 * Scan a page to a packed bilevel bitmap. Options: vres, mode ('text' | 'halftone'), contrast ('normal' | 'light' |
 * 'dark'), skewRad, xMm, liftMm (a number, or a function of yMm), cis (a CisSensor), video (a VideoProcessor),
 * refLines (white and dark reference reads averaged).
 */
export function scanPage(page, {
  vres = 'fine', mode = 'text', contrast = 'normal', skewRad = 0, xMm = 0, liftMm = 0, cis = null, video = null,
  refLines = 8, seed = 1,
} = {}) {
  const sensor = cis ?? new CisSensor({ seed });
  const vp = video ?? new VideoProcessor();
  const n = sensor.n;
  const lpmm = LPMM[vres];
  const pitch = 1 / lpmm;
  const height = linesFor(page.heightMm, vres);
  const stride = (n + 7) >>> 3;
  const bitmap = new Uint8Array(stride * height);
  const raw = new Float32Array(n);
  // references: the white strip with the LED on, and the dark with it off, before the page
  const whites = [], darks = [];
  for (let k = 0; k < refLines; k++) whites.push(Float32Array.from(sensor.scanLine(null, null, raw)));
  for (let k = 0; k < refLines; k++) darks.push(Float32Array.from(sensor.scanLine(null, null, raw, { led: false })));
  vp.calibrate(whites, darks);
  vp.setMode({ mode, contrast });
  vp.resetPage();
  const pose = { yMm: 0, xMm, skewRad, liftMm: 0, travelMm: pitch };
  for (let y = 0; y < height; y++) {
    pose.yMm = (y + 0.5) * pitch;
    pose.liftMm = typeof liftMm === 'function' ? liftMm(pose.yMm) : liftMm;
    sensor.scanLine(page, pose, raw);
    vp.process(raw, bitmap, y * stride);
  }
  return { bitmap, height, width: n, stride, vres, lpmm };
}

/** Unpack a coded stream (bytes in the line's order, LSB first) to one 0/1 value per bit. */
export function unpackLsb(bytes, nbits = bytes.length * 8) {
  const out = new Uint8Array(nbits);
  for (let i = 0; i < nbits; i++) out[i] = (bytes[i >>> 3] >>> (i & 7)) & 1;
  return out;
}

/** The T.30 page source over scanned pages. */
export function scannedSource({ pages, mode = 'text', contrast = 'normal', skewRad = 0, xMm = 0, liftMm = 0, seed = 1, onScan = null } = {}) {
  if (!pages || !pages.length) throw new Error('scannedSource needs pages');
  const cache = new Map();
  const cis = new CisSensor({ seed });
  const video = new VideoProcessor();
  const src = {
    pageCount: pages.length,
    timings: [],                 // { index, vres, scanMs, codeMs, bits, lines }
    scanned(index, vres) {
      const key = `${index}:${vres}`;
      let s = cache.get(key);
      if (!s) {
        const t0 = now();
        s = scanPage(pages[index], { vres, mode, contrast, skewRad, xMm, liftMm, cis, video, seed });
        s.scanMs = now() - t0;
        cache.set(key, s);
        if (onScan) onScan(index, s);
      }
      return s;
    },
    /** The coded page as the line carries it: EOL, lines with fill, RTC. */
    pageBits(index, params = {}) {
      const vres = vresOf(params);
      const s = src.scanned(index, vres);
      const t0 = now();
      const rate = params.rate ?? 9600;
      const minLineBits = Math.ceil((rate * (params.scanMs ?? 0)) / 1000);
      const enc = new T4Encoder({ width: s.width, coding: params.twoD ? 'mr' : 'mh', k: MR_K[vres], minLineBits });
      const bytes = enc.encodePage(s.bitmap, s.height);
      const bits = unpackLsb(bytes, enc.bitLength);
      src.timings.push({ index, vres, rate, scanMs: s.scanMs, codeMs: now() - t0, bits: bits.length, lines: s.height, fill: enc.fillBits });
      return bits;
    },
  };
  return src;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
