// Dialling: DTMF tones and their detector, and 10 pps loop-disconnect pulses with their counter.
//
// DTMF [S frequencies, research.md 4]: rows 697, 770, 852, 941 Hz; columns 1209, 1336, 1477 (and 1633 for A to D).
// Levels -8 dBm0 for the row tone and -6 dBm0 for the column tone (the high group 2 dB up, "twist") [M].
// Timing: 100 ms of tone and 100 ms of silence a digit [A, the machine's own timing is in its manual].
//
// The detector is the classic Goertzel bank on 205-sample blocks at 8 kHz (25.6 ms) [M]. A block holds a digit when
// the strongest row and column tones both pass an absolute level, the twist is within +4 / -8 dB, every other tone
// of each group is 8 dB below its group's strongest, and the two tones carry most of the block's energy. A digit is
// reported once two blocks in a row agree, and released after two blocks without it.
//
// Pulse dialling [S 10 pps; M 60/40]: ten pulses a second, each a 60 ms break of the loop and a 40 ms make; a digit
// is that many breaks (0 is ten); 700 ms of make between digits [A]. The breaks are loop-current events (a per-sample
// loop state, 1 = loop closed); each edge also puts a relay click on the line [A: a short decaying transient].
// The counter (on the exchange side) counts breaks of 20 to 200 ms, ends a digit after 300 ms of make, and treats a
// break of 400 ms or longer as the subscriber hanging up [A].

import { LINE_RATE, dbm0ToPeak } from './levels.js';

export const DTMF_ROWS = [697, 770, 852, 941];
export const DTMF_COLS = [1209, 1336, 1477, 1633];
export const DTMF_KEYS = ['123A', '456B', '789C', '*0#D'];
export const DTMF_LEVELS = { row: -8, col: -6 };
export const DTMF_TIMING = { on: 0.1, off: 0.1 };

/** [rowHz, colHz] of a key, or null. */
export function dtmfFreqs(key) {
  for (let r = 0; r < 4; r++) {
    const c = DTMF_KEYS[r].indexOf(key);
    if (c >= 0) return [DTMF_ROWS[r], DTMF_COLS[c]];
  }
  return null;
}

/** Generates a dialling string as DTMF. `,` is a 2 s pause [A]. Adds into the buffer given. */
export class DtmfDialler {
  constructor(digits = '', { rate = LINE_RATE, on = DTMF_TIMING.on, off = DTMF_TIMING.off, levels = DTMF_LEVELS } = {}) {
    this.rate = rate;
    this.onN = Math.round(on * rate); this.offN = Math.round(off * rate);
    this.aRow = dbm0ToPeak(levels.row); this.aCol = dbm0ToPeak(levels.col);
    this.queue = [];
    this.cur = null; this.t = 0; this.p1 = 0; this.p2 = 0;
    this.dial(digits);
  }
  dial(digits) { for (const d of String(digits)) if (d === ',' || dtmfFreqs(d)) this.queue.push(d); }
  get done() { return !this.cur && this.queue.length === 0; }
  /** Adds n samples into out[offset..]; returns events [{ key, at }] for digits started in the block. */
  process(out, offset, n, events = null) {
    const w = 2 * Math.PI / this.rate, ramp = Math.round(0.002 * this.rate);
    for (let i = 0; i < n; i++) {
      if (!this.cur) {
        if (!this.queue.length) return events;
        const key = this.queue.shift();
        this.cur = key === ',' ? { key, f: null, len: 2 * this.rate } : { key, f: dtmfFreqs(key), len: this.onN + this.offN };
        this.t = 0; this.p1 = 0; this.p2 = 0;
        if (events) events.push({ key, at: i });
      }
      const c = this.cur;
      if (c.f && this.t < this.onN) {
        let g = 1;
        if (this.t < ramp) g = 0.5 - 0.5 * Math.cos(Math.PI * this.t / ramp);
        else if (this.onN - this.t < ramp) g = 0.5 - 0.5 * Math.cos(Math.PI * (this.onN - this.t) / ramp);
        out[offset + i] += g * (this.aRow * Math.sin(this.p1) + this.aCol * Math.sin(this.p2));
        this.p1 += w * c.f[0]; this.p2 += w * c.f[1];
      }
      if (++this.t >= c.len) this.cur = null;
    }
    return events;
  }
}

