// The audio modem port: the modem-port interface of src/fax/t30/endpoint.js implemented over real modem signals,
// the counterpart of the ideal pipe in src/fax/transport.js. Each T.30 endpoint gets one AudioModemPort; the port
// turns sendV21 / sendTone / sendHighSpeed into line samples, and runs a V.21 receiver, the armed high-speed
// receiver and the CNG/CED detector on the samples the line brings back.
//
// Time: seconds = samples / 8000 on the port's own sample count, which a driver keeps equal for both ends (they share
// the line's clock). A send scheduled for a time already passed starts on the next sample produced.
//
//   port.produce(out, offset, n)   the port's transmit audio for its next n samples (overwrites)
//   port.consume(x, offset, n)     the line audio it hears for the same n samples; listener calls happen inside,
//                                  timed to the sample (bits are delivered in chunks at the end of each call)
//   AudioLink                       two ports joined by a DuplexLine (channel.js) of a preset; runAudioCall drives
//                                  two endpoints over it, as transport.js's runCall drives the ideal pipe.
//
// While the high-speed receiver is trained, V.21 bits are dropped (the receiver is squelched) [A].
// Receiver muting [A]: while a port transmits, and for 120 ms after, its receivers hear silence (a real modem's
// receiver is squelched during its own transmission and its echo). Durations returned by the sends are the real
// ones: V.21 bits / 300 plus the 2 ms carrier ramp; a high-speed send is its modem's training plus bits / rate,
// rounded up to whole symbols, plus the pulse tail.
//
// Everything a block needs is allocated in the constructor (all five high-speed receivers are made once and armed by
// rate); a send allocates its transmitter, which happens a few times a call, never per block.

import { LINE_RATE } from '../line/levels.js';
import { ToneSource, FAX_TONES } from '../line/tones.js';
import { DuplexLine } from '../line/channel.js';
import { V21Transmitter, V21Receiver } from './v21.js';
import { V27terTransmitter, V27terReceiver, V27TER } from './v27ter.js';
import { V29Transmitter, V29Receiver, V29 } from './v29.js';
import { ToneDetector, signatures } from './tone-detect.js';
import { bitSource, modulationForRate } from './index.js';

/** The real training durations of our transmitters, in seconds (the TRAINING_SECONDS M2 guessed). */
export const TRAINING_SECONDS = Object.freeze({
  9600: V29Transmitter.trainingSeconds(), 7200: V29Transmitter.trainingSeconds(),
  4800: V27terTransmitter.trainingSeconds(4800), 2400: V27terTransmitter.trainingSeconds(2400),
});

const symbolsFor = (rate) => (rate === 9600 ? 4 : rate === 7200 ? 3 : rate === 4800 ? 3 : 2);
const baudFor = (rate) => (rate >= 7200 ? V29.baud : V27TER[rate].baud);

const MUTE_S = 0.12;
const CHUNK = 4096;

export class AudioModemPort {
  constructor({ rate = LINE_RATE, name = '', sigs = null } = {}) {
    this.rate = rate; this.name = name;
    this.listener = null;
    this.n = 0;                       // samples produced so far
    this.rxN = 0;                     // samples consumed so far
    this.queue = [];                  // [{ start, end, tx }] in start order
    this.active = null;
    this.muteUntil = -1;
    this.hsRate = null;
    this.silence = new Float32Array(256);
    this.v21Chunk = new Uint8Array(CHUNK); this.v21Len = 0;
    this.hsChunk = new Uint8Array(CHUNK); this.hsLen = 0;
    this.v21 = new V21Receiver({ lineRate: rate, sink: {
      bit: (b) => {
        if (this.hsTrained) return;            // the high-speed receiver has the line: V.21 is squelched [A]
        this.v21Chunk[this.v21Len++] = b; if (this.v21Len === CHUNK) this._flushV21();
      },
      carrier: (on) => { this._flushV21(); this.listener?.v21Carrier(on, this._now()); },
    } });
    this.hs = {};
    for (const r of [9600, 7200, 4800, 2400]) {
      const sink = {
        bit: (b) => { this.hsChunk[this.hsLen++] = b; if (this.hsLen === CHUNK) this._flushHs(r); },
        trained: () => {
          this.hsTrained = r;
          // Whatever V.21 made of the training is thrown away: a carrier-on restarts the HDLC receiver above.
          this.v21Len = 0;
          if (this.v21.cd) this.listener?.v21Carrier(true, this._now());
          this.listener?.hsCarrier(true, r, this._now());
        },
        carrier: (on) => { if (!on && this.hsTrained === r) { this._flushHs(r); this.hsTrained = null; this.listener?.hsCarrier(false, r, this._now()); } },
      };
      this.hs[r] = modulationForRate(r) === 'v29' ? new V29Receiver({ rate: r, sink, lineRate: rate }) : new V27terReceiver({ rate: r, sink, lineRate: rate });
    }
    this.hsTrained = null;
    const all = signatures();
    this.td = new ToneDetector({ rate, sigs: sigs ?? all.filter((s) => s.name === 'cng' || s.name === 'ced'), onTone: (e) => this._tone(e) });
    this.toneOn = { CNG: false, CED: false };
    this.sampleInBlock = 0; this.blockStart = 0;
    this.log = [];                    // what this port sent: { kind, start, end, rate, frames, tone }
  }

