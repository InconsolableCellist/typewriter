// A digital local exchange joining subscriber lines, by logic, on the line-sample clock.
//
// Each port (a subscriber line) hands in, per block, its loop state per sample (1 = loop closed, off hook) and the
// audio it sends; it gets back the audio it hears and, while it is being rung, the ringing voltage per sample.
//
// Calling side:  on hook -> off hook (loop closed 30 ms) -> dial tone -> digits (DTMF heard on the line, or 10 pps
//                loop pulses counted) -> the first digit stops dial tone -> number complete (it matches the directory),
//                or 4 s with no digit -> route:
//                  free line: ringback to the caller, ringing current at the far line -> far end lifts -> connected
//                  line off hook: busy tone;  unknown number or incomplete: reorder;  'busy' entry: busy;
//                  no answer within `noAnswerRings` rings: reorder and a noAnswer event [A]
//                off hook 10 s without dialling: reorder; 30 s more: the off-hook warning (ROH) [A].
// Connected:     both directions through a DuplexLine (channel.js) of the number's line quality; tones stop.
// Release:       the loop open for 400 ms (PulseCounter's rule) is on hook. The other party hears silence and, after
//                10 s, reorder [A].
// Ringing:       the plan's cadence (North America 2 s on, 4 s off at 20 Hz [S]); events ringOn / ringOff, and the
//                per-sample voltage (V) on `port.ring` if given. Hooks for P8: a directory entry may carry its own
//                `ring` cadence (distinctive ring) and a `burst` (Float32Array) to send in the first silent interval,
//                0.5 s into the first silence of 1.5 s or more (Caller ID's place, after the first ring [M]).
//
// The call-progress tones are generated in the exchange and pass the codec (its law) only, not the line model.
// Events go to onEvent({ type, port, t, ... }) with t the sample count. No timers: time is samples processed.

import { LINE_RATE } from './levels.js';
import { TONE_PLANS, ToneSource } from './tones.js';
import { DtmfDetector, PulseCounter } from './dtmf.js';
import { DuplexLine } from './channel.js';
import { compander } from './companding.js';

const S = { IDLE: 'idle', DIAL: 'dialtone', DIGITS: 'digits', RINGBACK: 'ringback', BUSY: 'busy', REORDER: 'reorder',
  ROH: 'roh', RINGING: 'ringing', TALK: 'talk', RELEASED: 'released' };
export const PORT_STATES = S;

class Port {
  constructor(id, number, ex) {
    this.id = id; this.number = number; this.ex = ex;
    this.state = S.IDLE; this.t = 0;          // samples in the current state
    this.offHook = false; this.loopRun = 0; this.lastLoop = 0;
    this.digits = '';
    this.tone = null;
    this.peer = null;
    this.ringCad = null; this.ringT = 0; this.ringSeg = 0; this.ringOn = false; this.rings = 0;
    this.burst = null; this.burstPos = -1;
    this.dtmf = new DtmfDetector({ rate: ex.rate, onDigit: (d) => this._digit(d) });
    this.pulses = new PulseCounter({ rate: ex.rate, onDigit: (d) => this._digit(d), onHangup: () => this._onHook() });
    this.lastDigitT = 0;
  }
  _digit(d) {
    if (this.state !== S.DIAL && this.state !== S.DIGITS) return;
    if (this.state === S.DIAL) this.ex._setState(this, S.DIGITS);
    this.digits += d;
    this.lastDigitT = 0;
    this.ex._event('digit', this, { digit: d, digits: this.digits });
    this.ex._route(this, false);
  }
  _onHook() { if (this.offHook) this.ex._hangup(this); }
}

export class Exchange {
  /**
   * ports: { A: '5551001', B: '5551002' } port id -> its number.
   * directory: extra numbers -> 'busy' | 'unassigned' | { port, preset, ring, burst }; a port's own number routes to it.
   * preset: the line quality between ports (a channel.js preset name or options).
   */
  constructor({ ports = { A: '5551001', B: '5551002' }, directory = {}, plan = 'na', preset = 'typical', seed = 1,
    rate = LINE_RATE, noAnswerRings = 10, onEvent = null, maxBlock = 1024 } = {}) {
    this.rate = rate;
    this.plan = typeof plan === 'string' ? TONE_PLANS[plan] : plan;
    this.codec = compander(this.plan.law);
    this.ports = {};
    for (const [id, num] of Object.entries(ports)) this.ports[id] = new Port(id, num, this);
    this.directory = { ...directory };
    for (const p of Object.values(this.ports)) if (!this.directory[p.number]) this.directory[p.number] = { port: p.id };
    this.preset = preset; this.seed = seed;
    this.noAnswerRings = noAnswerRings;
    this.onEvent = onEvent;
    this.events = [];
    this.line = null;               // the DuplexLine of the call in progress
    this.t = 0;
    this.tmpA = new Float32Array(maxBlock); this.tmpB = new Float32Array(maxBlock);
    this.silent = new Float32Array(maxBlock);
    this.ms = (x) => Math.round(x * rate / 1000);
  }

