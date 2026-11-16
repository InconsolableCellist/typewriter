// The in-browser exchange at call level, for the correspondents and for Node tests: one subscriber line (the FO-70),
// the card index's numbers (directory.js), and the call between them carried by an ideal bit pipe (transport.js) or,
// optionally, by real modem audio over a line model (modem/audio-port.js's AudioLink). Everything runs on a handed-in
// clock ({ now(), at(t, fn), cancel(h) }); nothing here reads a timer.
//
// This is the logic of src/fax/line/exchange.js (dial tone, digits, ringing, busy, reorder, answer, release) without
// its sample-level audio: call-progress tones reach the subscriber as `progress` events, as the machine's tone
// detector would report them. The mechanism host joins the same directory entries to the sample exchange instead;
// a party only sees `call` (below), so it works on either.
//
// Subscriber events (to sub.event): { dev: 'ncu', ev: 'progress', signal: 'dialtone'|'ringback'|'busy'|'reorder'|
// 'answer'|'voice', text? }, { ev: 'ring', on, count, pattern }, { ev: 'callerId', number, name }, { ev: 'released' }.
//
// A party (directory.js) implements: number, name, busy(t) -> bool, answerRings (Infinity: never answers),
// onConnect(call), onRelease(call). It may call sb.callIn(party, opts) to ring the subscriber.
// `call` gives the party: clock, port (its modem port), direction ('in': the subscriber called it; 'out': it called
// the subscriber), line (its line options), hangup(), say(text) (a voice), and subscriberLoop() (is our side off hook).

import { IdealBitPipe } from '../transport.js';
import { AudioLink, TRAINING_SECONDS as AUDIO_TRAINING } from '../modem/audio-port.js';

const RING = [2, 4];                 // North America: 2 s on, 4 s off [S]
const DISTINCTIVE = [0.8, 0.4, 0.8, 4];   // a second number's pattern [A]
const POST_DIAL_S = 0.6;             // digits to ringback [A]
const DIAL_TONE_S = 0.15;

/** A port that drops everything: the line before a call is through. */
class DeadPort { listen() {} setHighSpeedRx() {} sendV21(b, t) { return t + b.length / 300; } sendTone(_x, s, t) { return t + s; } sendHighSpeed(r, b, t) { return t + b.length / r; } }

/**
 * The subscriber's modem port: stable for the machine's lifetime; joined to a far port while a call is through,
 * otherwise sends go nowhere (as tones into a line that is still ringing).
 */
class LinePort {
  constructor(sb) { this.sb = sb; this.listener = null; this.inner = new DeadPort(); this.rx = null; }
  join(inner) { this.inner = inner; inner.listen(this.relay()); inner.setHighSpeedRx(this.rx); }
  part() { this.inner = new DeadPort(); }
  relay() {
    const L = () => this.listener;
    return {
      v21Carrier: (...a) => L()?.v21Carrier(...a), v21Bits: (...a) => L()?.v21Bits(...a), tone: (...a) => L()?.tone(...a),
      hsCarrier: (...a) => L()?.hsCarrier(...a), hsBits: (...a) => L()?.hsBits(...a),
    };
  }
  listen(l) { this.listener = l; }
  setHighSpeedRx(r) { this.rx = r ?? null; this.inner.setHighSpeedRx(this.rx); }
  sendV21(...a) { const e = this.inner.sendV21(...a); this.sb._kick(); return e; }
  sendTone(...a) { const e = this.inner.sendTone(...a); this.sb._kick(); return e; }
  sendHighSpeed(...a) { const e = this.inner.sendHighSpeed(...a); this.sb._kick(); return e; }
  trainingSeconds(rate) { return this.sb.link?.training?.[rate]; }
}

/** A far port wrapped so the pump re-arms after its sends. */
function kicked(port, sb) {
  return {
    listen: (l) => port.listen(l), setHighSpeedRx: (r) => port.setHighSpeedRx(r),
    sendV21: (...a) => { const e = port.sendV21(...a); sb._kick(); return e; },
    sendTone: (...a) => { const e = port.sendTone(...a); sb._kick(); return e; },
    sendHighSpeed: (...a) => { const e = port.sendHighSpeed(...a); sb._kick(); return e; },
  };
}