  _now() { return (this.blockStart + this.sampleInBlock) / this.rate; }

  listen(listener) { this.listener = listener; }
  setHighSpeedRx(rate) { this.hsRate = rate ?? null; }

  _at(t) { return Math.max(this.n, Math.round(t * this.rate)); }
  _queue(start, end, tx, entry) {
    this.queue.push({ start, end, tx });
    this.queue.sort((a, b) => a.start - b.start);
    this.log.push(entry);
    return end / this.rate;
  }

  sendV21(bits, t, meta = {}) {
    const s = this._at(t);
    const len = Math.ceil(bits.length * this.rate / 300) + Math.round(0.002 * this.rate);
    const tx = new V21Transmitter({ source: bitSource(bits), lineRate: this.rate });
    return this._queue(s, s + len, tx, { kind: 'v21', start: s / this.rate, end: (s + len) / this.rate, frames: meta.frames ?? null });
  }

  sendTone(tone, seconds, t) {
    const s = this._at(t);
    const spec = tone === 'CNG' ? FAX_TONES.cng : FAX_TONES.ced;
    const len = Math.round(seconds * this.rate);
    const tx = new ToneSource({ freqs: spec.freqs, dbm0: spec.dbm0, cadence: null }, { rate: this.rate, duration: seconds - 0.002 });
    return this._queue(s, s + len, tx, { kind: 'tone', tone, start: s / this.rate, end: (s + len) / this.rate });
  }

  sendHighSpeed(rate, bits, t, meta = {}) {
    const s = this._at(t);
    const src = bitSource(bits);
    const tx = modulationForRate(rate) === 'v29'
      ? new V29Transmitter({ rate, source: src, lineRate: this.rate })
      : new V27terTransmitter({ rate, source: src, lineRate: this.rate });
    const syms = Math.ceil(bits.length / symbolsFor(rate));
    const len = Math.ceil((TRAINING_SECONDS[rate] + (syms + 6) / baudFor(rate)) * this.rate);
    return this._queue(s, s + len, tx, { kind: meta.kind === 'tcf' ? 'tcf' : 'page', rate, start: s / this.rate, end: (s + len) / this.rate, bits: bits.length });
  }

  /** Transmit audio for the next n samples. */
  produce(out, offset, n) {
    for (let i = 0; i < n; i++) out[offset + i] = 0;
    let i = 0;
    while (i < n) {
      const now = this.n + i;
      if (!this.active && this.queue.length && this.queue[0].start <= now) this.active = this.queue.shift();
      if (!this.active) {
        const next = this.queue.length ? this.queue[0].start - this.n : n;
        i = Math.max(i + 1, Math.min(n, next));
        continue;
      }
      const a = this.active;
      const m = Math.min(n - i, a.end - now);
      if (a.tx instanceof ToneSource) a.tx.process(out, offset + i, m);
      else a.tx.process(out, offset + i, m);
      i += m;
      this.muteUntil = this.n + i + Math.round(MUTE_S * this.rate);
      if (this.n + i >= a.end) this.active = null;
    }
    this.n += n;
  }

