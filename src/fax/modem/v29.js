// V.29: 2400 baud QAM on a 1700 Hz carrier, 9600 bit/s (16 points), 7200 (8) and 4800 (4).
//
// All from memory of the Recommendation [M] unless marked:
// - Constellation: eight phases at multiples of 45 degrees. On the axes the amplitudes are 3 and 5, on the diagonals
//   sqrt(2) and 3 sqrt(2): the points (+-3, 0), (0, +-3), (+-5, 0), (0, +-5), (+-1, +-1), (+-3, +-3).
// - At 9600 the four bits of a symbol are Q1 Q2 Q3 Q4 (Q1 first). Q2 Q3 Q4 give the phase change (Gray coded:
//   001 0, 000 45, 010 90, 011 135, 111 180, 110 225, 100 270, 101 315 degrees); Q1 with the absolute phase gives
//   the amplitude (Q1 = 0 the inner ring: 3 on the axes, sqrt(2) on the diagonals; Q1 = 1 the outer).
// - 7200: Q2 Q3 Q4 only (Q1 = 0, the eight inner points). 4800: Q2 Q3 only, the four points (+-3, 0), (0, +-3), phase
//   changes 0, 90, 180, 270 for 00, 01, 11, 10.
// - Scrambler 1 + x^-18 + x^-23 (scrambler.js).
// - Training: segment 1, 48 symbols of silence; segment 2, 128 symbols alternating A, B; segment 3, 384 symbols of C
//   or D as a 1 + x^-6 + x^-7 sequence started at 0101010 decides (0 gives C, 1 gives D [A]); segment 4, 48 symbols of
//   scrambled ones at the data rate. About 253 ms in all.
//   A = (-3, 0), C = (3, 0) at every rate; B = (3, -3), D = (-3, 3) at 9600; (1, -1), (-1, 1) at 7200; (0, -3),
//   (0, 3) at 4800.
// - Roll-off: square-root raised cosine, alpha 0.25 at each end [A: chosen so the spectrum, 200 to 3200 Hz, fits the
//   channel; the Recommendation gives a spectrum mask, not a filter].
// - Turn-off: none; the carrier simply stops after the last data symbol [A].

import { PskTransmitter, PskReceiver } from './rx-common.js';
import { V29Scrambler, V29Descrambler, Prbs7 } from './scrambler.js';
import { LINE_RATE, MODEM_TX_DBM0 } from '../line/levels.js';

export const V29 = Object.freeze({
  baud: 2400, carrier: 1700, alpha: 0.25, rates: [9600, 7200, 4800],
  seg1: 48, seg2: 128, seg3: 384, seg4: 48,
});

// Phase change, in 45 degree steps, by Q2 Q3 Q4 (index q2 * 4 + q3 * 2 + q4).
export const PHASE_CHANGE = Int8Array.from([1, 0, 2, 3, 6, 7, 5, 4]);
const PHASE_BITS = new Int8Array(8);
PHASE_CHANGE.forEach((c, bits) => { PHASE_BITS[c] = bits; });

/** The point at phase p (0..7, multiples of 45 degrees) on ring q1 (0 inner, 1 outer). */
export function v29Point(p, q1) {
  const axis = (p & 1) === 0;
  const amp = axis ? (q1 ? 5 : 3) : (q1 ? 3 : 1);   // per axis component on the diagonals
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  return [dirs[p][0] * amp, dirs[p][1] * amp];
}

function rateInfo(rate) {
  if (rate === 9600) return { bits: 4, rings: 2, phaseStep: 1, B: [7, 1], D: [3, 1], power: 13.5 };
  if (rate === 7200) return { bits: 3, rings: 1, phaseStep: 1, B: [7, 0], D: [3, 0], power: 5.5 };
  if (rate === 4800) return { bits: 2, rings: 1, phaseStep: 2, B: [6, 0], D: [2, 0], power: 9 };
  throw new Error(`V.29 has no rate ${rate}`);
}
const A_PT = [4, 0], C_PT = [0, 0];

/** The receiver's known training sequence (segments 2 and 3) as phase/ring pairs. */
function trainingSequence(rate) {
  const ri = rateInfo(rate);
  const seq = [];
  for (let i = 0; i < V29.seg2; i++) seq.push(i & 1 ? ri.B : A_PT);
  const prbs = new Prbs7();
  for (let i = 0; i < V29.seg3; i++) seq.push(prbs.next() ? ri.D : C_PT);
  return seq;
}

function knownArrays(rate) {
  const seq = trainingSequence(rate);
  const re = new Float64Array(seq.length), im = new Float64Array(seq.length);
  seq.forEach(([p, q], i) => { const [x, y] = v29Point(p, q); re[i] = x; im[i] = y; });
  return { re, im };
}

