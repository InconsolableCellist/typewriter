// The calling station: phase A (CNG until the far end is heard, T1), then phase B on the called station's DIS.
// Normally it transmits; with `poll: true` it asks the called station to transmit (CIG + DTC) and receives.
// See station.js for the step interface and the events.

import { T30Station } from './station.js';
import { parseDIS, encodeIdent, buildDTC } from './frames.js';

export class T30Caller extends T30Station {
  /**
   * opts: ident, caps, source (pages to send), poll (receive by polling), fine, twoD, eomAfter, checker, policy,
   * timers ({ T1, T2, T3, T4 } overrides), timing (T30_TIMING overrides).
   */
  constructor(opts = {}) {
    super('caller', opts);
    this.poll = !!opts.poll;
    this.contact = false;
  }

  onStart(t) {
    this._set('A.callingTone');
    this.timers.start('T1', t, this.T.T1);
    this._cng(t);
  }

  _cng(t) {
    if (this.contact || this.done) return;
    this.sendTone(t, 'CNG', this.timing.cngOn, (te) => {
      if (!this.contact) this.later(te, this.timing.cngOff, (tt) => this._cng(tt));
    });
  }

  _contact(t) {
    if (this.contact) return;
    this.contact = true;
    if (this.pending) this.cancelPending();   // the next CNG burst
    this._note(t, 'contact');
    if (this.state === 'A.callingTone') this._set('B.waitDIS');
  }

  onTone(ev, t) {
    this._note(t, 'tone', { tone: ev.tone, on: ev.on });
    if (ev.tone === 'CED' && ev.on) this._contact(t);
  }

  onPhaseTimer(name, t) {
    if (name === 'T1' && (this.state === 'A.callingTone' || this.state === 'B.waitDIS')) {
      this.finish(t, 'T1', false);   // never identified a fax machine: hang up without DCN
      return true;
    }
    if (name === 'T4' && this.state === 'R.waitDCS' && this.rx?.polling) {
      // DTC is a command: repeat it, three tries in all [M].
      if (this.tries >= this.policy.maxTries) { this.disconnect(t, 'no-response', false); return true; }
      this.tries++;
      this._sendDTC(t);
      return true;
    }
    return false;
  }

  onIdentFrames(last, good, t) {
    const s = this.state;
    if (last.name !== 'DIS') return false;
    if (s !== 'A.callingTone' && s !== 'B.waitDIS' && !(s === 'R.waitDCS' && this.rx?.polling)) return false;
    this._contact(t);
    this.timers.stop('T1');
    const dis = parseDIS(last.fif);
    this.remote.dis = dis;
    this._note(t, 'dis', { rates: dis.rates, poll: dis.readyToTransmit });
    if (this.poll) {
      if (!dis.readyToTransmit) { this.disconnect(t, 'nothing-to-poll', false); return true; }
      if (this.rx?.polling) {          // our DTC was not heard and the far end repeated DIS
        if (this.tries >= this.policy.maxTries) { this.disconnect(t, 'no-response', false); return true; }
        this.tries++;
      } else this.tries = 1;
      this.beginReceive(t);
      this.rx.polling = true;
      this.later(t, this.timing.gap, (tt) => this._sendDTC(tt));
      return true;
    }
    if (!this.source || !this.source.pageCount) { this.disconnect(t, 'nothing-to-send', false); return true; }
    this.beginTransmit(t, dis);
    return true;
  }

  _sendDTC(t) {
    this._set('R.sendDTC');
    const list = [];
    if (this.ident) list.push(this.frame('CIG', encodeIdent(this.ident)));
    list.push(this.frame('DTC', this._disFields(false)));
    this.sendFrames(t, list, (te) => { this._set('R.waitDCS'); this.timers.start('T4', te, this.T.T4); });
  }

  // When the polled station's DCS arrives the DTC repeat stops.
  _acceptDCS(fr, t) {
    if (this.rx) this.rx.polling = false;
    super._acceptDCS(fr, t);
  }
}

export const createCaller = (opts) => new T30Caller(opts);
// DTC uses the DIS format; re-exported for callers building one by hand.
export { buildDTC };
