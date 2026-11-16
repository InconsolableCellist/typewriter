// Tone detectors (plan P6): the FO-70's TEL/FAX and answering-machine modes listen for the caller's CNG, and the
// dialler listens for dial tone before dialling and for busy (automatic redial). Also CED, for the caller.
//
// A Goertzel bank on 200-sample blocks (25 ms at 8 kHz; a 40 Hz bin, so 440 and 480 Hz fall in each other's nulls)
// for every frequency of the signatures given. A block "has" a signature when each of its tones is above an absolute
// level, none is more than 9 dB below the strongest of them, and together they carry 60 % of the block's energy.
// Each signature then follows its own on/off runs against its cadence [A: the tolerances below]:
//   continuous tone (cadence null): reported once it has been on for `minOnS` (1 s for dial tone);
//   a single tone with a minimum length (CED): reported once on for `minOnS`;
//   a cadenced tone: reported when an on run and the following off run both match the cadence within 20 % or 60 ms,
//     `cycles` times in a row (busy, reorder, ringback: 1; CNG: an on run of 0.4 to 0.7 s is enough, so it fires at
//     the end of the first burst as an answering fax needs).
// Events: onTone({ name, at }) with `at` the sample count at detection; `present` per signature for the line card.

import { LINE_RATE, dbm0ToPeak } from '../line/levels.js';
import { TONE_PLANS, FAX_TONES } from '../line/tones.js';

const BLOCK = 200;

/** The signatures for a tone plan's call-progress tones and the fax tones. */
export function signatures(plan = TONE_PLANS.na) {
  const f = (spec) => spec.freqs.map((x) => (Array.isArray(x) ? x[0] : x));
  return [
    { name: 'dial', freqs: f(plan.dial), cadence: null, minOnS: 1 },
    { name: 'ringback', freqs: f(plan.ringback), cadence: plan.ringback.cadence.slice(0, 2), cycles: 1 },
    { name: 'busy', freqs: f(plan.busy), cadence: plan.busy.cadence.slice(0, 2), cycles: 1 },
    { name: 'reorder', freqs: f(plan.reorder), cadence: plan.reorder.cadence.slice(0, 2), cycles: 1 },
    { name: 'cng', freqs: f(FAX_TONES.cng), cadence: [0.4, 0.7], burst: true },
    { name: 'ced', freqs: f(FAX_TONES.ced), cadence: null, minOnS: 0.5 },
  ];
}

export class ToneDetector {
  constructor({ rate = LINE_RATE, sigs = signatures(), minDbm0 = -40, onTone = null } = {}) {
    this.rate = rate;
    this.sigs = sigs;
    const fs = [...new Set(sigs.flatMap((s) => s.freqs))];
    this.freqs = Float64Array.from(fs);
    this.coef = Float64Array.from(fs, (f) => 2 * Math.cos(2 * Math.PI * f / rate));
    this.idx = sigs.map((s) => Int32Array.from(s.freqs, (f) => fs.indexOf(f)));
    this.s1 = new Float64Array(fs.length); this.s2 = new Float64Array(fs.length); this.pw = new Float64Array(fs.length);
    this.minP = (dbm0ToPeak(minDbm0) * BLOCK / 2) ** 2;
    this.energy = 0; this.n = 0; this.t = 0;
    const ns = sigs.length;
    this.present = new Uint8Array(ns);
    this.onRun = new Float64Array(ns); this.offRun = new Float64Array(ns); this.lastOn = new Float64Array(ns);
    this.good = new Int32Array(ns); this.fired = new Uint8Array(ns);
    this.onTone = onTone;
    this.events = [];
  }

  reset() { this.fired.fill(0); this.good.fill(0); this.onRun.fill(0); this.offRun.fill(0); this.present.fill(0); }

  process(x, offset, n) {
    const k = this.freqs.length;
    for (let i = 0; i < n; i++) {
      const v = x[offset + i];
      this.energy += v * v;
      for (let j = 0; j < k; j++) { const s = v + this.coef[j] * this.s1[j] - this.s2[j]; this.s2[j] = this.s1[j]; this.s1[j] = s; }
      this.t++;
      if (++this.n === BLOCK) this._block();
    }
  }

  _fire(si) {
    const e = { name: this.sigs[si].name, at: this.t };
    this.events.push(e);
    if (this.onTone) this.onTone(e);
  }

  _block() {
    const k = this.freqs.length, pw = this.pw;
    for (let j = 0; j < k; j++) {
      pw[j] = this.s1[j] * this.s1[j] + this.s2[j] * this.s2[j] - this.coef[j] * this.s1[j] * this.s2[j];
      this.s1[j] = 0; this.s2[j] = 0;
    }
    const energy = this.energy; this.energy = 0; this.n = 0;
    const dt = BLOCK / this.rate, tol = (d) => Math.max(0.2 * d, 0.06);
    for (let si = 0; si < this.sigs.length; si++) {
      const sig = this.sigs[si], ix = this.idx[si];
      let mx = 0, sum = 0, ok = true;
      for (let j = 0; j < ix.length; j++) { mx = Math.max(mx, pw[ix[j]]); sum += pw[ix[j]]; }
      for (let j = 0; j < ix.length; j++) if (pw[ix[j]] < this.minP || pw[ix[j]] * 8 < mx) ok = false;
      if (ok && (2 / BLOCK) * sum < 0.6 * energy) ok = false;
      const was = this.present[si];
      this.present[si] = ok ? 1 : 0;
      if (ok) {
        if (!was) {
          // An on edge closes an off run: check the cycle that just ended.
          if (sig.cadence && !sig.burst) {
            const [on, off] = sig.cadence;
            const match = Math.abs(this.lastOn[si] - on) <= tol(on) && Math.abs(this.offRun[si] - off) <= tol(off);
            this.good[si] = match ? this.good[si] + 1 : 0;
            if (match && this.good[si] >= (sig.cycles || 1) && !this.fired[si]) { this.fired[si] = 1; this._fire(si); }
          }
          this.onRun[si] = 0;
        }
        this.onRun[si] += dt;
        if (!sig.cadence && this.onRun[si] >= sig.minOnS - 1e-9 && !this.fired[si]) { this.fired[si] = 1; this._fire(si); }
      } else {
        if (was) {
          this.lastOn[si] = this.onRun[si]; this.offRun[si] = 0;
          if (sig.burst && this.onRun[si] >= sig.cadence[0] - dt && this.onRun[si] <= sig.cadence[1] + dt) this._fire(si);
          if (!sig.cadence) this.fired[si] = 0;       // a continuous tone may be reported again after a break
        }
        this.offRun[si] += dt;
        if (this.offRun[si] > 10) this.good[si] = 0;
      }
    }
  }
}