/** Transmitter symbol source: training then data from source.nextBit() (0, 1, or -1 at the end). */
class V29Symbols {
  constructor(rate, source, { training = true } = {}) {
    this.rate = rate; this.ri = rateInfo(rate);
    this.baud = V29.baud; this.carrier = V29.carrier; this.alpha = V29.alpha; this.symbolPower = this.ri.power;
    this.source = source;
    this.train = training ? trainingSequence(rate) : [];
    this.k = 0;
    this.scr = new V29Scrambler();
    this.p = 0;              // absolute phase of the last symbol sent
    this.ended = false;
  }
  _bit() {
    // Data bits, after segment 4's ones; the end of the source pads the last symbol with ones.
    if ((this.train.length && this.k < V29.seg1 + this.train.length + V29.seg4) || this.ended) return this.scr.scramble(1);
    const b = this.source.nextBit();
    if (b < 0) { this.ended = true; return this.scr.scramble(1); }
    this.got++;
    return this.scr.scramble(b);
  }
  nextSymbol(out) {
    const k = this.k;
    const t0 = this.train.length ? V29.seg1 : 0;
    if (k < t0) { out[0] = 0; out[1] = 0; this.k++; return true; }
    if (k < t0 + this.train.length) {
      const [p, q] = this.train[k - t0];
      this.p = p;
      const [x, y] = v29Point(p, q); out[0] = x; out[1] = y; this.k++; return true;
    }
    if (this.ended) return false;
    const ri = this.ri;
    const inData = k >= t0 + this.train.length + (this.train.length ? V29.seg4 : 0);
    this.got = 0;
    let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
    if (ri.bits === 4) { q1 = this._bit(); q2 = this._bit(); q3 = this._bit(); q4 = this._bit(); }
    else if (ri.bits === 3) { q2 = this._bit(); q3 = this._bit(); q4 = this._bit(); }
    else { q2 = this._bit(); q3 = this._bit(); q4 = 1 - (q2 ^ q3); }
    if (inData && this.ended && this.got === 0) return false;
    this.p = (this.p + PHASE_CHANGE[q2 * 4 + q3 * 2 + q4]) & 7;
    const [x, y] = v29Point(this.p, q1); out[0] = x; out[1] = y;
    this.k++;
    return true;
  }
}

/** Receiver profile: slicer, differential decoder and descrambler at one rate. */
class V29RxProfile {
  constructor(rate) {
    this.rate = rate; this.ri = rateInfo(rate);
    this.baud = V29.baud; this.carrier = V29.carrier; this.alpha = V29.alpha; this.symbolPower = this.ri.power;
    this.known = knownArrays(rate);
    this.altLen = V29.seg2; this.altMatch = 16;
    this.dataStart = this.known.re.length + V29.seg4;
    // Slicer table.
    const pts = [];
    for (let p = 0; p < 8; p += this.ri.phaseStep) for (let q = 0; q < this.ri.rings; q++) pts.push([p, q]);
    this.np = pts.length;
    this.ptP = Int8Array.from(pts, (x) => x[0]); this.ptQ = Int8Array.from(pts, (x) => x[1]);
    this.ptRe = Float64Array.from(pts, (x) => v29Point(x[0], x[1])[0]);
    this.ptIm = Float64Array.from(pts, (x) => v29Point(x[0], x[1])[1]);
    this.desc = new V29Descrambler();
    this.prevP = 0;
  }
  slice(re, im, out) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.np; i++) {
      const dr = re - this.ptRe[i], di = im - this.ptIm[i], d = dr * dr + di * di;
      if (d < bd) { bd = d; best = i; }
    }
    out[0] = this.ptRe[best]; out[1] = this.ptIm[best];
    return best;
  }
  startData(re, im) { this.prevP = ((Math.round(Math.atan2(im, re) / (Math.PI / 4)) % 8) + 8) % 8; }
  decode(idx, emit) {
    const p = this.ptP[idx], c = (p - this.prevP + 8) & 7;
    this.prevP = p;
    const bits = PHASE_BITS[c];
    if (this.ri.bits === 4) emit(this.ptQ[idx]);
    if (this.ri.bits >= 3) { emit((bits >> 2) & 1); emit((bits >> 1) & 1); emit(bits & 1); }
    else { emit((bits >> 2) & 1); emit((bits >> 1) & 1); }
  }
  descramble(b) { return this.desc.descramble(b); }
}

export class V29Transmitter {
  /** opts.rate 9600 | 7200 | 4800; source { nextBit() }; levelDbm0. */
  constructor({ rate = 9600, source, levelDbm0 = MODEM_TX_DBM0, lineRate = LINE_RATE, training = true } = {}) {
    this.rate = rate;
    this.symbols = new V29Symbols(rate, source, { training });
    this.tx = new PskTransmitter(this.symbols, { rate: lineRate, levelDbm0 });
  }
  get done() { return this.tx.done; }
  process(out, offset, n) { return this.tx.process(out, offset, n); }
  /** Duration of the training in seconds. */
  static trainingSeconds() { return (V29.seg1 + V29.seg2 + V29.seg3 + V29.seg4) / V29.baud; }
}

export class V29Receiver {
  constructor({ rate = 9600, sink = {}, lineRate = LINE_RATE, ...opts } = {}) {
    this.rate = rate;
    this.profile = new V29RxProfile(rate);
    this.rx = new PskReceiver(this.profile, { rate: lineRate, sink, eqSymbols: 12, mu: 0.004, ...opts });
  }
  get stats() { return this.rx.stats; }
  process(x, offset, n) { this.rx.process(x, offset, n); }
}

export { V29Symbols as _V29Symbols, V29RxProfile as _V29RxProfile };
