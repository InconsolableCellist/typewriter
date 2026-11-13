// The running Displaywriter's idle sound, generated (architecture.md 10.4 item 4): the tones and the noise floor measured
// in the owner's recording (tools/audio/analyze_wp_hum.py, src/audio/wp-hum-data.js), rebuilt as a sum of sinusoids
// and of white noise through a bank of band-pass filters fitted to the floor's third-octave envelope. Each tone's level
// and frequency, and each noise band's level, wander slowly at random (Ornstein-Uhlenbeck, a few seconds' memory), so
// nothing repeats; the 100 Hz family of the line's magnetostriction wanders together, as the line does. It replaces the
// two 4 s loops cut from the recording, which carried the room's rustling and repeated audibly.
//
// Two voices, split at the recording's 450 Hz as the loops were: the drive motors (the twice-line hum and the motors'
// tones, scaled to this machine's line frequency) and the fans' air. Everything is allocated in the constructor; fill()
// is the per-block path and only reads and writes typed arrays.
import { HUM } from './wp-hum-data.js';

const TAU = 2 * Math.PI;
const Q = 1.6;                  // the noise bank's band-pass filters: one every 2/3 octave, overlapping
const NOISE_VAR = 1 / 3;        // uniform noise in [-1, 1)
const FIT_ITERS = 400;

/** xorshift32 step; returns the new state. */
const xs = (x) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x; };

