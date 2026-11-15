// The M2 transport: an ideal bit pipe between two fax endpoints, standing in for the modems and the line until M3.
// Each port implements the modem-port interface documented in src/fax/t30/endpoint.js. What goes in comes out the
// other end `delay` seconds later, with the durations a real modem would take (300 bit/s for V.21; the training
// sequence plus bits / rate for the high-speed modems), unless the error hooks say otherwise.
//
// No timers: the pipe holds a time-ordered queue of deliveries, and a driver (runCall below) moves time forward.
//
// Error injection:
//   hook(tx)        called for every transmission before it is queued, with
//                   tx = { from: 'A'|'B', kind: 'v21'|'tone'|'tcf'|'page', seq, start, end, rate, bits, frames, meta };
//                   seq counts that sender's transmissions of that kind from 0. tx.bits is a private copy: flip
//                   bits in it freely. Return 'drop' to lose the transmission entirely.
//   tcfErrorRate    probability of a bit error in TCF, a number or a function of the rate (the "TCF knob")
//   pageErrorRate   the same for page data
//   v21ErrorRate    the same for V.21 bits
// Errors come from a seeded generator, so a run is repeatable.

import { V21_BIT_RATE } from './hdlc.js';

/**
 * Training sequence durations in seconds, per rate [M]: V.29 is 48 + 128 + 384 + 48 symbols at 2400 baud
 * (253.3 ms); V.27ter's long training is about 708 ms at 4800 and 943 ms at 2400. M3's modems supply the real ones.
 */
export const TRAINING_SECONDS = Object.freeze({ 9600: 608 / 2400, 7200: 608 / 2400, 4800: 0.708, 2400: 0.943 });

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

class PipePort {
  constructor(pipe, id) {
    this.pipe = pipe;
    this.id = id;
    this.listener = null;
    this.hsRate = null;
    this.peer = null;
    this.seq = { v21: 0, tone: 0, tcf: 0, page: 0 };
  }

  listen(listener) { this.listener = listener; }
  setHighSpeedRx(rate) { this.hsRate = rate ?? null; }

  sendV21(bits, t, meta = {}) {
    const end = t + bits.length / V21_BIT_RATE;
    this.pipe._send(this, { kind: 'v21', start: t, end, rate: V21_BIT_RATE, bits, meta });
    return end;
  }

  sendTone(tone, seconds, t, meta = {}) {
    const end = t + seconds;
    this.pipe._send(this, { kind: 'tone', start: t, end, tone, bits: null, meta });
    return end;
  }

  sendHighSpeed(rate, bits, t, meta = {}) {
    const training = this.pipe.training[rate];
    if (training === undefined) throw new Error(`no modem for ${rate} bit/s`);
    const end = t + training + bits.length / rate;
    this.pipe._send(this, { kind: meta.kind === 'tcf' ? 'tcf' : 'page', start: t, end, rate, training, bits, meta });
    return end;
  }
}

export class IdealBitPipe {
  constructor({ delay = 0, seed = 1, hook = null, tcfErrorRate = 0, pageErrorRate = 0, v21ErrorRate = 0, training = TRAINING_SECONDS } = {}) {
    this.delay = delay;
    this.rand = mulberry32(seed);
    this.hook = hook;
    this.tcfErrorRate = tcfErrorRate;
    this.pageErrorRate = pageErrorRate;
    this.v21ErrorRate = v21ErrorRate;
    this.training = training;
    this.a = new PipePort(this, 'A');
    this.b = new PipePort(this, 'B');
    this.a.peer = this.b;
    this.b.peer = this.a;
    this.queue = [];      // { t, n, fn }, kept sorted by t then n
    this.n = 0;
    this.log = [];        // every transmission: { from, kind, start, end, rate, bits, frames, tone, lost, training }
  }

  get nextTime() { return this.queue.length ? this.queue[0].t : Infinity; }

