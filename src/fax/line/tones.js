// Call-progress and fax tones as sums of sines with cadences, at the line rate.
//
// North America, the precise tone plan (decision 5):
//   dial tone 350 + 440 Hz at -13 dBm0 a tone, continuous                      [S WP-PTP]
//   audible ringing (ringback) 440 + 480 Hz at -19 dBm0, 2 s on, 4 s off      [S frequencies and cadence; M level]
//   busy 480 + 620 Hz at -24 dBm0, 0.5 s on, 0.5 s off                         [S frequencies and cadence; M level]
//   reorder 480 + 620 Hz at -24 dBm0, 0.25 s on, 0.25 s off                    [S]
//   receiver off-hook (ROH) warning 1400 + 2060 + 2450 + 2600 Hz, 0.1 s on, 0.1 s off   [M; level A: -3 dBm0 a tone
//     on the codec here; the real tone is louder still and applied after the codec]
//   ringing current 20 Hz, about 90 V rms, 2 s on, 4 s off                     [S WP-PTP: 60 to 105 V at 20 Hz]
//   frequencies within 0.5 % [S]; ours are exact.
// T.30 phase A:
//   CNG 1100 Hz, 0.5 s on, 3 s off, from the caller [S search summary]
//   CED 2100 Hz for 2.6 to 4 s, from the answerer, once [S]; 3.3 s here [A, the middle of the range]
//   CNG and CED at the modem level, -10 dBm0 [A].
// On and off edges are shaped with a 2 ms raised-cosine ramp [A] so the switching is a click no louder than a real
// exchange's.
//
// Pure, block based: a ToneSource adds its samples into a buffer; its time is the count of samples it has made.

import { LINE_RATE, dbm0ToPeak, MODEM_TX_DBM0 } from './levels.js';

/** The fax tones of T.30, the same in every country. */
export const FAX_TONES = Object.freeze({
  cng: { freqs: [1100], dbm0: MODEM_TX_DBM0, cadence: [0.5, 3], repeat: true },
  ced: { freqs: [2100], dbm0: MODEM_TX_DBM0, cadence: [3.3, 0], repeat: false },
});

/**
 * Tone plans by market (plan P7): the call-progress tones, the ringing cadence and the companding law are data, so
 * the exchange changes market by changing the table. `na` is the default (decision 5) and the only one with sources
 * behind it (WP-PTP); the others are from memory [M] and are there to keep the exchange table-driven. A frequency
 * written [f, m] is f modulated by m (Australia's 425 x 25 Hz). `ring` is the cadence of the ringing current at the
 * called line, seconds on, off, on, off ...
 */
export const TONE_PLANS = Object.freeze({
  na: {
    name: 'North America (precise tone plan)', law: 'ulaw', ringHz: 20, ringVrms: 90, ring: [2, 4],
    dial: { freqs: [350, 440], dbm0: -13, cadence: null },
    ringback: { freqs: [440, 480], dbm0: -19, cadence: [2, 4], repeat: true },
    busy: { freqs: [480, 620], dbm0: -24, cadence: [0.5, 0.5], repeat: true },
    reorder: { freqs: [480, 620], dbm0: -24, cadence: [0.25, 0.25], repeat: true },
    offHookWarning: { freqs: [1400, 2060, 2450, 2600], dbm0: -3, cadence: [0.1, 0.1], repeat: true },
  },
  cept: {   // [M] the common European plan (Germany and others)
    name: 'Europe (CEPT 425 Hz)', law: 'alaw', ringHz: 25, ringVrms: 75, ring: [1, 4],
    dial: { freqs: [425], dbm0: -10, cadence: null },
    ringback: { freqs: [425], dbm0: -10, cadence: [1, 4], repeat: true },
    busy: { freqs: [425], dbm0: -10, cadence: [0.48, 0.48], repeat: true },
    reorder: { freqs: [425], dbm0: -10, cadence: [0.24, 0.24], repeat: true },
    offHookWarning: { freqs: [425], dbm0: -3, cadence: [0.2, 0.2], repeat: true },
  },
  au: {     // [M] Australia: 425 Hz modulated by 25 Hz for dial tone and ringback
    name: 'Australia', law: 'alaw', ringHz: 25, ringVrms: 75, ring: [0.4, 0.2, 0.4, 2],
    dial: { freqs: [[425, 25]], dbm0: -10, cadence: null },
    ringback: { freqs: [[425, 25]], dbm0: -13, cadence: [0.4, 0.2, 0.4, 2], repeat: true },
    busy: { freqs: [425], dbm0: -13, cadence: [0.375, 0.375], repeat: true },
    reorder: { freqs: [425], dbm0: -13, cadence: [0.375, 0.375], repeat: true },
    offHookWarning: { freqs: [425], dbm0: -3, cadence: [0.2, 0.2], repeat: true },
  },
});