  _event(type, port, extra = {}) {
    const e = { type, port: port ? port.id : null, t: this.t, ...extra };
    this.events.push(e);
    if (this.onEvent) this.onEvent(e);
  }

  _setState(port, s) {
    if (port.tone) { port.tone.stop(); port.tone = null; }
    port.state = s; port.t = 0;
    const plan = this.plan;
    if (s === S.DIAL) port.tone = new ToneSource(plan.dial, { rate: this.rate });
    else if (s === S.RINGBACK) port.tone = new ToneSource(plan.ringback, { rate: this.rate });
    else if (s === S.BUSY) port.tone = new ToneSource(plan.busy, { rate: this.rate });
    else if (s === S.REORDER) port.tone = new ToneSource(plan.reorder, { rate: this.rate });
    else if (s === S.ROH) port.tone = new ToneSource(plan.offHookWarning, { rate: this.rate });
    this._event('state', port, { state: s });
  }

  _route(port, timedOut) {
    const d = port.digits, dir = this.directory;
    const entry = dir[d];
    if (!entry) {
      const prefix = Object.keys(dir).some((k) => k.startsWith(d) && k !== d);
      if (!prefix || timedOut) { this._setState(port, S.REORDER); this._event('reorder', port, { digits: d, reason: 'unassigned' }); }
      return;
    }
    if (entry === 'unassigned') { this._setState(port, S.REORDER); this._event('reorder', port, { digits: d, reason: 'unassigned' }); return; }
    if (entry === 'busy') { this._setState(port, S.BUSY); this._event('busy', port, { digits: d }); return; }
    const far = this.ports[entry.port];
    if (!far || far === port || far.state !== S.IDLE || far.offHook) {
      this._setState(port, S.BUSY); this._event('busy', port, { digits: d }); return;
    }
    // Ring the far line.
    port.peer = far; far.peer = port;
    this._setState(port, S.RINGBACK);
    this._setState(far, S.RINGING);
    far.ringCad = Int32Array.from(entry.ring || this.plan.ring, (s) => Math.round(s * this.rate));
    far.ringT = 0; far.ringSeg = 0; far.ringOn = true; far.rings = 1;
    far.burst = entry.burst || null; far.burstPos = -1; far.burstArmed = false;
    this.callPreset = entry.preset || this.preset;
    this._event('ringOn', far, { from: port.id, digits: d });
  }

  _answer(far) {
    const caller = far.peer;
    if (far.ringOn) this._event('ringOff', far);
    far.ringOn = false;
    this._setState(far, S.TALK);
    this._setState(caller, S.TALK);
    this.line = new DuplexLine(this.callPreset, { rate: this.rate, seed: this.seed++ });
    this.callA = caller; this.callB = far;
    this._event('answer', far, { caller: caller.id });
  }

  _hangup(port) {
    port.offHook = false;
    const peer = port.peer;
    if (port.state === S.RINGBACK && peer) { this._setState(peer, S.IDLE); if (peer.ringOn) this._event('ringOff', peer); peer.ringOn = false; peer.peer = null; }
    if (port.state === S.TALK && peer) { this._setState(peer, S.RELEASED); peer.peer = null; this.line = null; }
    if (port.state === S.RELEASED || port.state === S.TALK) this.line = null;
    port.peer = null; port.digits = '';
    this._setState(port, S.IDLE);
    this._event('onHook', port);
  }

