// The FO-70 firmware's video path: CIS counts in, one packed bilevel line out (docs/fax/plan.md 2, "Video processing").
//
//   1. Shading correction against the white reference and the dark reference read at the start of a page:
//      v = (raw - dark) / (white - dark) * whiteReference, a reflectance-like value per element, flat across the bar
//      whatever the LED profile, the chip steps and the element gains are.
//   2. White tracking (automatic background control): the paper of an original is not the reference strip's white.
//      The firmware follows the line's background, a high percentile of the line taken from a 128-bin histogram, with
//      a fast attack and a slow release, and divides by it [A].
//   3. Text mode: a fixed threshold on the tracked value, moved by the contrast setting (normal, a light original
//      darkened, a dark original lightened) [A: the levels].
//   4. Halftone mode, 64 levels [S]: ordered dither with an 8 x 8 Bayer matrix (64 thresholds, so 64 grey steps in an
//      8 x 8 cell). ORDERED DITHER IS ASSUMED [A]: the manual has not been read; error diffusion would be the other
//      choice. The tone curve maps the tracked value to a density between a white clip just under the background
//      (so the paper's noise is not dithered into dots) and `blackLevel`; the contrast setting bends it [A].
//   Out: a packed row, MSB first, 1 = black (src/fax/t4/lines.js).
//
// The line pitch (standard, fine, super fine) is the feeder's: this path makes one output line per scan line. Pure
// module; everything allocated in the constructor.

import { CIS } from './optics.js';

/** Threshold and tone settings [A]. */
export const VIDEO = Object.freeze({
  threshold: { normal: 0.55, light: 0.70, dark: 0.40 },   // of the tracked white: below it is black
  gamma: { normal: 1.0, light: 0.75, dark: 1.35 },        // halftone tone curve exponent on density
  blackLevel: 0.10,          // tracked value taken as full black in halftone
  whiteClip: 0.10,           // halftone: this far below the tracked background is still white (noise is not dithered)
  trackPercentile: 0.90,     // the line's background: this fraction of the line is at or below it
  trackAttack: 0.5,          // per line, towards a whiter background
  trackRelease: 0.02,        // per line, towards a darker one
  trackMin: 0.45,            // the background is never taken darker than this
  trackMinWhiteFraction: 0.08, // a line with fewer elements near its percentile than this (a black band) holds W
});

/** The 8 x 8 Bayer matrix, values 0..63. */
export const BAYER8 = (() => {
  const m = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let v = 0;
      for (let b = 0; b < 3; b++) {
        const xb = (x >> b) & 1, yb = (y >> b) & 1;
        v |= ((xb ^ yb) << (2 * (2 - b) + 1)) | (yb << (2 * (2 - b)));
      }
      m[y * 8 + x] = v;
    }
  }
  return m;
})();

const BINS = 128;

export class VideoProcessor {
  constructor({ elements = CIS.elements, whiteReference = CIS.whiteReference, ...o } = {}) {
    this.n = elements;
    this.stride = (elements + 7) >>> 3;
    this.cfg = { ...VIDEO, ...o };
    this.whiteReference = whiteReference;
    this.white = new Float32Array(elements).fill(1);
    this.dark = new Float32Array(elements);
    this.v = new Float32Array(elements);        // the last line, shaded and tracked (1 = background)
    this.hist = new Uint32Array(BINS);
    this.mode = 'text';                          // 'text' | 'halftone'
    this.contrast = 'normal';                    // 'normal' | 'light' | 'dark'
    this.resetPage();
  }

  /** Average `lines` reads of the white strip and of the dark (both arrays of Float32Array) into the references. */
  calibrate(whiteLines, darkLines) {
    const n = this.n;
    this.white.fill(0); this.dark.fill(0);
    for (const l of whiteLines) for (let i = 0; i < n; i++) this.white[i] += l[i] / whiteLines.length;
    for (const l of darkLines) for (let i = 0; i < n; i++) this.dark[i] += l[i] / darkLines.length;
    for (let i = 0; i < n; i++) if (this.white[i] - this.dark[i] < 1) this.white[i] = this.dark[i] + 1;
  }

  /** Start a page: the dither phase and the white tracking start over. */
  resetPage() {
    this.row = 0;
    this.W = 1;
  }

  setMode({ mode = this.mode, contrast = this.contrast } = {}) {
    if (mode !== 'text' && mode !== 'halftone') throw new Error(`mode ${mode}`);
    if (!(contrast in this.cfg.threshold)) throw new Error(`contrast ${contrast}`);
    this.mode = mode; this.contrast = contrast;
  }

  /** Shading correction only: v[i] relative to the reference strip (1 = the strip's white). */
  shade(raw, out = this.v) {
    for (let i = 0; i < this.n; i++) out[i] = (raw[i] - this.dark[i]) / (this.white[i] - this.dark[i]);
    return out;
  }

  /** The background tracking step on the shaded line v (in place). Returns the tracked white. */
  track(v) {
    const n = this.n, cfg = this.cfg, h = this.hist;
    h.fill(0);
    for (let i = 0; i < n; i++) {
      let b = Math.floor(v[i] * (BINS / 1.25));
      if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
      h[b]++;
    }
    const target = cfg.trackPercentile * n;
    let acc = 0, b = 0;
    for (; b < BINS; b++) { acc += h[b]; if (acc >= target) break; }
    const lineWhite = ((b + 0.5) * 1.25) / BINS;
    // how much of the line is near its own white: a dark band with a few bright pels must not drag W
    let near = 0;
    for (let k = Math.max(0, b - 3); k <= b && k < BINS; k++) near += h[k];
    if (near >= cfg.trackMinWhiteFraction * n) {
      const k = lineWhite > this.W ? cfg.trackAttack : cfg.trackRelease;
      this.W += (lineWhite - this.W) * k;
    }
    if (this.W < cfg.trackMin) this.W = cfg.trackMin;
    const inv = 1 / this.W;
    for (let i = 0; i < n; i++) v[i] *= inv;
    return this.W;
  }

  /** One line: raw counts in, packed bilevel out (stride bytes at out[off]). Returns out. */
  process(raw, out, off = 0) {
    const n = this.n, cfg = this.cfg, v = this.v;
    this.shade(raw, v);
    this.track(v);
    out.fill(0, off, off + this.stride);
    if (this.mode === 'text') {
      const thr = cfg.threshold[this.contrast];
      for (let i = 0; i < n; i++) if (v[i] < thr) out[off + (i >>> 3)] |= 0x80 >>> (i & 7);
    } else {
      const g = cfg.gamma[this.contrast], top = 1 - cfg.whiteClip, span = top - cfg.blackLevel;
      const rowM = (this.row & 7) * 8;
      for (let i = 0; i < n; i++) {
        let d = (top - v[i]) / span;
        d = d <= 0 ? 0 : d >= 1 ? 1 : Math.pow(d, g);
        const q = Math.round(d * 63);                 // 64 levels, 0..63
        const cells = Math.round((q * 64) / 63);      // black cells of 64 in the matrix
        if (BAYER8[rowM + (i & 7)] < cells) out[off + (i >>> 3)] |= 0x80 >>> (i & 7);
      }
    }
    this.row++;
    return out;
  }
}