  /** The line audio this port hears, for the same samples as the last produce(). */
  consume(x, offset, n) {
    this.blockStart = this.rxN;
    // Muted samples are replaced by silence, in sub-blocks.
    let i = 0;
    while (i < n) {
      const muted = this.rxN + i < this.muteUntil;
      let j = i;
      while (j < n && ((this.rxN + j < this.muteUntil) === muted)) j++;
      for (let s = i; s < j; s += this.silence.length) {
        const m = Math.min(this.silence.length, j - s);
        const src = muted ? this.silence : x, so = muted ? 0 : offset + s;
        this.sampleInBlock = s + m;
        this.v21.process(src, so, m);
        if (this.hsRate) this.hs[this.hsRate].process(src, so, m);
        this.td.process(src, so, m);
      }
      i = j;
    }
    this.rxN += n;
    this.sampleInBlock = n;
    this._flushV21();
    if (this.hsTrained) this._flushHs(this.hsTrained);
    // A tone reported on goes off when the detector stops hearing it.
    for (const [name, idx] of [['CNG', this._sigIndex('cng')], ['CED', this._sigIndex('ced')]]) {
      if (idx >= 0 && this.toneOn[name] && !this.td.present[idx]) { this.toneOn[name] = false; this.listener?.tone(name, false, this._now()); }
    }
  }

  _sigIndex(name) { return this.td.sigs.findIndex((s) => s.name === name); }

  _tone(e) {
    const name = e.name.toUpperCase();
    if (this.toneOn[name]) return;
    this.toneOn[name] = true;
    this.listener?.tone(name, true, this._now());
    if (name === 'CNG') { this.toneOn[name] = false; this.listener?.tone(name, false, this._now()); }
  }

  _flushV21() {
    if (!this.v21Len) return;
    const bits = this.v21Chunk.slice(0, this.v21Len);
    this.v21Len = 0;
    this.listener?.v21Bits(bits, this._now());
  }

  _flushHs(rate) {
    if (!this.hsLen) return;
    const bits = this.hsChunk.slice(0, this.hsLen);
    this.hsLen = 0;
    this.listener?.hsBits(rate, bits, this._now());
  }

  /** True when nothing is queued or being sent. */
  get idle() { return !this.active && !this.queue.length; }
}

/** Two ports on a line of a channel preset. */
export class AudioLink {
  constructor({ preset = 'typical', seed = 1, rate = LINE_RATE, block = 160, record = false } = {}) {
    this.rate = rate; this.block = block;
    this.a = new AudioModemPort({ rate, name: 'A' });
    this.b = new AudioModemPort({ rate, name: 'B' });
    this.line = new DuplexLine(preset, { rate, seed, maxBlock: block });
    this.aTx = new Float32Array(block); this.bTx = new Float32Array(block);
    this.aRx = new Float32Array(block); this.bRx = new Float32Array(block);
    this.n = 0;
    this.record = record ? { aTx: [], bTx: [], aRx: [], bRx: [] } : null;
  }
  get t() { return this.n / this.rate; }
  /** One block. */
  step() {
    const B = this.block;
    this.a.produce(this.aTx, 0, B); this.b.produce(this.bTx, 0, B);
    this.line.process(this.aTx, this.bTx, this.aRx, this.bRx, B);
    this.a.consume(this.aRx, 0, B); this.b.consume(this.bRx, 0, B);
    if (this.record) for (const k of ['aTx', 'bTx', 'aRx', 'bRx']) this.record[k].push(this[k].slice());
    this.n += B;
  }
  get idle() { return this.a.idle && this.b.idle; }
}

/**
 * Drive endpoints over an AudioLink until all have hung up and the line is quiet, or `until` seconds.
 * Endpoints are started at `start`; advance() is called every block.
 */
export function runAudioCall(endpoints, link, { until = 600, start = 0 } = {}) {
  while (link.t < start) link.step();
  for (const e of endpoints) e.start(link.t);
  let quiet = 0;
  while (link.t < until) {
    for (const e of endpoints) e.advance(link.t);
    link.step();
    if (endpoints.every((e) => e.done) && link.idle) { if (++quiet > 20) break; } else quiet = 0;
  }
  return link.t;
}