  /**
   * One block of n samples. io[portId] = { loop: Uint8Array|null (null: on hook), tx: Float32Array|null,
   * rx: Float32Array (written), ring: Float32Array|null (written: ringing volts) }.
   */
  process(n, io) {
    const ids = Object.keys(this.ports);
    // Hook state, pulses and timers, sample by sample (state changes land on the right sample).
    for (const id of ids) {
      const p = this.ports[id], o = io[id] || {};
      const loop = o.loop;
      for (let i = 0; i < n; i++) {
        const l = loop ? loop[i] : 0;
        p.pulses.push(l);
        if (l === p.lastLoop) p.loopRun++; else { p.lastLoop = l; p.loopRun = 1; }
        if (!p.offHook && l === 1 && p.loopRun >= this.ms(30)) {
          p.offHook = true;
          this.t = this.t0 + i;
          if (p.state === S.IDLE) { p.digits = ''; this._setState(p, S.DIAL); this._event('offHook', p); }
          else if (p.state === S.RINGING) this._answer(p);
        }
        p.t++;
        if (p.state === S.DIGITS) {
          if (++p.lastDigitT >= 4 * this.rate) { this.t = this.t0 + i; this._route(p, true); }
        } else if (p.state === S.DIAL && p.t >= 10 * this.rate) { this.t = this.t0 + i; this._setState(p, S.REORDER); this._event('reorder', p, { reason: 'no digits' }); }
        else if (p.state === S.REORDER && p.t >= 30 * this.rate) { this.t = this.t0 + i; this._setState(p, S.ROH); }
        else if (p.state === S.RELEASED && p.t >= 10 * this.rate) { this.t = this.t0 + i; this._setState(p, S.REORDER); }
        if (p.state === S.RINGING) this._ringStep(p, o.ring, i);
        else if (o.ring) o.ring[i] = 0;
      }
    }
    // Audio. Events raised from here (DTMF digits) take effect from the next block.
    this.t = this.t0 + n;
    if (this.line && this.callA && this.callB && this.callA.state === S.TALK && this.callB.state === S.TALK) {
      const a = io[this.callA.id], b = io[this.callB.id];
      for (let s = 0; s < n; s += this.tmpA.length) {
        const m = Math.min(this.tmpA.length, n - s);
        this.line.process(a.tx ? a.tx.subarray(s, s + m) : this.silent, b.tx ? b.tx.subarray(s, s + m) : this.silent,
          a.rx.subarray(s, s + m), b.rx.subarray(s, s + m), m);
      }
    }
    for (const id of ids) {
      const p = this.ports[id], o = io[id];
      if (!o || !o.rx) continue;
      const talking = this.line && p.state === S.TALK;
      if (!talking) o.rx.fill(0, 0, n);
      if (p.tone) {
        p.tone.process(o.rx, 0, n);
        if (this.codec) for (let i = 0; i < n; i++) o.rx[i] = this.codec(o.rx[i]);
      }
      // Digits are listened for on what the subscriber sends while dialling.
      if ((p.state === S.DIAL || p.state === S.DIGITS) && o.tx) p.dtmf.process(o.tx, 0, n);
      if (p.state === S.RINGING && p.burst && p.burstPos >= 0) {
        for (let i = 0; i < n && p.burstPos < p.burst.length; i++) o.rx[i] += p.burst[p.burstPos++];
      }
    }
    this.t0 += n; this.t = this.t0;
  }

  _ringStep(p, ring, i) {
    const cad = p.ringCad;
    if (ring) ring[i] = p.ringOn ? this.plan.ringVrms * Math.SQRT2 * Math.sin(2 * Math.PI * this.plan.ringHz * p.ringT / this.rate) : 0;
    if (++p.ringT >= cad[p.ringSeg]) {
      p.ringT = 0;
      p.ringSeg = (p.ringSeg + 1) % cad.length;
      const on = (p.ringSeg & 1) === 0;
      this.t = this.t0 + i;
      if (on) {
        p.rings++;
        if (this.noAnswerRings && p.rings > this.noAnswerRings) {
          const caller = p.peer;
          this._setState(p, S.IDLE); p.peer = null; p.ringOn = false;
          if (caller) { caller.peer = null; this._setState(caller, S.REORDER); this._event('noAnswer', caller, { rings: this.noAnswerRings }); }
          return;
        }
        p.ringOn = true; this._event('ringOn', p, { ring: p.rings });
      } else {
        p.ringOn = false; this._event('ringOff', p, { ring: p.rings });
        if (p.burst && !p.burstArmed && cad[p.ringSeg] >= 1.5 * this.rate) { p.burstArmed = true; p.burstPos = -Math.round(0.5 * this.rate); }
      }
    }
    if (p.burstPos < 0 && p.burstArmed && !p.ringOn) p.burstPos++;
  }

  get t0() { return this._t0 || 0; }
  set t0(v) { this._t0 = v; }

  state(id) { return this.ports[id].state; }
}