/** The North American tones and the fax tones under one name (tests and tools). */
export const TONES = Object.freeze({
  dial: TONE_PLANS.na.dial, ringback: TONE_PLANS.na.ringback, busy: TONE_PLANS.na.busy,
  reorder: TONE_PLANS.na.reorder, offHookWarning: TONE_PLANS.na.offHookWarning, ...FAX_TONES,
});

export const RAMP_S = 0.002;

export class ToneSource {
  /** spec: a tone entry as above; opts.rate; opts.duration (s) ends a tone after that time. */
  constructor(spec, { rate = LINE_RATE, duration = Infinity } = {}) {
    this.rate = rate;
    this.freqs = Float64Array.from(spec.freqs, (f) => (Array.isArray(f) ? f[0] : f));
    this.mods = Float64Array.from(spec.freqs, (f) => (Array.isArray(f) ? f[1] : 0));
    this.amps = Float64Array.from(spec.freqs, (_, i) => dbm0ToPeak(Array.isArray(spec.dbm0) ? spec.dbm0[i] : spec.dbm0));
    this.phase = new Float64Array(spec.freqs.length);
    this.modPhase = new Float64Array(spec.freqs.length);
    this.cad = spec.cadence ? Int32Array.from(spec.cadence, (s) => Math.round(s * rate)) : null;
    this.repeat = !!spec.repeat;
    this.limit = Number.isFinite(duration) ? Math.round(duration * rate) : Infinity;
    this.ramp = Math.max(1, Math.round(RAMP_S * rate));
    this.t = 0;              // samples made
    this.seg = 0; this.segT = 0;
    this.stopping = -1;      // samples left in a stop ramp
    this.done = false;
  }

  /** Starts the stop ramp; done once it ends. */
  stop() { if (!this.done && this.stopping < 0) this.stopping = this.ramp; }

  /** Gate (0..1) for the current sample; advances the cadence. */
  _gate() {
    if (this.t >= this.limit && this.stopping < 0) this.stopping = this.ramp;
    let g = 1;
    if (this.cad) {
      const len = this.cad[this.seg];
      const on = (this.seg & 1) === 0;
      if (!on) g = 0;
      else {
        const r = this.ramp;
        if (this.segT < r) g = 0.5 - 0.5 * Math.cos(Math.PI * this.segT / r);
        else if (len - this.segT <= r) g = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, len - this.segT) / r);
      }
      if (++this.segT >= len) {
        this.segT = 0;
        this.seg++;
        if (this.seg >= this.cad.length) {
          if (this.repeat) this.seg = 0;
          else { this.seg = this.cad.length - 1; this.done = true; }
        }
      }
    } else if (this.t < this.ramp) g = 0.5 - 0.5 * Math.cos(Math.PI * this.t / this.ramp);
    if (this.stopping >= 0) {
      g *= 0.5 - 0.5 * Math.cos(Math.PI * this.stopping / this.ramp);
      if (this.stopping-- === 0) this.done = true;
    }
    this.t++;
    return g;
  }

  /** True while the cadence is in an "on" segment. */
  get on() { return !this.cad || (this.seg & 1) === 0; }

  /** Adds n samples into out[offset..]. */
  process(out, offset, n) {
    const k = this.freqs.length, w = 2 * Math.PI / this.rate, TWO_PI = 2 * Math.PI;
    for (let i = 0; i < n; i++) {
      if (this.done) return;
      const g = this._gate();
      let s = 0;
      for (let j = 0; j < k; j++) {
        if (g > 0) {
          // A modulated tone keeps its rms: (1 + sin) / 2 * sqrt(2) ... scaled to the plain tone's power [A].
          const a = this.mods[j] ? 0.8165 * (1 + Math.sin(this.modPhase[j])) : 1;
          s += a * this.amps[j] * Math.sin(this.phase[j]);
        }
        this.phase[j] += w * this.freqs[j];
        if (this.phase[j] > TWO_PI) this.phase[j] -= TWO_PI;
        if (this.mods[j]) { this.modPhase[j] += w * this.mods[j]; if (this.modPhase[j] > TWO_PI) this.modPhase[j] -= TWO_PI; }
      }
      out[offset + i] += g * s;
    }
  }
}

/** Renders `seconds` of a tone into a new buffer (tools and tests). */
export function renderTone(spec, seconds, rate = LINE_RATE) {
  const n = Math.round(seconds * rate), out = new Float32Array(n);
  new ToneSource(spec, { rate }).process(out, 0, n);
  return out;
}
