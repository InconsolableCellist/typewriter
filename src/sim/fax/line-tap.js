// What the FO-70's listeners hear of the telephone line and of its own sounders (docs/fax/architecture.md 5): the
// monitor speaker, the handset's earpiece, the ringer and the beeper. The host writes to it on its own clock; the
// audio engine (src/audio/fax-engine.js) reads it at the host's time, sample by sample. Pure, allocation-free reads.
//
// The line: the modem audio of a call in progress, block by block as the switchboard's AudioLink makes it (what the
// machine hears plus a little of what it sends, its sidetone), at the line rate; and the call-progress tones and
// DTMF digits that the call-level exchange (src/fax/remote/switchboard.js) reports only as events, synthesised here
// from the tone plan (src/fax/line/tones.js) with their cadences. A block is computed when its first sample is due,
// so the tap has each sample when the engine asks for it; nothing waits.
import { TONE_PLANS } from '../../fax/line/tones.js';
import { DTMF_ROWS, DTMF_COLS, DTMF_KEYS, DTMF_TIMING } from '../../fax/line/dtmf.js';

const SIZE = 16384, MASK = SIZE - 1;
const TWO_PI = 2 * Math.PI;
const PLAN = TONE_PLANS.na;
const SIDETONE = 0.35;                         // of the machine's own transmission in its own monitor [A]
const amp = (dbm0) => 0.9 * Math.pow(10, dbm0 / 20);   // a 0 dBm0 sine near full scale [A]

/** The DTMF pair of a key. */
function pair(d) {
  for (let r = 0; r < 4; r++) { const c = DTMF_KEYS[r].indexOf(d); if (c >= 0) return [DTMF_ROWS[r], DTMF_COLS[c]]; }
  return null;
}

export class LineTap {
  constructor(rate = 8000) {
    this.rate = rate;
    this.ring = new Float32Array(SIZE);
    this.to = 0;                  // samples written up to (exclusive)
    this.from = 0;                // the first valid sample
    this.signal = null;           // 'dial' | 'ringback' | 'busy' | 'reorder' | null
    this.signalT = 0;
    this.digits = [];             // { t, f1, f2 }
    this.voice = null;            // { t, samples }
    this.monitor = 0;             // 0 off, 1-3: the monitor speaker's volume
    this.ringer = { on: false, volume: 2, pattern: 'normal', t: 0 };
    this.beeps = [];              // { t0, t1, f }
  }

  // ---- written by the host --------------------------------------------------------------------------------------

  /** A block of the call's audio, samples [n, n + B) at the line rate. */
  block(n, tx, rx, B) {
    if (n !== this.to) { this.from = n; }
    const r = this.ring;
    for (let i = 0; i < B; i++) r[(n + i) & MASK] = rx[i] + SIDETONE * tx[i];
    this.to = n + B;
    if (this.to - this.from > SIZE) this.from = this.to - SIZE;
  }

  /** The exchange's state as the machine's line hears it (switchboard events). */
  progress(evt, t) {
    if (evt.ev === 'progress') {
      const map = { dialtone: 'dial', ringback: 'ringback', busy: 'busy', reorder: 'reorder' };
      if (evt.signal in map) {
        if (evt.signal !== 'ringback' || this.signal !== 'ringback' || t - this.signalT > 5.5) { this.signal = map[evt.signal]; this.signalT = t; }
        if (evt.signal === 'ringback') this.signalT = t;
      } else {
        this.signal = null;
        if (evt.signal === 'voice' && evt.samples) this.voice = { t, samples: evt.samples };
      }
    } else if (evt.ev === 'released') this.signal = 'reorder', this.signalT = t;
  }

  /** The loop opened: the line goes quiet. */
  hangup() { this.signal = null; this.digits.length = 0; this.voice = null; this.from = this.to; }