/** RBJ band pass, 0 dB at the centre: [b0, b2, a1, a2] (b1 = 0). */
function bandPass(f, sr) {
  const w = (TAU * f) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al;
  return [al / a0, -al / a0, (-2 * c) / a0, (1 - al) / a0];
}
/** |H(f)|^2 of that filter. */
function power(cf, f, sr) {
  const w = (TAU * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = cf[0] + cf[1] * c2, ni = -cf[1] * s2;
  const dr = 1 + cf[2] * c1 + cf[3] * c2, di = -cf[2] * s1 - cf[3] * s2;
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}
/** Noise power the filter passes between f0 and f1 (Hz), for unit-gain uniform noise. */
function bandPower(cf, f0, f1, sr, pts = 24) {
  const psd = NOISE_VAR / (sr / 2);
  let s = 0, fp = f0, pp = power(cf, f0, sr);
  for (let k = 1; k <= pts; k++) {
    const f = f0 * (f1 / f0) ** (k / pts), p = power(cf, f, sr);
    s += 0.5 * (p + pp) * (f - fp); fp = f; pp = p;
  }
  return s * psd;
}

/**
 * A voice's noise bank: a band pass every other third-octave band (and at the last), its squared gains fitted to the
 * floor's band powers (in dB, each filter on its own band), then all set so that the bank's
 * whole output has the floor's power. Filters left with nothing to do are dropped.
 */
export function fitBank(list, sr, scale) {
  const bands = list.filter((b) => b.hz * 2 ** (1 / 6) < 0.49 * sr);
  const centres = bands.map((b) => b.hz).filter((_, k) => k % 2 === 0 || k === bands.length - 1);
  const cfs = centres.map((f) => bandPass(f, sr));
  const T = bands.map((b) => 10 ** (b.db / 10));
  const A = bands.map((b) => cfs.map((cf) => bandPower(cf, b.hz * 2 ** (-1 / 6), b.hz * 2 ** (1 / 6), sr)));
  const own = centres.map((f) => bands.findIndex((x) => x.hz === f));
  const g2 = centres.map((_, k) => T[own[k]] / A[own[k]][k]);
  for (let it = 0; it < FIT_ITERS; it++) {
    // Each filter moves its gain by half the error, in dB, at its own band (its neighbours pass a third as much there).
    const M = A.map((row) => row.reduce((s, a, k) => s + a * g2[k], 0));
    for (let k = 0; k < g2.length; k++) g2[k] *= Math.sqrt(T[own[k]] / M[own[k]]);
  }
  const total = cfs.map((cf) => bandPower(cf, 5, 0.499 * sr, sr, 4000));
  const want = T.reduce((s, x) => s + x, 0), got = g2.reduce((s, x, k) => s + x * total[k], 0), norm = want / got;
  const filters = centres.map((f, k) => ({ f, cf: cfs[k], gain: scale * Math.sqrt(g2[k] * norm), power: g2[k] * norm * total[k] }))
    .filter((F) => F.power > 1e-6 * want);
  return {
    filters, power: filters.reduce((s, F) => s + F.power, 0),
    fit: { centres, bands: bands.map((b) => b.hz), target: T, model: A.map((row) => row.reduce((s, a, k) => s + a * g2[k] * norm, 0)) },
  };
}

/** One voice: tones and noise bands, with their wander. */
class HumVoice {
  constructor(tones, filters, sr, rate, seed, W) {
    const nt = tones.length, nf = filters.length;
    this.sr = sr; this.nt = nt; this.nf = nf;
    this.f0 = new Float64Array(nt); this.a0 = new Float64Array(nt); this.mainsTone = new Uint8Array(nt);
    this.c = new Float64Array(nt); this.s = new Float64Array(nt); this.kc = new Float64Array(nt); this.ks = new Float64Array(nt);
    this.amp = new Float64Array(nt); this.dAmp = new Float64Array(nt);
    this.xa = new Float64Array(nt); this.xf = new Float64Array(nt);
    this.rng = seed >>> 0 || 1;
    for (let i = 0; i < nt; i++) {
      const t = tones[i];
      this.f0[i] = t.hz * rate; this.a0[i] = t.amp;
      this.mainsTone[i] = t.mains ? 1 : 0;
      const ph = TAU * this.uni();
      this.c[i] = Math.cos(ph); this.s[i] = Math.sin(ph);
      this.xa[i] = this.gauss(); this.xf[i] = this.gauss();
      this.amp[i] = t.amp * Math.exp(this.kAmp(W) * this.xa[i]);
    }
    this.b0 = new Float64Array(nf); this.b2 = new Float64Array(nf); this.a1 = new Float64Array(nf); this.a2 = new Float64Array(nf);
    this.z1 = new Float64Array(nf); this.z2 = new Float64Array(nf); this.g0 = new Float64Array(nf); this.g = new Float64Array(nf);
    this.xb = new Float64Array(nf);
    for (let k = 0; k < nf; k++) {
      const F = filters[k];
      [this.b0[k], this.b2[k], this.a1[k], this.a2[k]] = F.cf;
      this.g0[k] = F.gain; this.xb[k] = this.gauss(); this.g[k] = F.gain;
    }
    // A noise stream for each filter, so their overlapping skirts add as power, as the fit assumes.
    this.ns = new Int32Array(nf);
    for (let k = 0; k < nf; k++) this.ns[k] = (Math.imul(seed, 2654435761) + Math.imul(k + 1, 40503)) | 0 || 1;
    this.W = W; this.xm = this.gauss();
    this.power = 0;              // the voice's mean power, analytic, at unit gain and no wander
    this.blockN = 0; this.eA = 0; this.eF = 0; this.eB = 0; this.eM = 0;
    this.setBlock(128);
  }

  kAmp(W) { return (W.ampDb * Math.LN10) / 20; }
  uni() { this.rng = xs(this.rng); return (this.rng >>> 0) / 4294967296; }
  /** Unit normal, near enough: the sum of four uniforms. */
  gauss() { return (this.uni() + this.uni() + this.uni() + this.uni() - 2) * Math.sqrt(3); }

  setBlock(n) {
    const W = this.W, dt = n / this.sr;
    this.blockN = n;
    this.eA = Math.exp(-dt / W.ampTauS); this.eF = Math.exp(-dt / W.freqTauS);
    this.eB = Math.exp(-dt / W.bandTauS); this.eM = Math.exp(-dt / W.freqTauS);
  }

  /** The wander, once a block: new targets for the tones' levels and the bands' gains, new tone frequencies. */
  block(n) {
    if (n !== this.blockN) this.setBlock(n);
    const W = this.W, kA = this.kAmp(W), kB = (W.bandDb * Math.LN10) / 20, sr = this.sr, inv = 1 / n;
    const sA = Math.sqrt(1 - this.eA * this.eA), sF = Math.sqrt(1 - this.eF * this.eF), sB = Math.sqrt(1 - this.eB * this.eB);
    this.xm = this.xm * this.eM + Math.sqrt(1 - this.eM * this.eM) * this.gauss();
    for (let i = 0; i < this.nt; i++) {
      const xa = (this.xa[i] = this.xa[i] * this.eA + sA * this.gauss());
      const target = this.a0[i] * Math.exp(kA * xa);
      this.dAmp[i] = (target - this.amp[i]) * inv;
      let df;
      if (this.mainsTone[i]) df = W.mainsFreqRel * this.xm;
      else df = W.freqRel * (this.xf[i] = this.xf[i] * this.eF + sF * this.gauss());
      const w = (TAU * this.f0[i] * (1 + df)) / sr;
      this.kc[i] = Math.cos(w); this.ks[i] = Math.sin(w);
      const m = 1 / Math.sqrt(this.c[i] * this.c[i] + this.s[i] * this.s[i]);
      this.c[i] *= m; this.s[i] *= m;
    }
    for (let k = 0; k < this.nf; k++) {
      const xb = (this.xb[k] = this.xb[k] * this.eB + sB * this.gauss());
      this.g[k] = this.g0[k] * Math.exp(kB * xb);
    }
  }

  /** n samples of the voice into out[o..o+n), at unit gain (the recorded level times the hum's scale). */
  fill(out, o, n) {
    this.block(n);
    const { c, s, kc, ks, amp, dAmp, b0, b2, a1, a2, z1, z2, g, ns } = this, nt = this.nt, nf = this.nf;
    for (let j = 0; j < n; j++) {
      let y = 0;
      for (let i = 0; i < nt; i++) {
        const ci = c[i], si = s[i], kci = kc[i], ksi = ks[i];
        c[i] = ci * kci - si * ksi;
        const sn = si * kci + ci * ksi;
        s[i] = sn;
        y += amp[i] * sn;
        amp[i] += dAmp[i];
      }
      for (let k = 0; k < nf; k++) {
        let x = ns[k]; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; ns[k] = x;
        const u = (x / 2147483648) * g[k];
        const v = b0[k] * u + z1[k];
        z1[k] = -a1[k] * v + z2[k];
        z2[k] = b2[k] * u - a2[k] * v;
        y += v;
      }
      out[o + j] = y;
    }
  }
}

/**
 * The idle machine: `motor` and `fan` voices. sr: sample rate; mainsHz: this machine's line (the motors' tones play at
 * mainsHz / recorded mains); scale: output amplitude of one unit of the recording; data: wp-hum-data.js's HUM.
 */
export class WpHum {
  constructor(sr, { mainsHz = 60, scale = 1, data = HUM, seed = 0x48554d31 } = {}) {
    this.data = data; this.sr = sr;
    const W = data.wander, rate = mainsHz / data.recordedMainsHz;
    const amp = (db) => scale * Math.sqrt(2 * 10 ** (db / 10));
    const tonesOf = (v, r) => v.tones.filter((t) => t.hz * r < 0.45 * sr).map((t) => ({
      hz: t.hz, amp: amp(t.db), mains: Math.abs(t.hz / 100 - Math.round(t.hz / 100)) < 0.005,
    }));
    this.fit = {};
    const voice = (name, r, sd) => {
      const v = data[name], fl = fitBank(v.bands, sr, scale), tn = tonesOf(v, r);
      this.fit[name] = fl.fit;
      const h = new HumVoice(tn, fl.filters, sr, r, sd, W);
      h.power = scale * scale * (fl.power + tn.reduce((s, t) => s + (t.amp / scale) ** 2 / 2, 0));
      return h;
    };
    this.motor = voice('motor', rate, seed);
    this.fan = voice('fan', 1, seed ^ 0x2f6b13a9);
  }
}
