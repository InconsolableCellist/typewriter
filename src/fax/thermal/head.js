// The FO-70's thermal line head (docs/fax/plan.md 2, "Head frame unit and thermal head"): 1728 resistive dots at
// 8 a mm, strobed in 4 blocks of 432 [A: the block count is the ROHM format the plan names; the FO-70's head is
// not identified]. Integrated once per printed line, not per substep. Pure module; state allocated once.
//
// Per dot, two thermal states (lumped):
//   Th  the heater and the glaze over it, capacity Ch, to the substrate through Ghs, to the paper through Ghp;
//   Tp  the paper surface under the dot, capacity Cp, to the paper's bulk and the platen (ambient) through Gpb.
//     Ch dTh/dt = P - Ghs (Th - Ts) - Ghp (Th - Tp)
//     Cp dTp/dt = Ghp (Th - Tp) - Gpb (Tp - Ta)
//   Linear with constant inputs over each phase, so a phase is stepped EXACTLY by its matrix exponential:
//   x+ = Phi x + Psi c, Phi = exp(A dt), Psi = A^-1 (Phi - I). A line is, for the dots of block b: the paper
//   step, a wait while the blocks before b fire, b's strobe (sub-stepped to find the peak of Tp), a short
//   after-strobe stretch (sub-stepped: the paper's peak lags the heater's), then cooling to the next line.
//   Heat history is the heater's temperature carried from line to line, and the paper that stays under the dot
//   when the step is shorter than the heater (dotLenMm): the carried fraction is 1 - pitch / dotLen.
//   Ts the substrate (heat sink), common to the head: it gains the heat the heaters lose to it and cools to the
//     room with time constant tauS. A thermistor on it reads it with a lag, in 0.5 degree steps: the firmware's
//     only view of the head's temperature, for the strobe time.
// Supply sag: the dots of a block are in parallel on a supply with source resistance Rs, so with n dots on the
//   block sees V = Vs * R / (R + n Rs). Many dots on print lighter.
// Out per line: the density each dot left on the paper (paper.js, from the peak of Tp), and the energy each dot took
//   (joules), which the sound of the head is made from.
// Not modelled: lateral conduction between dots, the head's pressure profile, the paper's own thickness variation.

import { ThermalPaper } from './paper.js';

/** The head's constants. All assumed [A], tuned so a black area is solid at the default strobe and the first white
 * line after a black area keeps a faint trace (the "smear" of real thermal faxes); tools/fax/render_fax.mjs and
 * tests/fax_thermal.test.js state the results. */
export const HEAD_CAL = Object.freeze({
  dots: 1728,
  blocks: 4,
  pitchMm: 0.125,
  dotLenMm: 0.16,       // heater length along the feed [A]
  R: 700,               // ohms per dot [A]
  Vs: 12,               // supply volts [A]
  Rs: 0.15,             // supply and common-lead resistance, ohms [A]
  Ch: 1.2e-6,           // J/K heater and glaze [A]
  Ghs: 0.8e-4,          // W/K heater to substrate [A]
  Ghp: 0.9e-4,          // W/K heater to paper [A]
  Cp: 1.4e-7,           // J/K paper surface under a dot [A]
  Gpb: 1.0e-4,          // W/K paper surface to bulk and platen [A]
  Cs: 25,               // J/K substrate and heat sink [A]
  tauS: 90,             // s substrate to room [A]
  tauThermistor: 1.5,   // s [A]
  ambient: 25,          // degrees C
  strobeSteps: 6,
  afterSteps: 6,
  afterMs: 1.5,
});

/** The default strobe the print controller uses: per the thermistor, shorter in super fine [A]. ms. */
export const STROBE = Object.freeze({ baseMs: 1.45, refC: 25, perC: 0.010, superFine: 0.90, minMs: 0.4, maxMs: 2.5 });