export class Switchboard {
  /**
   * clock; directory (directory.js's Directory, or anything with lookup(number) and parties); ownNumber (digits);
   * transport 'ideal' | 'audio'; seed.
   */
  constructor({ clock, directory, ownNumber = '5550100', transport = 'ideal', seed = 1, audioBlock = 160 }) {
    this.clock = clock;
    this.directory = directory;
    this.ownNumber = ownNumber;
    this.transport = transport;
    this.seed = seed;
    this.audioBlock = audioBlock;
    this.sub = null;
    this.port = new LinePort(this);
    this.state = 'idle';
    this.digits = '';
    this.party = null;
    this.call = null;
    this.link = null;          // the pipe or audio link of the call in progress
    this.pumpTimer = null;
    this.timers = [];
    this.loopClosed = false;
    this.log = [];             // { t, what, ... }
    this.calls = [];           // every call: { t, direction, number, result }
  }

  attach(sub) { this.sub = sub; }

  _emit(evt) { this.log.push({ t: this.clock.now(), what: evt.ev, ...evt }); this.sub?.event({ dev: 'ncu', ...evt }); }
  _after(s, fn) { const h = this.clock.at(this.clock.now() + s, () => { this.timers = this.timers.filter((x) => x !== h); fn(); }); this.timers.push(h); return h; }
  _clearTimers() { for (const h of this.timers) this.clock.cancel(h); this.timers = []; }
  _set(s) { this.state = s; this.log.push({ t: this.clock.now(), what: 'state', state: s }); }

  // ---- the subscriber's line -------------------------------------------------------------------------------------

  /** The subscriber's loop opened or closed (line relay or handset hook switch). */
  loop(closed) {
    if (closed === this.loopClosed) return;
    this.loopClosed = closed;
    if (closed) {
      if (this.state === 'ringing') return this._answerIncoming();
      if (this.state === 'idle') {
        this._set('dialtone');
        this.digits = '';
        this._after(DIAL_TONE_S, () => { if (this.state === 'dialtone') this._emit({ ev: 'progress', signal: 'dialtone' }); });
      }
      return;
    }
    // On hook. What is already on its way down the line still arrives.
    if (this.link instanceof IdealBitPipe) this.link.deliverUntil(this.clock.now());
    else if (this.link instanceof AudioLink) for (let i = 0; i < 0.2 * this.link.rate / this.link.block; i++) this.link.step();
    const party = this.party, call = this.call;
    this._clearTimers();
    this._teardown();
    this._set('idle');
    this.digits = '';
    if (party && call && !call.ended) { call.ended = true; party.onRelease?.(call); }
    this.party = null; this.call = null;
  }

  /** Digits the subscriber has dialled (the dialler calls this as each digit completes). */
  dialled(d) {
    if (this.state !== 'dialtone' && this.state !== 'digits') return;
    this._set('digits');
    this.digits += d;
    this._clearTimers();
    const num = this.digits.replace(/[^0-9]/g, '');
    if (num.length >= 7) this._after(POST_DIAL_S, () => this._route(num));
    else this._after(4, () => { if (this.state === 'digits') { this._set('reorder'); this._emit({ ev: 'progress', signal: 'reorder' }); } });
  }

  _route(num) {
    const key = num.slice(-7);
    this.calls.push({ t: this.clock.now(), direction: 'in', number: key });
    if (key === this.ownNumber.replace(/[^0-9]/g, '').slice(-7)) { this._busy(); return; }
    const party = this.directory.lookup(key);
    if (!party || party.kind === 'dead') { this._set('reorder'); this._emit({ ev: 'progress', signal: 'reorder' }); return; }
    if (party.busy?.(this.clock.now())) { this._busy(); return; }
    this.party = party;
    this._set('ringback');
    let ring = 0;
    const cycle = () => {
      if (this.state !== 'ringback') return;
      ring++;
      this._emit({ ev: 'progress', signal: 'ringback', ring });
      if (ring >= (party.answerRings ?? 2)) { this._after(RING[0], () => this._connect(party, 'in')); return; }
      this._after(RING[0] + RING[1], cycle);
    };
    cycle();
  }

  _busy() {
    this._set('busy');
    this._emit({ ev: 'progress', signal: 'busy' });
  }