  /** A DTMF digit string starting at t (the dialler's timing: a tone, then a gap). */
  dial(digits, t, mode = 'TONE') {
    if (mode === 'PULSE') return;
    if (this.signal === 'dial') this.signal = null;
    const step = DTMF_TIMING.on + DTMF_TIMING.off;
    let k = 0;
    for (const d of String(digits)) {
      const p = pair(d);
      if (p) this.digits.push({ t: t + k * step, f1: p[0], f2: p[1] });
      k++;
    }
  }

  beep(kind, t) {
    if (kind === 'key') this.beeps.push({ t0: t, t1: t + 0.06, f: 2730 });
    else if (kind === 'end') this.beeps.push({ t0: t, t1: t + 1.5, f: 2730 });
    else for (let i = 0; i < 4; i++) this.beeps.push({ t0: t + i * 0.25, t1: t + i * 0.25 + 0.15, f: 2730 });
  }

  setRinger(on, { volume = this.ringer.volume, pattern = 'normal', sample = false } = {}, t = 0) {
    const r = this.ringer;
    if (on && !r.on) r.t = t;
    r.on = !!on; r.volume = volume; r.pattern = sample ? 'sample' : pattern;
  }

  // ---- read by the engine ------------------------------------------------------------------------------------------

  /** The line at time t (s): the call's audio, the exchange's tones, the digits and any voice. */
  lineAt(t) {
    let y = 0;
    const x = t * this.rate;
    if (this.to > this.from) {
      const n = Math.floor(x);
      if (n >= this.from && n + 1 < this.to) {
        const f = x - n;
        y += this.ring[n & MASK] * (1 - f) + this.ring[(n + 1) & MASK] * f;
      }
    }
    if (this.signal) y += this.tone(this.signal, t - this.signalT, t);
    const D = this.digits;
    while (D.length && t > D[0].t + DTMF_TIMING.on) D.shift();
    if (D.length && t >= D[0].t) {
      const d = D[0];
      y += 0.25 * Math.sin(TWO_PI * d.f1 * t) + 0.32 * Math.sin(TWO_PI * d.f2 * t);
    }
    const v = this.voice;
    if (v) {
      const i = Math.floor((t - v.t) * this.rate);
      if (i >= v.samples.length) this.voice = null;
      else if (i >= 0) y += v.samples[i];
    }
    return y;
  }

  tone(sig, dt, t) {
    const spec = PLAN[sig];
    if (!spec) return 0;
    if (spec.cadence) {
      const cad = spec.cadence;
      let total = 0;
      for (const c of cad) total += c;
      let p = dt % total, on = true;
      for (const c of cad) { if (p < c) break; p -= c; on = !on; }
      if (!on || (sig === 'ringback' && dt > cad[0])) return 0;
    }
    const a = amp(spec.dbm0);
    let y = 0;
    for (const f of spec.freqs) y += Math.sin(TWO_PI * (Array.isArray(f) ? f[0] : f) * t);
    return a * y;
  }

  /** The ringer's electronic warble at t (0 when it is silent). */
  ringerAt(t) {
    const r = this.ringer;
    if (!r.on || r.volume <= 0) return 0;
    const dt = t - r.t;
    if (r.pattern === 'pseudo' && dt % 3 > 1) return 0;            // the TEL/FAX pseudo ring: 1 s on, 2 s off [A]
    if (r.pattern === 'sample' && dt > 1.2) return 0;
    const f = Math.floor(dt * 16) & 1 ? 1250 : 1000;               // a two-tone warble at 16 Hz [A]
    const s = Math.sin(TWO_PI * f * t);
    return (0.06 * r.volume) * (s > 0 ? 1 : -1) * 0.6 + 0.04 * r.volume * s;
  }

  /** The piezo beeper at t. */
  beepAt(t) {
    const B = this.beeps;
    while (B.length && t > B[0].t1) B.shift();
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (t >= b.t0 && t < b.t1) return 0.07 * (Math.sin(TWO_PI * b.f * t) > 0 ? 1 : -1);
    }
    return 0;
  }
}
