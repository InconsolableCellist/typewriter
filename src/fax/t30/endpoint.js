// Binds a T.30 station (caller.js / answerer.js) to a modem port: turns the station's actions into HDLC bit streams
// and modem requests, and the port's received bits back into station events. Pure: no DOM or timers; time is
// whatever the driver hands to advance().
//
// THE MODEM PORT (the interface M3's modems implement; transport.js's IdealBitPipe is the M2 one).
// Transmit, called by the endpoint; t is when the transmission starts; each returns the time it ends:
//   port.sendV21(bits, t, meta)            V.21 channel 2 at 300 bit/s; bits are 0/1 (flags and stuffing included)
//   port.sendTone(tone, seconds, t, meta)  'CNG' (1100 Hz) or 'CED' (2100 Hz)
//   port.sendHighSpeed(rate, bits, t, meta) the modem for `rate` (V.27ter 2400/4800, V.29 7200/9600): its training
//                                          sequence, then `bits`. meta.kind is 'tcf' or 'page' (for logs only)
//   port.setHighSpeedRx(rate)              arm the high-speed receiver for `rate` (null: disarm). V.21 is always on.
// Receive: the port calls the listener given to port.listen(listener), in any chunking, in time order:
//   listener.v21Carrier(on, t)             V.21 carrier detected / lost
//   listener.v21Bits(bits, t)              demodulated V.21 bits
//   listener.tone(tone, on, t)             CNG or CED detected / ended
//   listener.hsCarrier(on, rate, t)        high-speed carrier after training / lost
//   listener.hsBits(rate, bits, t)         demodulated high-speed bits (descrambled)

import { encodeHdlc, HdlcDecoder } from '../hdlc.js';

export class T30Endpoint {
  /** `station` a T30Caller or T30Answerer; `port` a modem port; `name` for logs. */
  constructor(station, port, { name = station.role, onEvent = null } = {}) {
    this.station = station;
    this.port = port;
    this.name = name;
    this.onEvent = onEvent;
    this.decoder = new HdlcDecoder();
    this.rxFrames = [];
    this.hsChunks = [];
    this.hsRate = null;
    this.txEndAt = Infinity;
    this.events = [];     // page-sent, page-received, hangup, as emitted
    port.listen({
      v21Carrier: (on, t) => this._v21Carrier(on, t),
      v21Bits: (bits) => { this.decoder.pushBits(bits, this.rxFrames); },
      tone: (tone, on, t) => this._feed({ type: 'tone', tone, on }, t),
      hsCarrier: (on, rate, t) => this._hsCarrier(on, rate, t),
      hsBits: (rate, bits) => { this.hsChunks.push(bits); },
    });
  }

  get done() { return this.station.done; }
  get deadline() { return this.done ? Infinity : Math.min(this.station.deadline, this.txEndAt); }

  start(t) { this._apply(this.station.start(t), t); }
  abort(t) { this._feed({ type: 'abort' }, t); }

  advance(t) {
    if (this.txEndAt <= t + 1e-12) {
      const te = this.txEndAt;
      this.txEndAt = Infinity;
      this._apply(this.station.handle({ type: 'tx-done' }, te), te);
    }
    this._apply(this.station.advance(t), t);
  }

  _feed(ev, t) {
    this._apply(this.station.handle(ev, t), t);
    // Anything due now (a zero-delay follow-up) runs at once.
    this._apply(this.station.advance(t), t);
  }

  _v21Carrier(on, t) {
    if (on) { this.decoder.reset(); this.rxFrames = []; return; }
    // The decoder sees the closing flag only; a frame cut off by carrier loss is simply not reported.
    const frames = this.rxFrames;
    this.rxFrames = [];
    if (frames.length) this._feed({ type: 'frames', frames }, t);
  }

  _hsCarrier(on, rate, t) {
    if (on) { this.hsChunks = []; this.hsRate = rate; this._feed({ type: 'hs-carrier', rate, on: true }, t); return; }
    let n = 0;
    for (const c of this.hsChunks) n += c.length;
    const bits = new Uint8Array(n);
    let o = 0;
    for (const c of this.hsChunks) { bits.set(c, o); o += c.length; }
    this.hsChunks = [];
    this._feed({ type: 'hs-data', rate: this.hsRate ?? rate, bits }, t);
  }

  _apply(actions, t) {
    for (const a of actions) {
      switch (a.type) {
        case 'tx-v21': {
          const { bits } = encodeHdlc(a.frames);
          this.txEndAt = this.port.sendV21(bits, t, { frames: a.names });
          break;
        }
        case 'tx-tone':
          this.txEndAt = this.port.sendTone(a.tone, a.seconds, t, {});
          break;
        case 'tx-tcf': {
          const bits = new Uint8Array(Math.round(a.rate * a.seconds));   // zeros
          this.txEndAt = this.port.sendHighSpeed(a.rate, bits, t, { kind: 'tcf' });
          break;
        }
        case 'tx-page':
          this.txEndAt = this.port.sendHighSpeed(a.rate, a.bits, t, { kind: 'page', page: a.page });
          break;
        case 'rx-hs':
          this.port.setHighSpeedRx(a.rate);
          break;
        default:
          this.events.push({ t, ...a });
          if (this.onEvent) this.onEvent(a, t);
      }
    }
  }
}