  _connect(party, direction) {
    if (this.state !== 'ringback' && this.state !== 'ringing') return;
    this._set('talk');
    const line = party.line ?? {};
    const t = this.clock.now();
    let far;
    if (this.transport === 'audio') {
      const link = new AudioLink({ preset: line.preset ?? 'typical', seed: this.seed++, block: this.audioBlock });
      const n0 = Math.ceil(t * link.rate);
      link.n = n0;
      for (const p of [link.a, link.b]) { p.n = n0; p.rxN = n0; }
      link.training = AUDIO_TRAINING;
      this.link = link;
      this.port.join(link.a);
      far = kicked(link.b, this);
      this._pumpAudio();
    } else {
      const pipe = new IdealBitPipe({ seed: this.seed++, tcfErrorRate: line.tcfErrorRate ?? 0, pageErrorRate: line.pageErrorRate ?? 0, v21ErrorRate: line.v21ErrorRate ?? 0 });
      this.link = pipe;
      this.port.join(pipe.a);
      far = kicked(pipe.b, this);
    }
    const sb = this;
    const call = this.call = {
      clock: this.clock, port: far, direction, line, party, ended: false, startedAt: t,
      hangup() { sb._farHangup(call); },
      say(text, samples = null) { if (!call.ended && sb.call === call) sb._emit({ ev: 'progress', signal: 'voice', text, samples }); },
      subscriberLoop() { return sb.loopClosed; },
    };
    if (direction === 'in') this._emit({ ev: 'progress', signal: 'answer' });
    party.onConnect(call);
  }

  _farHangup(call) {
    if (call.ended || this.call !== call) return;
    call.ended = true;
    this._teardown();
    this.call = null; this.party = null;
    this._set('released');
    this._emit({ ev: 'released' });
  }

  _teardown() {
    this.clock.cancel(this.pumpTimer);
    this.pumpTimer = null;
    this.port.part();
    this.link = null;
  }

  // ---- pumping the connection --------------------------------------------------------------------------------------

  /** Re-arm the ideal pipe's delivery timer (after any send). */
  _kick() {
    const pipe = this.link;
    if (!(pipe instanceof IdealBitPipe)) return;
    if (this.pumpTimer && this.pumpAt <= pipe.nextTime) return;
    this.clock.cancel(this.pumpTimer);
    this.pumpTimer = null;
    if (!Number.isFinite(pipe.nextTime)) return;
    this.pumpAt = pipe.nextTime;
    this.pumpTimer = this.clock.at(pipe.nextTime, () => {
      this.pumpTimer = null;
      if (this.link !== pipe) return;
      pipe.deliverUntil(this.clock.now());
      this._kick();
    });
  }

  _pumpAudio() {
    const link = this.link;
    const step = () => {
      if (this.link !== link) return;
      link.step();
      this.pumpTimer = this.clock.at(link.n / link.rate, step);
    };
    this.pumpTimer = this.clock.at(link.n / link.rate, step);
  }

  // ---- calls to the subscriber -------------------------------------------------------------------------------------

  /** Ring the subscriber for `party`. False if the line is not free (the party should try later). */
  callIn(party, { pattern = 'normal', callerId = true, maxRings = 10 } = {}) {
    if (this.state !== 'idle' || this.loopClosed) return false;
    this.party = party;
    this._set('ringing');
    this.calls.push({ t: this.clock.now(), direction: 'out', number: party.number });
    const cad = pattern === 'distinctive' ? DISTINCTIVE : RING;
    let count = 0, seg = 0;
    const tick = () => {
      if (this.state !== 'ringing') return;
      const on = (seg & 1) === 0;
      if (on) {
        count++;
        if (count > maxRings) { this._set('idle'); this.party = null; party.onNoAnswer?.(); return; }
        this._emit({ ev: 'ring', on: true, count, pattern });
      } else {
        this._emit({ ev: 'ring', on: false, count, pattern });
        if (count === 1 && callerId) this._after(0.5, () => { if (this.state === 'ringing') this._emit({ ev: 'callerId', number: party.number, name: party.name }); });
      }
      this._after(cad[seg % cad.length], () => { seg++; tick(); });
    };
    tick();
    return true;
  }

  _answerIncoming() {
    const party = this.party;
    this._clearTimers();
    this._connect(party, 'out');
  }
}

export { DeadPort };