const ALL_FREQS = [...DTMF_ROWS, ...DTMF_COLS];

/** Goertzel power |X(f)|^2 of x[start .. start + n) at frequency f. */
export function goertzelPower(x, start, n, f, rate = LINE_RATE) {
  const c = 2 * Math.cos(2 * Math.PI * f / rate);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const s = x[start + i] + c * s1 - s2; s2 = s1; s1 = s; }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Amplitude of a sine at f estimated by Goertzel over n samples. */
export const goertzelAmplitude = (x, start, n, f, rate = LINE_RATE) => 2 * Math.sqrt(Math.max(0, goertzelPower(x, start, n, f, rate))) / n;

export class DtmfDetector {
  constructor({ rate = LINE_RATE, block = 205, minDbm0 = -32, onDigit = null } = {}) {
    this.rate = rate; this.N = block;
    this.coef = Float64Array.from(ALL_FREQS, (f) => 2 * Math.cos(2 * Math.PI * f / rate));
    this.s1 = new Float64Array(8); this.s2 = new Float64Array(8);
    this.pw = new Float64Array(8);
    this.energy = 0; this.n = 0;
    this.minAmp = dbm0ToPeak(minDbm0);
    this.last = null; this.lastCount = 0; this.current = null; this.missCount = 0;
    this.onDigit = onDigit;
    this.digits = '';
    this.t = 0;
  }
  reset() { this.s1.fill(0); this.s2.fill(0); this.energy = 0; this.n = 0; this.last = null; this.current = null; }

  process(x, offset, n) {
    for (let i = 0; i < n; i++) {
      const v = x[offset + i];
      this.energy += v * v;
      for (let k = 0; k < 8; k++) { const s = v + this.coef[k] * this.s1[k] - this.s2[k]; this.s2[k] = this.s1[k]; this.s1[k] = s; }
      this.t++;
      if (++this.n === this.N) this._block();
    }
  }

  _block() {
    const N = this.N, pw = this.pw;
    for (let k = 0; k < 8; k++) {
      pw[k] = this.s1[k] * this.s1[k] + this.s2[k] * this.s2[k] - this.coef[k] * this.s1[k] * this.s2[k];
      this.s1[k] = 0; this.s2[k] = 0;
    }
    const energy = this.energy;
    this.energy = 0; this.n = 0;
    let r = 0, c = 4;
    for (let k = 1; k < 4; k++) if (pw[k] > pw[r]) r = k;
    for (let k = 5; k < 8; k++) if (pw[k] > pw[c]) c = k;
    const ampR = 2 * Math.sqrt(pw[r]) / N, ampC = 2 * Math.sqrt(pw[c]) / N;
    let digit = null;
    if (ampR >= this.minAmp && ampC >= this.minAmp) {
      const twist = 20 * Math.log10(ampC / ampR);
      let ok = twist <= 8 && twist >= -4;
      for (let k = 0; k < 4 && ok; k++) if (k !== r && pw[k] * 6.3 > pw[r]) ok = false;
      for (let k = 4; k < 8 && ok; k++) if (k !== c && pw[k] * 6.3 > pw[c]) ok = false;
      // The two tones' share of the block energy (a pure pair gives about 1).
      if (ok && (2 / N) * (pw[r] + pw[c]) < 0.6 * energy) ok = false;
      if (ok) digit = DTMF_KEYS[r][c - 4];
    }
    if (digit && digit === this.last) this.lastCount++;
    else { this.last = digit; this.lastCount = 1; }
    if (digit && this.lastCount >= 2 && this.current !== digit) {
      this.current = digit; this.missCount = 0;
      this.digits += digit;
      if (this.onDigit) this.onDigit(digit, this.t);
    }
    if (!digit && this.current) { if (++this.missCount >= 2) this.current = null; }
  }
}