export function defaultStrobeMs(thermistorC, vres = 'fine', s = STROBE) {
  let t = s.baseMs * (1 - s.perC * (thermistorC - s.refC));
  if (vres === 'superfine') t *= s.superFine;
  return t < s.minMs ? s.minMs : t > s.maxMs ? s.maxMs : t;
}

export class ThermalHead {
  constructor({ paper = new ThermalPaper(), ...o } = {}) {
    const c = { ...HEAD_CAL, ...o };
    this.c = c;
    this.paper = paper;
    this.n = c.dots;
    this.blockSize = c.dots / c.blocks;
    this.Th = new Float64Array(this.n).fill(c.ambient);
    this.Tp = new Float64Array(this.n).fill(c.ambient);
    this.peak = new Float64Array(this.n);
    this.density = new Float32Array(this.n);
    this.energy = new Float32Array(this.n);
    this.Ts = c.ambient;
    this.thermistorRaw = c.ambient;
    this.on = new Uint8Array(this.n);
    this.blockOn = new Int32Array(c.blocks);
    this.blockV = new Float64Array(c.blocks);
    this.ph = new Float64Array(8);     // scratch phase: Phi (4), Psi (4)
    this.uOn = new Float64Array(2); this.uOff = new Float64Array(2);
    this.time = 0;
    const A = this.A = new Float64Array(4);
    A[0] = -(c.Ghs + c.Ghp) / c.Ch; A[1] = c.Ghp / c.Ch;
    A[2] = c.Ghp / c.Cp; A[3] = -(c.Ghp + c.Gpb) / c.Cp;
  }

  /** The thermistor reading, degrees C (0.5 degree steps). */
  get thermistorC() { return Math.round(this.thermistorRaw * 2) / 2; }

  /** Phi and Psi of a phase of dt seconds into this.ph. */
  _phase(dt) {
    const A = this.A, ph = this.ph;
    const a = A[0] * dt, b = A[1] * dt, c = A[2] * dt, d = A[3] * dt;
    const s = (a + d) / 2, q = Math.sqrt(((a - d) * (a - d)) / 4 + b * c);
    const es = Math.exp(s), ch = Math.cosh(q), sh = q > 1e-12 ? Math.sinh(q) / q : 1;
    ph[0] = es * (ch + sh * (a - s)); ph[1] = es * sh * b;
    ph[2] = es * sh * c; ph[3] = es * (ch + sh * (d - s));
    // Psi = A^-1 (Phi - I)
    const det = A[0] * A[3] - A[1] * A[2];
    const i0 = A[3] / det, i1 = -A[1] / det, i2 = -A[2] / det, i3 = A[0] / det;
    const m0 = ph[0] - 1, m1 = ph[1], m2 = ph[2], m3 = ph[3] - 1;
    ph[4] = i0 * m0 + i1 * m2; ph[5] = i0 * m1 + i1 * m3;
    ph[6] = i2 * m0 + i3 * m2; ph[7] = i2 * m1 + i3 * m3;
  }

  /** Inputs of the phase for a dot with power P: Psi c. */
  _inputs(P, out) {
    const k = this.c, ph = this.ph;
    const c0 = (P + k.Ghs * this.Ts) / k.Ch, c1 = (k.Gpb * k.ambient) / k.Cp;
    out[0] = ph[4] * c0 + ph[5] * c1;
    out[1] = ph[6] * c0 + ph[7] * c1;
  }

  /** Step dots [i0, i1) through a phase of dt; `power` for the dots that are on; track the paper's peak. */
  _run(i0, i1, dt, power, track) {
    this._phase(dt);
    this._inputs(0, this.uOff);
    if (power > 0) this._inputs(power, this.uOn);
    const ph = this.ph, Th = this.Th, Tp = this.Tp, on = this.on, pk = this.peak;
    const p0 = ph[0], p1 = ph[1], p2 = ph[2], p3 = ph[3];
    for (let i = i0; i < i1; i++) {
      const u = power > 0 && on[i] ? this.uOn : this.uOff;
      const h = Th[i], p = Tp[i];
      Th[i] = p0 * h + p1 * p + u[0];
      const np = p2 * h + p3 * p + u[1];
      Tp[i] = np;
      if (track && np > pk[i]) pk[i] = np;
    }
  }

