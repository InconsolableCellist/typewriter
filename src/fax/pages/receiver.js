// The receiving side of a real page: the T.30 page checker that decodes the received bits with the T.4 decoder
// (src/fax/t4/decode.js) and prints the page through the thermal head (src/fax/thermal/), line by line as the lines
// arrived. It replaces stubChecker as the `checker` option of a T.30 station:
//
//   const rx = thermalReceiver();
//   new T30Answerer({ checker: rx.checker })
//   rx.checker(bits, params) -> { lines, badLines, maxConsecutiveBad, ... }   (what judgePage needs: MCF/RTP/RTN)
//   rx.pages[k] = { params, decoded: { bitmap, height, width, stride, lineErrors }, print: { rows, density, ... } }
//
// Damaged lines are what the decoder makes of them: replaced by the line before and counted (T4Decoder 'repeat'); in
// MR the 2-D lines after one are counted too. The page judgement then follows from those counts in T30Station.
// The FO-70 has no page memory as far as known (plan.md P10), so every page that arrives is printed, an RTN page
// included [A].
//
// Printing: the head's rows are at 7.7 a mm; a standard line is printed twice, a fine line once, a super fine line
// at half the step (15.4 a mm) [A]. Each row's period is the time its line took on the line, from the received
// bits (the distance between EOLs at the signalling rate), split between its rows, and never shorter than the
// mechanism's minimum row time [A]. The strobe comes from defaultStrobeMs and the thermistor.

import { T4Decoder } from '../t4/decode.js';
import { ThermalHead, defaultStrobeMs } from '../thermal/head.js';
import { ThermalPaper } from '../thermal/paper.js';
import { vresOf } from './scan-source.js';

export const PRINT = Object.freeze({ minRowMs: 5, rowsPerLine: { standard: 2, fine: 1, superfine: 1 }, pitchMm: { standard: 1 / 7.7, fine: 1 / 7.7, superfine: 1 / 15.4 } });

/** Index of the first bit of the zero run of the first EOL (eleven or more zeros and a one), or -1. */
export function firstEol(bits) {
  let z = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) { if (z >= 11) return i - z; z = 0; } else z++;
  }
  return -1;
}

/** Bit positions where each EOL ends (the 1 of each EOL), for line timing. */
export function eolEnds(bits, start = 0) {
  const out = [];
  let z = 0;
  for (let i = start; i < bits.length; i++) {
    if (bits[i]) { if (z >= 11) out.push(i); z = 0; } else z++;
  }
  return out;
}

/** Pack 0/1 values MSB first. */
export function packMsb(bits, start = 0) {
  const n = bits.length - start;
  const out = new Uint8Array((n + 7) >>> 3);
  for (let i = 0; i < n; i++) if (bits[start + i]) out[i >>> 3] |= 0x80 >>> (i & 7);
  return out;
}

/**
 * Decode a received page's bits. Returns the decoder's result (copied) and the per-line times in seconds.
 * RTC is taken at four EOLs in a row, not two [A]: with bit errors, two EOLs with nothing between them happen inside
 * a page (a damaged line's fill), and a receiver that took them as RTC would end the page there and print half of
 * it as if nothing were wrong. Four still finds an RTC with one or two of its six EOLs damaged.
 */
export function decodeReceived(bits, params = {}, decoder = null) {
  const coding = params.twoD ? 'mr' : 'mh';
  const dec = decoder && decoder.coding === coding ? decoder : new T4Decoder({ coding, bitOrder: 'msb', damage: 'repeat', rtcEols: 4 });
  const s = firstEol(bits);
  if (s < 0) return { width: dec.width, stride: dec.stride, height: 0, bitmap: new Uint8Array(0), lineErrors: new Uint8Array(0), errorLines: 0, maxConsecutive: 0, rtc: false, lineSeconds: [] };
  const r = dec.decodePage(packMsb(bits, s));
  const rate = params.rate ?? 9600;
  const ends = eolEnds(bits, s);
  const lineSeconds = [];
  for (let k = 0; k + 1 < ends.length && lineSeconds.length < r.height; k++) lineSeconds.push((ends[k + 1] - ends[k]) / rate);
  return { ...r, stride: dec.stride, bitmap: r.bitmap.slice(), lineErrors: r.lineErrors.slice(), lineSeconds };
}

/** Print a decoded page on a head. Returns { rows, width, density (Uint8 0..255 a dot), pitchMm, energyJ, ms }. */
export function printPage(head, decoded, { vres = 'fine', minRowMs = PRINT.minRowMs } = {}) {
  const t0 = now();
  const per = PRINT.rowsPerLine[vres], pitchMm = PRINT.pitchMm[vres];
  const W = decoded.width, rows = decoded.height * per;
  const density = new Uint8Array(W * rows);
  let r = 0, energy = 0;
  for (let y = 0; y < decoded.height; y++) {
    const lineMs = (decoded.lineSeconds[y] ?? 0.01) * 1000;
    const periodMs = Math.max(minRowMs, lineMs / per);
    for (let k = 0; k < per; k++, r++) {
      const strobeMs = defaultStrobeMs(head.thermistorC, vres);
      const out = head.printLine(decoded.bitmap, { off: y * decoded.stride, strobeMs, periodMs, pitchMm });
      const o = r * W;
      for (let i = 0; i < W; i++) { density[o + i] = Math.round(out.density[i] * 255); energy += out.energy[i]; }
    }
  }
  return { rows, width: W, density, pitchMm, energyJ: energy, ms: now() - t0 };
}

/** The receiver: a checker for T30Station, with a thermal head and paper of its own. */
export function thermalReceiver({ head = null, paper = null, print = true } = {}) {
  const h = head ?? new ThermalHead({ paper: paper ?? new ThermalPaper() });
  const rx = {
    head: h,
    pages: [],
    checker(bits, params = {}) {
      const vres = vresOf(params);
      const t0 = now();
      const decoded = decodeReceived(bits, params);
      const decodeMs = now() - t0;
      const pr = print ? printPage(h, decoded, { vres }) : null;
      const result = {
        lines: decoded.height,
        badLines: decoded.errorLines,
        maxConsecutiveBad: decoded.maxConsecutive,
        rtc: decoded.rtc,
      };
      rx.pages.push({ params: { ...params, vres }, decoded, print: pr, result, decodeMs });
      return result;
    },
  };
  return rx;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
