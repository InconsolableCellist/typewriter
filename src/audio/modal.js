// Acoustic body measured from real recordings (tools/audio, public/assets/audio/SOURCES.md): the contact
// forces of the mechanism excite (a) modal resonators fitted to the recorded decays, and (b) short body
// responses extracted from the recordings, convolved with the force (commuted synthesis). Nothing is
// triggered: every output sample is a linear function of the force history, except that the excitation
// hardens with force (contact stiffening), so a harder hit is brighter as well as louder.
import { PORT } from '../sim/ports.js';
import { THUMP, METAL, BELL, FIR_STRIKE, FIR_MECH, MEASURED_SR, MECH_SCALE, THUMP_SCALE, METAL_LATE_SCALE, BELL_GAIN, PRE_S } from './measured_body.js';

const NP = PORT.COUNT;
// Port -> path couplings. Strike: the slug impact (metal + thump, FIR_STRIKE). Mech: hard-contact clicks.
// Thump: soft felts and carriage stops into the woody low bank. See tools/audio for the calibration.
//                                  SLUG  FELT  PAD   GUIDE BARBAR DOG   UBAR  STOP  BELL  PAWL  RAIL
// The slug has ~0.02 N s of impulse; the soft stops have 5-20 times that at low frequency, so the
// thump couplings are scaled by contact impulse, and the remainder calibrated against the recordings.
const MECH_C  = Float64Array.from([ 0.0,  0.05, 0.8,  0.5,  0.5,   1.0,  0.15, 0.8,  0.0,  1.0,  0.0 ]).map((v) => v * MECH_SCALE);
const THUMP_C = Float64Array.from([ 0.0,  0.15, 0.1,  0.05, 0.03,  0.02, 0.05, 0.6,  0.0,  0.05, 0.0 ]).map((v) => v * THUMP_SCALE);
const METAL_C = Float64Array.from([ 0.0,  0.02, 0.02, 0.1,  0.6,   0.01, 0.05, 0.1,  0.0,  0.05, 0.0 ]).map((v, i) => (i === PORT.BARBAR ? v : v * METAL_LATE_SCALE));

// xorshift noise; deterministic state, no Math.random in the audio path
class Rng { constructor(s) { this.s = s | 0 || 1; } next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x; return (x | 0) / 2147483648; } }

/** A bank of 2-pole resonators, unit impulse amplitude: h[n] = r^n sin(w(n+1)). */
export class Bank {
  constructor(modes, sampleRate, gain = 1) {
    const list = modes.filter((m) => m[0] < 0.46 * sampleRate);
    const n = list.length;
    this.n = n;
    this.a1 = new Float64Array(n);
    this.a2 = new Float64Array(n);
    this.b0 = new Float64Array(n);
    this.g = new Float64Array(n);
    this.shape = new Float64Array(n).fill(1);     // per-mode input weight of the strike point
    this.y1 = new Float64Array(n);
    this.y2 = new Float64Array(n);
    this.phi = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const [f, t60, g] = list[i];
      const w = (2 * Math.PI * f) / sampleRate;
      const r = Math.exp(-6.9078 / (t60 * sampleRate));
      this.a1[i] = 2 * r * Math.cos(w);
      this.a2[i] = -r * r;
      this.b0[i] = Math.sin(w);
      // Modes have arbitrary sign at the excitation and listening points; a coherent sum would be an
      // unnatural spike at t = 0, which the recordings do not have.
      this.g[i] = g * gain * ((i * 0.618034) % 1 < 0.5 ? 1 : -1);
      this.phi[i] = 2.399963 * i;                 // golden angle: uncorrelated mode-shape phases
    }
    this.level = 0;
    this.awake = false;
    this.quiet = 0;
  }

  /** One sample. xs: input weighted by the strike-point shape; x: input shared by all modes. */
  tick(xs, x) {
    const { y1, y2, a1, a2, g, b0, shape, n } = this;
    let out = 0, lev = 0;
    for (let i = 0; i < n; i++) {
      const y0 = b0[i] * (xs * shape[i] + x) + a1[i] * y1[i] + a2[i] * y2[i];
      out += g[i] * y0;
      y2[i] = y1[i];
      y1[i] = y0;
      lev += y0 < 0 ? -y0 : y0;
    }
    this.level = lev;
    return out;
  }

  reset() { this.y1.fill(0); this.y2.fill(0); this.level = 0; }
}