  /**
   * Print one line. `row` is a packed row (MSB first, 1 = black; 216 bytes at off). Options: strobeMs (a number or
   * one per block), periodMs (from this line's start to the next's), pitchMm (the paper step before this line).
   * Returns { density, energy, volts, dotsOn } (the arrays are this head's, valid until the next call).
   */
  printLine(row, { off = 0, strobeMs = defaultStrobeMs(this.thermistorC), periodMs = 10, pitchMm = 1 / 7.7 } = {}) {
    const c = this.c, n = this.n, B = c.blocks, bs = this.blockSize;
    // the paper steps: what stays under the dot keeps part of its heat
    const carry = Math.max(0, 1 - pitchMm / c.dotLenMm);
    for (let i = 0; i < n; i++) {
      this.Tp[i] = c.ambient + (this.Tp[i] - c.ambient) * carry;
      this.peak[i] = this.Tp[i];
      this.on[i] = (row[off + (i >>> 3)] >>> (7 - (i & 7))) & 1;
    }
    this.blockOn.fill(0);
    for (let i = 0; i < n; i++) if (this.on[i]) this.blockOn[(i / bs) | 0]++;
    let offset = 0, eTotal = 0, eSub = 0;
    let dotsOn = 0;
    const period = periodMs / 1000;
    for (let b = 0; b < B; b++) {
      const tS = (typeof strobeMs === 'number' ? strobeMs : strobeMs[b]) / 1000;
      const i0 = b * bs, i1 = i0 + bs;
      const nOn = this.blockOn[b];
      dotsOn += nOn;
      const V = (c.Vs * c.R) / (c.R + nOn * c.Rs);
      this.blockV[b] = V;
      const P = (V * V) / c.R;
      for (let i = i0; i < i1; i++) this.energy[i] = this.on[i] ? P * tS : 0;
      eTotal += nOn * P * tS;
      if (offset > 0) this._run(i0, i1, offset, 0, false);
      if (nOn > 0) for (let k = 0; k < c.strobeSteps; k++) this._run(i0, i1, tS / c.strobeSteps, P, true);
      else this._run(i0, i1, tS, 0, true);
      const after = Math.min(c.afterMs / 1000, Math.max(0, period - offset - tS));
      for (let k = 0; k < c.afterSteps && after > 0; k++) this._run(i0, i1, after / c.afterSteps, 0, true);
      const rest = period - offset - tS - after;
      if (rest > 0) this._run(i0, i1, rest, 0, false);
      offset += tS;
    }
    for (let i = 0; i < n; i++) this.density[i] = this.paper.mark(this.peak[i]);
    // the substrate takes the heaters' share of the energy, then cools; the thermistor follows it
    eSub = eTotal * (c.Ghs / (c.Ghs + c.Ghp));
    this._substrate(period, eSub);
    return { density: this.density, energy: this.energy, volts: this.blockV, dotsOn };
  }

  _substrate(dt, joules) {
    const c = this.c;
    this.Ts += joules / c.Cs;
    this.Ts = c.ambient + (this.Ts - c.ambient) * Math.exp(-dt / c.tauS);
    this.thermistorRaw += (this.Ts - this.thermistorRaw) * (1 - Math.exp(-dt / c.tauThermistor));
    this.time += dt;
  }

  /** Let the head stand unpowered for `seconds` (the paper does not move). */
  idle(seconds) {
    if (!(seconds > 0)) return;
    this._run(0, this.n, seconds, 0, false);
    this._substrate(seconds, 0);
  }

  /** Mean heater temperature, for tests and the renderer's heat shimmer if wanted. */
  meanHeaterC() { let s = 0; for (let i = 0; i < this.n; i++) s += this.Th[i]; return s / this.n; }
}
