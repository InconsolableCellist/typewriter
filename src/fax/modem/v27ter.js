// V.27ter: differential PSK on an 1800 Hz carrier. 4800 bit/s as eight phases at 1600 baud (tribits), 2400 bit/s as
// four phases at 1200 baud (dibits).
//
// From memory of the Recommendation [M] unless marked:
// - 4800 tribits, phase change (first bit first): 001 0, 000 45, 010 90, 011 135, 111 180, 110 225, 100 270, 101 315
//   degrees. 2400 dibits: 00 90, 01 0, 11 270, 10 180 degrees.
// - Scrambler 1 + x^-6 + x^-7 with the guard against repeating patterns (scrambler.js).
// - Long training for the switched network, with echo-protection tone:
//     segment 1, 185 to 200 ms of unmodulated carrier (185 here);
//     segment 2, 20 ms of silence;
//     segment 3, 14 symbols of continuous 180 degree phase reversals;
//     segment 4, equaliser conditioning: scrambled ones, one scrambler bit a symbol giving a 0 or 180 degree step,
//       1074 symbols at 4800 bit/s and 1158 at 2400 [M: the counts; A: that the scrambler starts from all zeros];
//     segment 5, 8 symbols of scrambled ones at the data rate;
//   then data. About 0.9 s at 4800 and 1.2 s at 2400 including the echo-protection tone.
// - Roll-off: square-root raised cosine, alpha 0.5 at each end [A; the Recommendation states a spectrum, not a filter].
//   4800: 600 to 3000 Hz; 2400: 900 to 2700 Hz.
// - The four 2400 bit/s points sit at 45, 135, 225, 315 degrees, the eight 4800 points at multiples of 45 [A: the
//   modulation is differential, so the absolute phases do not matter to the far end].

import { PskTransmitter, PskReceiver } from './rx-common.js';
import { V27terScrambler, V27terDescrambler } from './scrambler.js';
import { LINE_RATE, MODEM_TX_DBM0 } from '../line/levels.js';

export const V27TER = Object.freeze({
  carrier: 1800, alpha: 0.5, rates: [4800, 2400],
  echoProtectS: 0.185, silenceS: 0.02, seg3: 14, seg5: 8,
  4800: { baud: 1600, bits: 3, seg4: 1074, p0: 0 },
  2400: { baud: 1200, bits: 2, seg4: 1158, p0: 1 },
});

const TRIBIT = Int8Array.from([1, 0, 2, 3, 6, 7, 5, 4]);            // phase change in 45 degree steps, by bits b1 b2 b3
const DIBIT = Int8Array.from([2, 0, 4, 6]);                          // by b1 b2: 00 90, 01 0, 10 180, 11 270
const TRIBIT_INV = new Int8Array(8), DIBIT_INV = new Int8Array(8);
TRIBIT.forEach((c, b) => { TRIBIT_INV[c] = b; });
DIBIT.forEach((c, b) => { DIBIT_INV[c] = b; });

const COS = Float64Array.from({ length: 8 }, (_, p) => Math.cos(p * Math.PI / 4));
const SIN = Float64Array.from({ length: 8 }, (_, p) => Math.sin(p * Math.PI / 4));

function info(rate) {
  const r = V27TER[rate];
  if (!r) throw new Error(`V.27ter has no rate ${rate}`);
  return r;
}

/** Phases (45 degree units) of segments 3 and 4: the receiver's known sequence. */
function knownPhases(rate) {
  const r = info(rate);
  const out = new Int8Array(V27TER.seg3 + r.seg4);
  let p = r.p0, k = 0;
  for (let i = 0; i < V27TER.seg3; i++) { p = (p + 4) & 7; out[k++] = p; }
  const scr = new V27terScrambler();
  for (let i = 0; i < r.seg4; i++) { p = (p + (scr.scramble(1) ? 4 : 0)) & 7; out[k++] = p; }
  return out;
}