/** Direct-form FIR with a double ring buffer; sleeps once its history has run out. */
export class Fir {
  constructor(h, gain, sampleRate) {
    const sr = sampleRate, N = Math.max(8, Math.round(h.length * sr / MEASURED_SR));
    this.h = new Float64Array(N);
    if (sr === MEASURED_SR) this.h.set(h);
    else for (let i = 0; i < N; i++) {
      const p = i * MEASURED_SR / sr, k = p | 0, u = p - k;
      this.h[i] = (h[k] ?? 0) * (1 - u) + (h[k + 1] ?? 0) * u;
    }
    for (let i = 0; i < N; i++) this.h[i] *= gain;
    this.L = N;
    this.buf = new Float64Array(N * 2);
    this.pos = 0;
    this.left = 0;              // samples of non-zero history remaining
  }

  tick(x) {
    if (x === 0 && this.left === 0) return 0;
    if (x !== 0) this.left = this.L; else this.left--;
    const { L, buf, h } = this;
    let p = this.pos;
    buf[p] = x; buf[p + L] = x;
    p++; if (p >= L) p = 0;
    this.pos = p;
    let out = 0;
    for (let i = 0; i < L; i++) out += h[i] * buf[p + L - 1 - i];
    return out;
  }

  reset() { this.buf.fill(0); this.left = 0; }
}

// Tiny modal set for one bar flexure, so each bar rings at its own (slightly detuned) frequencies.
class BarBank {
  constructor(sampleRate, flex, nBars, seedOffsets) {
    this.nBars = nBars;
    const q = flex.q;
    this.a1 = new Float64Array(nBars * 3);
    this.a2 = new Float64Array(nBars * 3);
    this.b0 = new Float64Array(nBars * 3);
    this.g = new Float64Array(nBars * 3);
    this.y1 = new Float64Array(nBars * 3);
    this.y2 = new Float64Array(nBars * 3);
    this.awake = new Uint8Array(nBars);
    this.quiet = new Int32Array(nBars);
    const freqs = [flex.f1, flex.f2, flex.f2 * 2.76];
    for (let b = 0; b < nBars; b++) {
      for (let i = 0; i < 3; i++) {
        const f = freqs[i] * (1 + seedOffsets[b] * (0.5 + 0.5 * i));
        const t60 = Math.min(0.5, (6.9078 / Math.PI) * q / f);
        const w = (2 * Math.PI * f) / sampleRate;
        const r = Math.exp(-6.9078 / (t60 * sampleRate));
        this.a1[b * 3 + i] = 2 * r * Math.cos(w);
        this.a2[b * 3 + i] = -r * r;
        this.b0[b * 3 + i] = Math.sin(w);
        this.g[b * 3 + i] = (i === 0 ? 0.38 : i === 1 ? 0.55 : 0.32) * 1e-6;
      }
    }
    this.list = new Int32Array(nBars);
    this.nList = 0;
  }

  excite(bar) {
    if (!this.awake[bar]) { this.awake[bar] = 1; this.list[this.nList++] = bar; this.quiet[bar] = 0; }
  }

  tick(forces) {
    const { a1, a2, g, y1, y2, b0, list } = this;
    let n = this.nList, out = 0;
    for (let li = 0; li < n; li++) {
      const b = list[li];
      const x = forces[b];
      let lev = 0;
      for (let m = b * 3; m < b * 3 + 3; m++) {
        const y0 = b0[m] * x + a1[m] * y1[m] + a2[m] * y2[m];
        out += g[m] * y0;
        y2[m] = y1[m]; y1[m] = y0;
        lev += y0 < 0 ? -y0 : y0;
      }
      if (lev < 1e-9 && x === 0) {
        if (++this.quiet[b] > 256) {
          this.awake[b] = 0;
          for (let m = b * 3; m < b * 3 + 3; m++) { y1[m] = 0; y2[m] = 0; }
          list[li] = list[--n]; li--;
        }
      } else this.quiet[b] = 0;
    }
    this.nList = n;
    return out;
  }
}

export class ModalBody {
  constructor({ machine, sampleRate, geometry }) {
    this.sampleRate = sampleRate;
    const f0 = machine.bell.f0;
    const bellModes = BELL.map(([r, t, g]) => [f0 * r, t, g * BELL_GAIN]);
    this.banks = {
      thump: new Bank(THUMP, sampleRate, 1),
      metal: new Bank(METAL, sampleRate, 1),
      bell: new Bank(bellModes, sampleRate, 1),
    };
    // Bar flexure banks are detuned per bar from the bar's condition (skew), stable and machine-specific.
    const detune = Float64Array.from(geometry.bars.map((b) => Math.sin(b.skew * 400)));
    this.bars = new BarBank(sampleRate, machine.typebars.flex, geometry.nPrint, detune.map((d) => d * 0.05));
    this.fStrike = new Fir(FIR_STRIKE, 1, sampleRate);
    this.fMech = new Fir(FIR_MECH, 1, sampleRate);
    this.bankKeys = Object.keys(this.banks);
    this.bankLevels = new Float64Array(this.bankKeys.length);
    this.prevSlug = 0;
    this.prevMech = 0;
    this.xHard = 0;       // current hardening factor (with stochastic wander)
    this.jitG = 0;        // slow multiplicative wander on the strike excitation
    this.rng = new Rng(0x1badf00d);
    this.hard = 0.7;      // contact hardening: fraction of a dF-proportional term per 100 N, keeps dynamics natural
    this.lastShapeX = -1;
    this.lastShapeBar = -1;
    // The measured strike response includes the real pre-impact build-up, so the banks hear the force
    // that much later, keeping the modal onset on the measured main impact.
    this.delayN = Math.max(1, Math.round(PRE_S * sampleRate));
    this.delay = new Float64Array(this.delayN);
    this.delayPos = 0;
  }

