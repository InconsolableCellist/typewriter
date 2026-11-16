// A T.30 call on a clock: binds a station (src/fax/t30/caller.js or answerer.js) and a modem port through a
// T30Endpoint, and keeps one clock timer armed at the endpoint's next deadline. Used by the FO-70's firmware and by
// the far ends in src/fax/remote/. Pure: the clock is handed in ({ now(), at(t, fn), cancel(h) }).
//
// The port's listener calls arrive from whoever drives the line (an ideal pipe's deliveries, an audio link's blocks);
// after each one the timer is re-armed. The endpoint's events (page-sent, page-received, hangup) are passed to
// `onEvent(action, t)` only after the endpoint has finished the step that raised them, so a handler may abort the call.

import { T30Endpoint } from '../t30/endpoint.js';

export class CallDriver {
  /** opts: clock, station, port, name, onEvent(action, t), onTap(kind, ...args) (every listener call, for logs and CNG watching) */
  constructor({ clock, station, port, name = station.role, onEvent = null, onTap = null, onStep = null }) {
    this.clock = clock;
    this.station = station;
    this.onEvent = onEvent;
    this.onTap = onTap;
    this.onStep = onStep;      // (state) after any step that changed the station's state
    this.lastState = station.state;
    this.timer = null;
    this.outbox = [];
    this.depth = 0;
    this.events = [];
    const self = this;
    const proxy = {
      listen(listener) {
        const wrap = (k) => (...a) => self._op(() => { self.onTap?.(k, ...a); listener[k](...a); });
        port.listen({ v21Carrier: wrap('v21Carrier'), v21Bits: wrap('v21Bits'), tone: wrap('tone'), hsCarrier: wrap('hsCarrier'), hsBits: wrap('hsBits') });
      },
      sendV21: (...a) => port.sendV21(...a),
      sendTone: (...a) => port.sendTone(...a),
      sendHighSpeed: (...a) => port.sendHighSpeed(...a),
      setHighSpeedRx: (r) => port.setHighSpeedRx(r),
    };
    this.endpoint = new T30Endpoint(station, proxy, { name, onEvent: (a, t) => { this.outbox.push([a, t]); } });
  }

  get done() { return this.endpoint.done; }
  get result() { return this.station.result; }

  start() { this._op(() => this.endpoint.start(this.clock.now())); }

  /** STOP: the station sends DCN and hangs up. */
  abort() { if (!this.done) this._op(() => this.endpoint.abort(this.clock.now())); }

  /** Forget the call without another frame (the line has gone). */
  drop() { this.clock.cancel(this.timer); this.timer = null; this.dropped = true; }

  _op(fn) {
    if (this.dropped) return;
    this.depth++;
    try { fn(); } finally { this.depth--; }
    if (this.depth === 0) {
      this._rearm();
      if (this.station.state !== this.lastState) { this.lastState = this.station.state; this.onStep?.(this.station.state); }
      this._flush();
    }
  }

  _flush() {
    while (this.outbox.length) {
      const [a, t] = this.outbox.shift();
      this.events.push({ t, ...a });
      this.onEvent?.(a, t);
    }
  }

  _rearm() {
    this.clock.cancel(this.timer);
    this.timer = null;
    if (this.done || this.dropped) return;
    const d = this.endpoint.deadline;
    if (!Number.isFinite(d)) return;
    this.timer = this.clock.at(d, () => { this.timer = null; this._op(() => this.endpoint.advance(this.clock.now())); });
  }
}
