// A sheet's line through the contact image sensor and the video stage, at the pose the feeder reports
// (src/sim/fax/scanner-mech.js scanLine(), architecture.md 4.2): the scanner the FO-70's station gives the firmware's
// adapter (src/fax/firmware/sim-devices.js sampleLine), and the same arithmetic for the kit's worker that reads a
// sheet's raw lines ahead (src/fax/image/scan-worker.js), so both give the same counts.
//
// The CIS costs about a millisecond a line, so a whole page read at once (as the firmware's memory-less pacing does,
// devices.md) would stall the audio thread for seconds. The raw counts (8-bit ADC values) are therefore read ahead by
// the kit's worker when the sheet reaches the read line, handed in with addRaw(), and only the cheap video stage
// (shading, white tracking, threshold or halftone) runs in the host. A line not read ahead is read here. Pure.
import { CisSensor } from './optics.js';
import { VideoProcessor } from './video.js';

export const LPMM = Object.freeze({ standard: 3.85, fine: 7.7, superfine: 15.4 });
const STRIDE = 216;

/** The CIS pose (mm) of a feeder pose (m) at a resolution. */
export function cisPose(pose, res) {
  return { yMm: pose.y * 1000, xMm: (pose.offset ?? 0) * 1000, skewRad: pose.skew ?? 0, liftMm: (pose.lift ?? 0) * 1000, travelMm: 1 / LPMM[res] };
}

/** Raw counts of `lines` lines of a page from pose y0 on, at a resolution: Uint8Array(lines * 1728). */
export function readRaw(cis, page, pose0, res, lines, raw = new Float32Array(cis.n)) {
  const out = new Uint8Array(lines * cis.n);
  const pitch = 1e-3 / LPMM[res];
  for (let k = 0; k < lines; k++) {
    const p = cisPose({ ...pose0, y: pose0.y + k * pitch }, res);
    cis.scanLine(pose0.faceDown === false ? null : page, p, raw);
    out.set(raw, k * cis.n);
  }
  return out;
}

/** Lines from pose y0 to the sheet's tail at a resolution. */
export const linesLeft = (pose0, res) => Math.max(0, Math.floor((pose0.length - pose0.y) * 1000 * LPMM[res]) + 1);

export class SheetScanner {
  constructor({ seed = 1 } = {}) {
    this.cis = new CisSensor({ seed });
    this.video = new VideoProcessor();
    this.raw = new Float32Array(this.cis.n);
    const whites = [], darks = [];
    for (let k = 0; k < 8; k++) whites.push(Float32Array.from(this.cis.scanLine(null, null, this.raw)));
    for (let k = 0; k < 8; k++) darks.push(Float32Array.from(this.cis.scanLine(null, null, this.raw, { led: false })));
    this.video.calibrate(whites, darks);
    this.ahead = new Map();          // `${id}:${res}` -> { y0, raw }
    this.page = null;
  }

  /** Raw lines read ahead elsewhere (the kit's worker). */
  addRaw(id, res, y0, raw) { this.ahead.set(`${id}:${res}`, { y0, raw }); }
  forget(id) { for (const k of [...this.ahead.keys()]) if (k.startsWith(`${id}:`)) this.ahead.delete(k); }

  /** Start a page: the video stage's mode and its white tracking. */
  begin({ halftone = false, contrast = 'NORMAL' } = {}) {
    this.video.setMode({ mode: halftone ? 'halftone' : 'text', contrast: String(contrast).toLowerCase() === 'dark' ? 'dark' : 'normal' });
    this.video.resetPage();
  }

  /** One packed line (216 bytes) of `page` at feeder pose `pose`. */
  line(page, pose, res) {
    const raw = this.raw;
    const a = this.ahead.get(`${pose.id}:${res}`);
    let got = false;
    if (a) {
      const k = Math.round((pose.y - a.y0) * 1000 * LPMM[res]);
      const n = a.raw.length / this.cis.n;
      if (k >= 0 && k < n && Math.abs(pose.y - (a.y0 + k * 1e-3 / LPMM[res])) < 1e-5) {
        const o = k * this.cis.n;
        for (let i = 0; i < this.cis.n; i++) raw[i] = a.raw[o + i];
        got = true;
      }
    }
    if (!got) this.cis.scanLine(pose.faceDown === false || !page ? null : page, cisPose(pose, res), raw);
    const out = new Uint8Array(STRIDE);
    this.video.process(raw, out, 0);
    return out;
  }
}