  /** With recorded samples in charge, only bar-bar clashes stay on the modal metal bank, so no attack doubles. */
  setSampleMode(b) { this.sampleMode = !!b; }

  /** Update where the slug lands: the body's mode shapes make every strike position spectrally different. */
  setStrikePoint(frac, barIndex) {
    if (Math.abs(frac - this.lastShapeX) < 1e-4 && barIndex === this.lastShapeBar) return;
    this.lastShapeX = frac; this.lastShapeBar = barIndex;
    for (const bank of [this.banks.thump, this.banks.metal]) {
      const { shape, phi, n } = bank;
      for (let i = 0; i < n; i++) {
        const m1 = Math.cos(2 * Math.PI * (i + 1) * 0.37 * frac + phi[i]);
        const m2 = Math.cos(1.7 * barIndex + phi[i] * 1.3);
        shape[i] = 1 + 0.32 * m1 + 0.18 * m2;
      }
    }
  }

  /** Slow mechanical wander, so no two strikes are the same even at the same place and force. */
  wander() {
    this.jitG = this.jitG * 0.992 + 0.08 * this.rng.next();
    this.xHard = 1 + 0.25 * this.jitG;
  }

  /** portsAvg: per-port average force (N) over this audio sample. Returns the radiated pressure (recording units). */
  tick(p) {
    const banks = this.banks;
    // Strike excitation with contact hardening: as the slug force rises, the contact stiffens and pushes
    // more energy into high frequencies. dF comes from the true sim force; the product is quadratic in force.
    const F = p[PORT.SLUG];
    const dF = F - this.prevSlug;
    this.prevSlug = F;
    let xs = 0;
    if (this.sampleMode) {
      const eps = 1e-9;
      const out = this._bank(banks.metal, 0, p[PORT.BARBAR] * METAL_C[PORT.BARBAR], eps);
      return out;
    }
    if (F !== 0 || dF !== 0) xs = (F + this.hard * this.xHard * dF * (Math.abs(F) / 100)) * (1 + 0.15 * this.jitG);
    let xMech = 0, xThumpIn = 0, xMetalIn = 0;
    for (let i = 0; i < NP; i++) {
      const f = p[i];
      if (f === 0) continue;
      xMech += f * MECH_C[i];
      xThumpIn += f * THUMP_C[i];
      xMetalIn += f * METAL_C[i];
    }
    const eps = 1e-9;
    let out = this.fStrike.tick(xs);
    // The hard-contact path is excited by the rate of change of force: it is what radiates the click, and
    // a blunt, soft stop (long smooth pulse) stays dull while a sharp one rings the FIR.
    let dxM = xMech - this.prevMech;
    this.prevMech = xMech;
    // Force changes below about 0.02 N per sample (of the order of -85 dBFS through the FIR) are slow
    // creep of held parts: let the FIR sleep rather than convolve inaudible motion.
    if (dxM < 0.02 * MECH_SCALE && dxM > -0.02 * MECH_SCALE) dxM = 0;
    out += this.fMech.tick(dxM);
    const xd = this.delay[this.delayPos];
    this.delay[this.delayPos] = xs;
    if (++this.delayPos >= this.delayN) this.delayPos = 0;
    out += this._bank(banks.thump, xd, xThumpIn, eps);
    out += this._bank(banks.metal, xd, xMetalIn, eps);
    out += this._bank(banks.bell, 0, p[PORT.BELL], eps);
    return out;
  }

  _bank(b, xs, x, eps) {
    if (!b.awake) {
      if (x === 0 && xs === 0) return 0;
      b.awake = true; b.quiet = 0;
    }
    const y = b.tick(xs, x);
    if (x === 0 && xs === 0 && b.level < eps) {
      if (++b.quiet > 256) { b.awake = false; b.reset(); }
    } else b.quiet = 0;
    return y;
  }

  barTick(forces) { return this.bars.tick(forces); }
  exciteBar(i) { this.bars.excite(i); }
}