/** The make/break timing of 10 pps dialling. */
export const PULSE = { rate: 10, breakS: 0.06, makeS: 0.04, interDigitS: 0.7 };

/**
 * A pulse dialler: drives the loop state (1 closed, 0 open) sample by sample and adds a relay click to the line at
 * every edge. Starts and ends off hook (loop closed).
 */
export class PulseDialler {
  constructor(digits = '', { rate = LINE_RATE, timing = PULSE, clickDbm0 = -12 } = {}) {
    this.rate = rate;
    this.breakN = Math.round(timing.breakS * rate); this.makeN = Math.round(timing.makeS * rate);
    this.idN = Math.round(timing.interDigitS * rate);
    this.plan = [];              // remaining [state, samples] pairs
    this.cur = null; this.left = 0;
    this.clickAmp = dbm0ToPeak(clickDbm0) * 3;
    this.clickT = 1e9; this.clickSign = 1;
    this.loop = 1;
    this.dial(digits);
  }
  dial(digits) {
    for (const ch of String(digits)) {
      const d = ch === '0' ? 10 : ch >= '1' && ch <= '9' ? ch.charCodeAt(0) - 48 : 0;
      if (!d) continue;
      for (let i = 0; i < d; i++) { this.plan.push(0, this.breakN); this.plan.push(1, this.makeN); }
      this.plan.push(1, this.idN);
    }
  }
  get done() { return this.plan.length === 0 && this.left <= 0; }
  /** Writes n loop states to loop[loopOffset..] and adds clicks into audio[audioOffset..] (either may be null). */
  process(n, loop, loopOffset = 0, audio = null, audioOffset = 0) {
    const tau = 0.0015 * this.rate, w = 2 * Math.PI * 1300 / this.rate;
    for (let i = 0; i < n; i++) {
      if (this.left <= 0 && this.plan.length) {
        const s = this.plan.shift(); this.left = this.plan.shift();
        if (s !== this.loop) { this.clickT = 0; this.clickSign = s ? 1 : -1; }
        this.loop = s;
      }
      if (this.left > 0) this.left--;
      if (loop) loop[loopOffset + i] = this.loop;
      if (audio && this.clickT < 12 * tau) {
        const t = this.clickT;
        audio[audioOffset + i] += this.clickSign * this.clickAmp * Math.exp(-t / tau) * (0.6 * Math.cos(w * t) + 0.4 * Math.exp(-t / 2));
      }
      this.clickT++;
    }
  }
}

/** Counts dial pulses from the loop state, sample by sample (the exchange's digit receiver). */
export class PulseCounter {
  constructor({ rate = LINE_RATE, onDigit = null, onHangup = null } = {}) {
    this.rate = rate;
    this.minBreak = Math.round(0.02 * rate); this.maxBreak = Math.round(0.2 * rate);
    this.digitEnd = Math.round(0.3 * rate); this.hangup = Math.round(0.4 * rate);
    this.state = 1; this.run = 0; this.count = 0;
    this.onDigit = onDigit; this.onHangup = onHangup;
    this.digits = ''; this.hungUp = false;
  }
  push(loop) {
    if (loop === this.state) {
      this.run++;
      if (loop === 1 && this.count && this.run === this.digitEnd) {
        const d = this.count >= 10 ? '0' : String(this.count);
        this.count = 0; this.digits += d;
        if (this.onDigit) this.onDigit(d);
      }
      if (loop === 0 && this.run === this.hangup) {
        this.count = 0; this.hungUp = true;
        if (this.onHangup) this.onHangup();
      }
      return;
    }
    // An edge.
    if (loop === 1 && this.run >= this.minBreak && this.run <= this.maxBreak) this.count++;
    this.state = loop; this.run = 1;
    if (loop === 1) this.hungUp = false;
  }
  process(loopStates, offset, n) { for (let i = 0; i < n; i++) this.push(loopStates[offset + i]); }
}