  _at(t, fn) {
    const e = { t, n: this.n++, fn };
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1].t > t || (this.queue[i - 1].t === t && this.queue[i - 1].n > e.n))) i--;
    this.queue.splice(i, 0, e);
  }

  /** Run every delivery due by time t, in order. */
  deliverUntil(t) {
    while (this.queue.length && this.queue[0].t <= t + 1e-12) this.queue.shift().fn();
  }

  _rate(knob, rate) { return typeof knob === 'function' ? knob(rate) : knob; }

  _flip(bits, p) {
    if (!(p > 0)) return 0;
    let n = 0;
    for (let i = 0; i < bits.length; i++) if (this.rand() < p) { bits[i] ^= 1; n++; }
    return n;
  }

  _send(port, tx) {
    tx.from = port.id;
    tx.seq = port.seq[tx.kind]++;
    tx.frames = tx.meta.frames ?? null;
    if (tx.bits) tx.bits = Uint8Array.from(tx.bits);
    const entry = {
      from: port.id, kind: tx.kind, start: tx.start, end: tx.end, rate: tx.rate ?? null,
      bits: tx.bits ? tx.bits.length : 0, frames: tx.meta.frames ?? null, tone: tx.tone ?? null,
      page: tx.meta.page ?? null, training: tx.training ?? 0, lost: false, flipped: 0, received: null,
    };
    this.log.push(entry);
    let flipped = 0;
    if (tx.kind === 'tcf') flipped += this._flip(tx.bits, this._rate(this.tcfErrorRate, tx.rate));
    if (tx.kind === 'page') flipped += this._flip(tx.bits, this._rate(this.pageErrorRate, tx.rate));
    if (tx.kind === 'v21') flipped += this._flip(tx.bits, this._rate(this.v21ErrorRate, tx.rate));
    if (this.hook) {
      const before = tx.bits ? Uint8Array.from(tx.bits) : null;
      if (this.hook(tx) === 'drop') { entry.lost = true; return; }
      if (before) for (let i = 0; i < before.length; i++) if (before[i] !== tx.bits[i]) flipped++;
    }
    entry.flipped = flipped;
    const peer = port.peer;
    const d = this.delay;
    const L = () => peer.listener;
    if (tx.kind === 'tone') {
      this._at(tx.start + d, () => L()?.tone(tx.tone, true, tx.start + d));
      this._at(tx.end + d, () => L()?.tone(tx.tone, false, tx.end + d));
    } else if (tx.kind === 'v21') {
      this._at(tx.start + d, () => L()?.v21Carrier(true, tx.start + d));
      this._at(tx.end + d, () => { L()?.v21Bits(tx.bits, tx.end + d); L()?.v21Carrier(false, tx.end + d); });
    } else {
      // The receiver must be armed for this rate when the training arrives, or it hears nothing it can use.
      const tTrained = tx.start + tx.training + d;
      this._at(tTrained, () => {
        entry.received = peer.hsRate === tx.rate;
        if (entry.received) L()?.hsCarrier(true, tx.rate, tTrained);
      });
      this._at(tx.end + d, () => {
        if (!entry.received) return;
        L()?.hsBits(tx.rate, tx.bits, tx.end + d);
        L()?.hsCarrier(false, tx.rate, tx.end + d);
      });
    }
  }

  /** The call as a ladder of short strings, e.g. 'A CNG', 'B CSI DIS', 'A TCF 9600', 'A PAGE 9600'. */
  ladder({ tones = true } = {}) {
    const out = [];
    for (const e of this.log) {
      let s;
      if (e.kind === 'tone') { if (!tones) continue; s = `${e.from} ${e.tone}`; }
      else if (e.kind === 'v21') s = `${e.from} ${(e.frames ?? ['?']).join(' ')}`;
      else if (e.kind === 'tcf') s = `${e.from} TCF ${e.rate}`;
      else s = `${e.from} PAGE ${e.rate}`;
      if (e.lost) s += ' (lost)';
      out.push(s);
    }
    return out;
  }
}

/**
 * Drive endpoints and a pipe until every endpoint has hung up, nothing is left to happen, or `until` seconds.
 * `actions` is an optional list of [t, fn] run when time reaches t (e.g. pressing STOP). Returns the end time.
 */
export function runCall(endpoints, pipe, { until = 600, actions = [], start = 0 } = {}) {
  const acts = actions.slice().sort((x, y) => x[0] - y[0]);
  for (const e of endpoints) e.start(start);
  let t = start;
  for (let steps = 0; steps < 1e6; steps++) {
    if (endpoints.every((e) => e.done) && pipe.nextTime === Infinity) break;
    const next = Math.min(pipe.nextTime, acts.length ? acts[0][0] : Infinity, ...endpoints.map((e) => e.deadline));
    if (!(next <= until)) break;
    t = Math.max(t, next);
    while (acts.length && acts[0][0] <= t) acts.shift()[1](t);
    pipe.deliverUntil(t);
    for (const e of endpoints) e.advance(t);
  }
  return t;
}
