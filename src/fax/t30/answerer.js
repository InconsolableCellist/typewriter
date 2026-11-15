// The called station: phase A (after answering, a pause, then CED), phase B (CSI, DIS, repeated every T4
// until a command arrives or T1 runs out; an NSF goes first only for a virtual far end that imitates another maker,
// never from the FO-70). Normally it receives; when the caller polls it (CIG + DTC) and it holds a
// document (`source`, advertised in DIS bit 9), it transmits. See station.js for the step interface and events.

import { T30Station } from './station.js';
import { encodeIdent, parseDIS } from './frames.js';

export class T30Answerer extends T30Station {
  /** opts as T30Caller's; `source` here is the document offered for polling. */
  constructor(opts = {}) {
    super('answerer', opts);
  }

  get pollable() { return !!(this.source && this.source.pageCount > 0); }

  onStart(t) {
    this._set('A.answered');
    this.timers.start('T1', t, this.T.T1);
    this.beginReceive(t);
    this.later(t, this.timing.cedDelay, (tt) => {
      this._set('A.sendCED');
      this.sendTone(tt, 'CED', this.timing.cedDuration, (te) => this.later(te, this.timing.gap, (t2) => this._sendDIS(t2)));
    });
  }

  _sendDIS(t) {
    this._set('B.sendDIS');
    const list = [];
    if (this.nsf) list.push(this.frame('NSF', this.nsf));
    if (this.ident) list.push(this.frame('CSI', encodeIdent(this.ident)));
    list.push(this.frame('DIS', this._disFields(this.pollable)));
    this.sendFrames(t, list, (te) => {
      this._set('R.waitDCS');
      this.rx.disLoop = true;
      this.timers.start('T4', te, this.T.T4);
    });
  }

  onEomAccepted(t) {
    // Phase B again: a fresh DIS and its repeat loop under T1 [M].
    this.timers.start('T1', t, this.T.T1);
    this.later(t, this.timing.gap, (tt) => this._sendDIS(tt));
  }

  onPhaseTimer(name, t) {
    if (this.rx?.disLoop && this.state === 'R.waitDCS') {
      if (name === 'T4') { this._sendDIS(t); return true; }
      if (name === 'T1') { this.disconnect(t, 'T1', false); return true; }
    }
    return false;
  }

  onIdentFrames(last, good, t) {
    // Polled. (A DTC heard again while we wait for CFR is the transmitter side's business: our DCS was lost.)
    if (last.name !== 'DTC' || !(this.state === 'R.waitDCS' && this.rx?.disLoop)) return false;
    this.timers.stop('T4');
    this.timers.stop('T1');
    this.rx.disLoop = false;
    const dtc = parseDIS(last.fif);
    this.remote.dis = dtc;
    this._note(t, 'dtc', { rates: dtc.rates });
    if (!this.pollable) { this.disconnect(t, 'nothing-to-send', false); return true; }
    this.beginTransmit(t, dtc);
    return true;
  }

  _acceptDCS(fr, t) {
    this.rx.disLoop = false;
    super._acceptDCS(fr, t);
  }
}

export const createAnswerer = (opts) => new T30Answerer(opts);