class V27terSymbols {
  constructor(rate, source, { echoProtect = true } = {}) {
    const r = info(rate);
    this.r = r; this.rate = rate;
    this.baud = r.baud; this.carrier = V27TER.carrier; this.alpha = V27TER.alpha; this.symbolPower = 1;
    this.source = source;
    this.n1 = echoProtect ? Math.round(V27TER.echoProtectS * r.baud) : 0;
    this.n2 = echoProtect ? Math.round(V27TER.silenceS * r.baud) : 0;
    this.n34 = V27TER.seg3 + r.seg4;
    this.k = 0; this.p = r.p0;
    this.scr = new V27terScrambler();
    this.ended = false; this.got = 0;
  }
  _bit() {
    if (this.k < this.n1 + this.n2 + this.n34 + V27TER.seg5 || this.ended) return this.scr.scramble(1);
    const b = this.source.nextBit();
    if (b < 0) { this.ended = true; return this.scr.scramble(1); }
    this.got++;
    return this.scr.scramble(b);
  }
  nextSymbol(out) {
    const k = this.k;
    if (k < this.n1) { out[0] = COS[this.p]; out[1] = SIN[this.p]; this.k++; return true; }
    if (k < this.n1 + this.n2) { out[0] = 0; out[1] = 0; this.k++; return true; }
    const j = k - this.n1 - this.n2;
    if (j < V27TER.seg3) this.p = (this.p + 4) & 7;
    else if (j < this.n34) this.p = (this.p + (this.scr.scramble(1) ? 4 : 0)) & 7;
    else {
      if (this.ended) return false;
      this.got = 0;
      let c;
      if (this.r.bits === 3) { const a = this._bit(), b = this._bit(), d = this._bit(); c = TRIBIT[a * 4 + b * 2 + d]; }
      else { const a = this._bit(), b = this._bit(); c = DIBIT[a * 2 + b]; }
      if (this.ended && this.got === 0 && j >= this.n34 + V27TER.seg5) return false;
      this.p = (this.p + c) & 7;
    }
    out[0] = COS[this.p]; out[1] = SIN[this.p];
    this.k++;
    return true;
  }
}

class V27terRxProfile {
  constructor(rate) {
    const r = info(rate);
    this.r = r; this.rate = rate;
    this.baud = r.baud; this.carrier = V27TER.carrier; this.alpha = V27TER.alpha; this.symbolPower = 1;
    const ph = knownPhases(rate);
    this.known = { re: Float64Array.from(ph, (p) => COS[p]), im: Float64Array.from(ph, (p) => SIN[p]) };
    this.altLen = V27TER.seg3; this.altMatch = 5;
    this.dataStart = ph.length + V27TER.seg5;
    this.desc = new V27terDescrambler();
    this.prevP = 0;
  }
  slice(re, im, out) {
    const a = Math.atan2(im, re) / (Math.PI / 4);
    let p;
    if (this.r.bits === 3) p = ((Math.round(a) % 8) + 8) % 8;
    else p = ((Math.round((a - 1) / 2) * 2 + 1) % 8 + 8) % 8;
    out[0] = COS[p]; out[1] = SIN[p];
    return p;
  }
  startData(re, im) { this.prevP = ((Math.round(Math.atan2(im, re) / (Math.PI / 4)) % 8) + 8) % 8; }
  decode(p, emit) {
    const c = (p - this.prevP + 8) & 7;
    this.prevP = p;
    if (this.r.bits === 3) { const b = TRIBIT_INV[c]; emit((b >> 2) & 1); emit((b >> 1) & 1); emit(b & 1); }
    else { const b = DIBIT_INV[c]; emit((b >> 1) & 1); emit(b & 1); }
  }
  descramble(b) { return this.desc.descramble(b); }
}

export class V27terTransmitter {
  constructor({ rate = 4800, source, levelDbm0 = MODEM_TX_DBM0, lineRate = LINE_RATE, echoProtect = true } = {}) {
    this.rate = rate;
    this.symbols = new V27terSymbols(rate, source, { echoProtect });
    this.tx = new PskTransmitter(this.symbols, { rate: lineRate, levelDbm0 });
  }
  get done() { return this.tx.done; }
  process(out, offset, n) { return this.tx.process(out, offset, n); }
  static trainingSeconds(rate = 4800, echoProtect = true) {
    const r = info(rate);
    return (echoProtect ? V27TER.echoProtectS + V27TER.silenceS : 0) + (V27TER.seg3 + r.seg4 + V27TER.seg5) / r.baud;
  }
}

export class V27terReceiver {
  constructor({ rate = 4800, sink = {}, lineRate = LINE_RATE, ...opts } = {}) {
    this.rate = rate;
    this.profile = new V27terRxProfile(rate);
    this.rx = new PskReceiver(this.profile, { rate: lineRate, sink, eqSymbols: 10, mu: 0.01, ...opts });
  }
  get stats() { return this.rx.stats; }
  process(x, offset, n) { this.rx.process(x, offset, n); }
}
