// The T.30 procedure shared by both ends: the transmitting side (DCS, TCF, pages, post-message commands, DCN) and
// the receiving side (TCF judgement, CFR/FTT, page judgement, MCF/RTP/RTN). caller.js and answerer.js add phase A
// and decide which side each end plays (polling swaps them).
//
// A station is a pure step machine. Nothing here reads a clock or sets a timer:
//   start(t)          -> actions      the call begins (line connected) at time t
//   handle(event, t)  -> actions      an event from the modem layer at time t
//   advance(t)        -> actions      time has reached t; fire due timers and scheduled sends
//   deadline                          the next time advance() must be called (Infinity when nothing is due)
// t is in seconds on the caller's time base (a sample count / sample rate works the same).
//
// Events in:   { type: 'tx-done' }                         the last transmission requested has finished
//              { type: 'frames', frames: [{ ok, bytes }] } a V.21 transmission ended; HDLC frames as decoded
//              { type: 'tone', tone: 'CNG'|'CED', on }     a tone detector changed
//              { type: 'hs-carrier', rate, on }            the high-speed receiver trained (on) at rate
//              { type: 'hs-data', rate, bits }             a high-speed transmission ended (training excluded)
//              { type: 'abort' }                           the operator pressed STOP
// Actions out: { type: 'tx-v21', frames: [Uint8Array], names }     send these HDLC frames (with preamble)
//              { type: 'tx-tone', tone, seconds }
//              { type: 'tx-tcf', rate, seconds }                    training, then TCF zeros at rate
//              { type: 'tx-page', rate, bits, page }                training, then the page's T.4 bits
//              { type: 'rx-hs', rate }                              arm the high-speed receiver for rate
//              { type: 'page-sent', page, response }
//              { type: 'page-received', page, bits, result, response, accepted }
//              { type: 'hangup', reason, ok }
//
// [M] = from memory of T.30; [A] = our policy where the Recommendation leaves the choice to the implementer.

import { encodeFrame, decodeFrame, encodeIdent, decodeIdent, buildDIS, buildDCS, parseDIS, parseDCS, scanMsFor, POST_MESSAGE_COMMANDS } from './frames.js';
import { T30_TIMING, TimerSet, makeTimers } from './timers.js';
import { stubChecker } from './stub-page.js';

/** Implementer's choices [A]. */
export const DEFAULT_POLICY = Object.freeze({
  maxTries: 3,               // a command is sent at most three times without a valid response, then DCN [M]
  maxIdleWaits: 3,           // a receiver waits at most 3 x T2 for a command before giving up
  tcfMinErrorFreeSeconds: 1.0, // TCF passes if it holds an error-free run of zeros this long at the rate [A]
  // Page judgement from the T.4 decoder's bad-line count [A]. The plan: "the page rejected past a limit".
  mcfMaxBadRatio: 0.01, mcfMaxRun: 3,   // at or under both: MCF
  rtpMaxBadRatio: 0.05, rtpMaxRun: 8,   // at or under both: RTP (kept, but retrain); above: RTN
  maxPageResends: 3,         // a page that draws RTN is sent again after a retrain at most 3 times, then DCN [A]
  stepDownOnRtn: true,       // the retrain after RTN is at the next lower rate when there is one [A]
  sendCrp: true,             // a receiver answers a command it heard with a bad FCS by CRP
});

/**
 * The Sharp FO-70's capabilities as far as the plan knows them: V.29 and V.27ter, 9600 down to 2400 [S]; MH and MR
 * [S]; standard, fine and super fine [S]; no ECM, no MMR [A]. Widths, lengths and the minimum scan line times are
 * our assumptions until the service manual's specification page is read [A].
 */
export const DEFAULT_CAPS = Object.freeze({
  rates: [9600, 7200, 4800, 2400],
  fine: true,
  superFine: true,
  twoD: true,
  widths: [215],
  lengths: ['A4', 'B4'],
  scan: { standard: 20, fine: 10 },  // 20 ms a line, 10 ms in fine [A]
  scanHalfAtHigher: false,           // super fine at the fine figure (DIS bit 46 = 0) [A]
});

const baseCmd = (name) => name.replace(/^PRI-/, '');

export class T30Station {
  constructor(role, opts = {}) {
    this.role = role;
    this.x = role === 'caller' ? 1 : 0;   // X bit: 1 in frames from the station that received DIS [M]
    this.ident = opts.ident ?? '';
    this.caps = { ...DEFAULT_CAPS, ...(opts.caps ?? {}) };
    this.source = opts.source ?? null;      // pages to send: { pageCount, pageBits(index, params) }
    // The vertical resolution the operator chose (the FO-70's RESOLUTION key): 'standard', 'fine' or 'superfine'.
    this.wantVres = opts.vres ?? (opts.fine === false ? 'standard' : 'fine');
    this.wantTwoD = opts.twoD ?? true;
    this.eomAfter = new Set(opts.eomAfter ?? []);
    // Non-standard frames, opaque octets. The FO-70 sends none (plan.md P4); a virtual far end imitating another
    // maker may, so that the FO-70 side is tested skipping them. nsf goes before CSI/DIS, nss before TSI/DCS.
    this.nsf = opts.nsf ?? null;
    this.nss = opts.nss ?? null;
    // Extra DIS/DTC fields to advertise beyond `caps`, for virtual far ends of the late 1990s (V.17 rate code, ECM,
    // MMR, 300 dpi...: plan.md P3). Advertised only: this station still works in the base procedure.
    this.advertise = opts.advertise ?? null;
    this.checker = opts.checker ?? stubChecker();
    this.policy = { ...DEFAULT_POLICY, ...(opts.policy ?? {}) };
    this.T = makeTimers(opts.timers);
    this.timing = { ...T30_TIMING, ...(opts.timing ?? {}) };
    this.timers = new TimerSet();
    this.pending = null;
    this.afterTx = null;
    this.txBusy = false;
    this.state = 'idle';
    this.done = false;
    this.result = null;
    this.lastRx = null; this.fellBack = false;
    this.remote = { ident: null, nsf: null, dis: null, dcs: null };
    this.tx = null;     // transmitting-side state
    this.rx = null;     // receiving-side state
    this.tries = 0;
    this.pagesSent = 0;
    this.pagesReceived = 0;
    this.log = [];
    this.out = [];
  }

  // ---- step interface --------------------------------------------------------------------------------------

  get deadline() {
    if (this.done) return Infinity;
    return Math.min(this.pending ? this.pending.at : Infinity, this.timers.deadline);
  }

  start(t) { this.onStart(t); return this._drain(); }

  handle(ev, t) {
    if (this.done) return [];
    switch (ev.type) {
      case 'tx-done': {
        this.txBusy = false;
        const f = this.afterTx;
        this.afterTx = null;
        if (f) f(t);
        break;
      }
      case 'frames': this._onFrames(ev.frames, t); break;
      case 'tone': this.onTone(ev, t); break;
      case 'hs-data': this._onHighSpeed(ev, t); break;
      case 'hs-carrier':
        // A high-speed carrier at the expected rate: whatever follows may be long (a page at 2400 bit/s takes
        // minutes), so the receiver's T2 stops until the carrier ends.
        if (ev.on && this.rx?.dcs && ev.rate === this.rx.dcs.rate && (this.state === 'R.waitTCF' || this.state === 'R.waitPage')) this.timers.stop('T2');
        break;
      case 'abort': this._abort(t); break;
      default: break;
    }
    return this._drain();
  }

  advance(t) {
    for (let guard = 0; guard < 64 && !this.done; guard++) {
      const names = this.timers.expire(t);
      if (names.length) { for (const n of names) if (!this.done) this._onTimer(n, t); continue; }
      if (this.pending && this.pending.at <= t + 1e-12) {
        const p = this.pending;
        this.pending = null;
        p.fn(p.at);
        continue;
      }
      break;
    }
    return this._drain();
  }

  // ---- hooks for caller.js / answerer.js ----------------------------------------------------------------------

  onStart() {}
  onTone() {}
  onPhaseTimer() { return false; }
  /** Frames in a state the subclass owns (phase A/B identification). Return true when handled. */
  onIdentFrames() { return false; }

  // ---- helpers ---------------------------------------------------------------------------------------------

  _drain() { const o = this.out; this.out = []; return o; }
  _emit(a) { this.out.push(a); }
  _note(t, what, extra) { this.log.push({ t, state: this.state, what, ...extra }); }
  _set(state) { this.state = state; }
  later(t, dt, fn) { this.pending = { at: t + dt, fn }; }
  cancelPending() { this.pending = null; }

  frame(name, fif = null) { return { name, fif }; }

  /** Send frames in one V.21 transmission (the last marked final), then run `then(tEnd)`. */
  sendFrames(t, list, then) {
    const frames = list.map((f, i) => encodeFrame({ name: f.name, x: this.x, final: i === list.length - 1, fif: f.fif }));
    const names = list.map((f) => f.name);
    this._note(t, 'tx', { frames: names });
    this.txBusy = true;
    this.afterTx = then ?? null;
    this._emit({ type: 'tx-v21', frames, names });
  }

  sendTone(t, tone, seconds, then) {
    this._note(t, 'tx', { tone });
    this.txBusy = true;
    this.afterTx = then ?? null;
    this._emit({ type: 'tx-tone', tone, seconds });
  }

  /** Phase E: DCN, then hang up. */
  disconnect(t, reason, ok = false) {
    this.cancelPending();
    this.timers.stopAll();
    this._set('E.sendDCN');
    const go = (tt) => this.sendFrames(tt, [this.frame('DCN')], (te) => this.finish(te, reason, ok));
    if (this.txBusy) this.afterTx = (te) => this.later(te, this.timing.gap, go);
    else go(t);
  }

  finish(t, reason, ok = false) {
    if (this.done) return;
    this.cancelPending();
    this.timers.stopAll();
    this._set('done');
    this.done = true;
    // lastRx: the last frame heard (the final frame of a burst; 'BAD' when only damaged frames came), the key of the
    // Sharp communication error code table (service manual p.2-19); fellBack: the transmitter stepped its rate down.
    this.result = { reason, ok, pagesSent: this.pagesSent, pagesReceived: this.pagesReceived, lastRx: this.lastRx, fellBack: this.fellBack };
    this._note(t, 'hangup', { reason, ok });
    this._emit({ type: 'hangup', reason, ok });
  }

  _abort(t) { this._note(t, 'abort'); this.disconnect(t, 'aborted', false); }

  _onTimer(name, t) {
    this._note(t, 'timeout', { timer: name });
    if (this.onPhaseTimer(name, t)) return;
    const s = this.state;
    if (name === 'T4' && (s === 'T.waitTrainResp' || s === 'T.waitPMR')) return this._retryCommand(t);
    if (name === 'T2' && s.startsWith('R.')) return this._idleWait(t);
    if (name === 'T1') return this.disconnect(t, 'T1', false);
  }

  // ---- frame intake ----------------------------------------------------------------------------------------

  _onFrames(raw, t) {
    const good = [];
    let bad = 0;
    for (const r of raw) {
      if (!r.ok) { bad++; continue; }
      const fr = decodeFrame(r.bytes);
      if (fr.valid && fr.name) good.push(fr); else bad++;
    }
    this._note(t, 'rx', { frames: good.map((f) => f.name), bad });
    if (good.length) this.lastRx = (good.find((f) => f.final) ?? good[good.length - 1]).name;
    else if (bad) this.lastRx = 'BAD';
    if (this.rx?.disLoop && this.timers.running('T4')) this.timers.start('T4', t, this.T.T4); // heard something: wait again
    if (!good.some((f) => f.final) && bad) { this._onBadFrames(t); if (!good.length) return; }
    if (!good.length) return;
    const last = good.find((f) => f.final) ?? good[good.length - 1];
    for (const f of good) {
      if (f.name === 'CSI' || f.name === 'TSI' || f.name === 'CIG') this.remote.ident = decodeIdent(f.fif);
      if (f.name === 'NSF') this.remote.nsf = f.fif;
    }
    if (last.name === 'DCN') return this._remoteDcn(t);
    if (this.onIdentFrames(last, good, t)) return;
    const s = this.state;
    if (s.startsWith('T.')) return this._txOnResponse(last, t);
    if (s.startsWith('R.')) return this._rxOnCommand(last, t);
  }

  _onBadFrames(t) {
    // A receiver that heard a post-message command it could not read asks for it again [M]. Not in phase B:
    // there a TCF may be following the damaged DCS, so the receiver lets the transmitter's T4 (or its own DIS
    // repeat) recover. A commander just waits for T4.
    const s = this.state;
    if ((s === 'R.waitPMC' || s === 'R.waitDCN' || s === 'R.waitPage') && this.policy.sendCrp && !this.txBusy && !this.pending) {
      this.timers.stop('T2');
      this.later(t, this.timing.gap, (tt) => this.sendFrames(tt, [this.frame('CRP')], (te) => this._rxWait(te, s)));
    }
  }

  _remoteDcn(t) {
    const ok = this.state === 'R.waitDCN' || this.state === 'E.sendDCN';
    this.finish(t, ok ? 'complete' : 'remote-dcn', ok);
  }

  // ==========================================================================================================
  // Transmitting side.

  /** Start phase B as the transmitter, from the far end's DIS (or DTC when it polled us). */
  beginTransmit(t, caps) {
    const rates = this.caps.rates.filter((r) => caps.rates.includes(r)).sort((a, b) => b - a);
    if (!rates.length || !caps.canReceive) return this.disconnect(t, 'incompatible', false);
    // Only what both ends have (plan.md P3): a far end offering V.17, ECM, MMR or 300 dpi gets V.29 and MH/MR.
    let vres = this.wantVres;
    if (vres === 'superfine' && !(this.caps.superFine && caps.superFine)) vres = 'fine';
    if (vres === 'fine' && !(this.caps.fine && caps.fine)) vres = 'standard';
    this.tx = {
      rates, rateIdx: this.tx ? Math.min(this.tx.rateIdx, rates.length - 1) : 0,
      vres, fine: vres === 'fine', superFine: vres === 'superfine',
      twoD: this.wantTwoD && this.caps.twoD && caps.twoD,
      scanMs: scanMsFor(caps, vres),
      width: 215, length: 'A4',
      page: this.tx?.page ?? 0, resends: 0,
    };
    this.tries = 1;
    this.later(t, this.timing.gap, (tt) => this._sendDCS(tt));
  }

  get rate() { return this.tx ? this.tx.rates[this.tx.rateIdx] : null; }

  pageParams() {
    const x = this.tx;
    return { rate: this.rate, vres: x.vres, fine: x.fine, twoD: x.twoD, scanMs: x.scanMs, width: x.width };
  }

  _dcsFrames() {
    const x = this.tx;
    // Super fine: bit 41 set and bit 15 clear [M].
    const fif = buildDCS({ rate: this.rate, fine: x.fine, superFine: x.superFine, twoD: x.twoD, width: x.width, length: x.length, scanMs: x.scanMs });
    const list = [];
    if (this.nss) list.push(this.frame('NSS', this.nss));
    if (this.ident) list.push(this.frame('TSI', encodeIdent(this.ident)));
    list.push(this.frame('DCS', fif));
    return list;
  }

  _sendDCS(t) {
    this._set('T.sendDCS');
    this.tx.cmd = 'DCS';
    this.sendFrames(t, this._dcsFrames(), (te) => this.later(te, this.timing.gap, (tt) => this._sendTCF(tt)));
  }

  _sendTCF(t) {
    this._set('T.sendTCF');
    this._note(t, 'tx', { tcf: this.rate });
    this.txBusy = true;
    this.afterTx = (te) => { this._set('T.waitTrainResp'); this.timers.start('T4', te, this.T.T4); };
    this._emit({ type: 'tx-tcf', rate: this.rate, seconds: this.timing.tcf });
  }

  _sendPage(t) {
    const p = this.tx.page;
    this._set('T.sendPage');
    const bits = this.source.pageBits(p, this.pageParams());
    this._note(t, 'tx', { page: p, rate: this.rate, bits: bits.length });
    this.txBusy = true;
    this.afterTx = (te) => this.later(te, this.timing.gap, (tt) => { this.tries = 1; this._sendPMC(tt); });
    this._emit({ type: 'tx-page', rate: this.rate, bits, page: p });
  }

  _pmcName() {
    const p = this.tx.page;
    if (p >= this.source.pageCount - 1) return 'EOP';
    return this.eomAfter.has(p) ? 'EOM' : 'MPS';
  }

  _sendPMC(t) {
    this._set('T.sendPMC');
    const name = this._pmcName();
    this.tx.cmd = name;
    this.sendFrames(t, [this.frame(name)], (te) => { this._set('T.waitPMR'); this.timers.start('T4', te, this.T.T4); });
  }

  /** T4 expired, CRP heard, or DIS heard again: repeat the outstanding command, at most maxTries in all [M]. */
  _retryCommand(t) {
    this.timers.stop('T4');
    if (this.tries >= this.policy.maxTries) return this.disconnect(t, 'no-response', false);
    this.tries++;
    if (this.tx.cmd === 'DCS') this._sendDCS(t);
    else this._sendPMC(t);
  }

  _txOnResponse(fr, t) {
    const s = this.state;
    const name = fr.name;
    if (s === 'T.waitTrainResp') {
      if (name === 'CFR') {
        this.timers.stop('T4');
        this._note(t, 'trained', { rate: this.rate });
        this.later(t, this.timing.gap, (tt) => this._sendPage(tt));
      } else if (name === 'FTT') {
        this.timers.stop('T4');
        if (this.tx.rateIdx + 1 >= this.tx.rates.length) return this.disconnect(t, 'training-failed', false);
        this.tx.rateIdx++;
        this.tries = 1;
        this._note(t, 'step-down', { rate: this.rate });
        this.fellBack = true;
        this.later(t, this.timing.gap, (tt) => this._sendDCS(tt));
      } else if (name === 'CRP' || name === 'DIS' || name === 'DTC') {
        // The receiver did not get DCS (it repeated its DIS) or asked for a repeat.
        this.timers.stop('T4');
        if (this.tries >= this.policy.maxTries) return this.disconnect(t, 'no-response', false);
        this.tries++;
        this.later(t, this.timing.gap, (tt) => this._sendDCS(tt));
      }
      return;
    }
    if (s === 'T.waitPMR') {
      if (name === 'CRP') {
        this.timers.stop('T4');
        if (this.tries >= this.policy.maxTries) return this.disconnect(t, 'no-response', false);
        this.tries++;
        return this.later(t, this.timing.gap, (tt) => this._sendPMC(tt));
      }
      if (name !== 'MCF' && name !== 'RTP' && name !== 'RTN') return;
      this.timers.stop('T4');
      const cmd = this.tx.cmd;
      const page = this.tx.page;
      this._emit({ type: 'page-sent', page, response: name });
      this._note(t, 'page-sent', { page, response: name });
      if (name === 'RTN') {
        this.tx.resends++;
        if (this.tx.resends > this.policy.maxPageResends) return this.disconnect(t, 'page-rejected', false);
        if (this.policy.stepDownOnRtn && this.tx.rateIdx + 1 < this.tx.rates.length) this.tx.rateIdx++;
        this.tries = 1;
        return this.later(t, this.timing.gap, (tt) => this._sendDCS(tt));
      }
      this.pagesSent++;
      this.tx.resends = 0;
      if (cmd === 'EOP') return this.later(t, this.timing.gap, (tt) => this.disconnect(tt, 'complete', true));
      this.tx.page++;
      if (cmd === 'EOM') {
        // Back to phase B: wait for the receiver's DIS [M].
        this._set('T.waitDIS');
        this.timers.start('T1', t, this.T.T1);
        return;
      }
      this.tries = 1;
      if (name === 'RTP') return this.later(t, this.timing.gap, (tt) => this._sendDCS(tt)); // retrain, next page
      return this.later(t, this.timing.gap, (tt) => this._sendPage(tt));                  // MPS + MCF: next page
    }
    if (s === 'T.waitDIS' && (name === 'DIS' || name === 'DTC')) {
      this.timers.stop('T1');
      const caps = parseDIS(fr.fif);
      this.remote.dis = caps;
      return this.beginTransmit(t, caps);
    }
  }

  // ==========================================================================================================
  // Receiving side.

  /** Set up the receiving side's state (the subclass then sends DIS or DTC). */
  beginReceive() {
    if (!this.rx) this.rx = { dcs: null, lastPage: null, lastPmc: null, lastResp: null, idle: 0, awaitingNext: false };
  }

  _disFields(readyToTransmit) {
    return buildDIS({
      readyToTransmit,
      canReceive: true,
      rates: this.caps.rates,
      fine: this.caps.fine,
      superFine: this.caps.superFine,
      scanHalfAtHigher: this.caps.scanHalfAtHigher,
      twoD: this.caps.twoD,
      widths: this.caps.widths,
      lengths: this.caps.lengths,
      scan: this.caps.scan,
      ...(this.advertise ?? {}),
    });
  }

  _rxWait(t, state) {
    this._set(state);
    this.rx.idle = 0;
    this.timers.start('T2', t, this.T.T2);
  }

  _idleWait(t) {
    if (++this.rx.idle >= this.policy.maxIdleWaits) return this.disconnect(t, 'T2', false);
    this.timers.start('T2', t, this.T.T2);
  }

  _respond(t, name, then) {
    this.later(t, this.timing.gap, (tt) => {
      this._set('R.sendResp');
      this.sendFrames(tt, [this.frame(name)], then);
    });
  }

  _acceptDCS(fr, t) {
    this.timers.stop('T4');
    this.timers.stop('T1');
    this.timers.stop('T2');
    const d = parseDCS(fr.fif);
    this.rx.dcs = d;
    this.remote.dcs = d;
    if (!d.rate || !this.caps.rates.includes(d.rate)) {
      this._note(t, 'dcs-unsupported', { rate: d.rate });
      return this._respond(t, 'FTT', (te) => this._rxWait(te, 'R.waitDCS'));
    }
    this._emit({ type: 'rx-hs', rate: d.rate });
    this._rxWait(t, 'R.waitTCF');
  }

  /** TCF: zeros for 1.5 s; passes if an error-free run of tcfMinErrorFreeSeconds is found [A]. */
  judgeTcf(bits, rate) {
    let run = 0, best = 0, errors = 0;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i]) { errors++; run = 0; } else if (++run > best) best = run;
    }
    const need = Math.floor(rate * this.policy.tcfMinErrorFreeSeconds);
    return { ok: best >= need, errors, longestRun: best, bits: bits.length };
  }

  /** MCF, RTP or RTN from the page checker's result [A]. */
  judgePage(result) {
    const p = this.policy;
    if (!result || !result.lines) return 'RTN';
    const ratio = result.badLines / result.lines;
    if (ratio <= p.mcfMaxBadRatio && result.maxConsecutiveBad <= p.mcfMaxRun) return 'MCF';
    if (ratio <= p.rtpMaxBadRatio && result.maxConsecutiveBad <= p.rtpMaxRun) return 'RTP';
    return 'RTN';
  }

  _onHighSpeed(ev, t) {
    const s = this.state;
    if (!this.rx || !this.rx.dcs || ev.rate !== this.rx.dcs.rate) return;
    if (s === 'R.waitTCF') {
      this.timers.stop('T2');
      const j = this.judgeTcf(ev.bits, ev.rate);
      this._note(t, 'tcf', j);
      const resp = j.ok ? 'CFR' : 'FTT';
      return this._respond(t, resp, (te) => {
        if (resp === 'CFR') { this.rx.awaitingNext = false; this._rxWait(te, 'R.waitPage'); }
        else this._rxWait(te, 'R.waitDCS');
      });
    }
    if (s === 'R.waitPage') {
      this.timers.stop('T2');
      const params = { rate: ev.rate, vres: this.rx.dcs.vres, fine: this.rx.dcs.fine, twoD: this.rx.dcs.twoD, scanMs: this.rx.dcs.scanMs, width: this.rx.dcs.width };
      const result = this.checker(ev.bits, params);
      this.rx.lastPage = { bits: ev.bits, result, params };
      this._note(t, 'page-data', { rate: ev.rate, bits: ev.bits.length, ...result });
      this._rxWait(t, 'R.waitPMC');
    }
  }

  _rxOnCommand(fr, t) {
    const s = this.state;
    const name = fr.name;
    if (name === 'DCS') {
      // A DCS is welcome in any receiving state: first training, a retrain, or a repeat because our response was lost.
      return this._acceptDCS(fr, t);
    }
    if (!POST_MESSAGE_COMMANDS.has(name)) return;
    const cmd = baseCmd(name);
    // A repeated post-message command means our response was lost: say it again, do not judge the page twice.
    if ((s === 'R.waitDCN' || (s === 'R.waitPage' && this.rx.awaitingNext) || s === 'R.waitDCS') && this.rx.lastPmc === cmd && this.rx.lastResp) {
      this.timers.stop('T2');
      return this._respond(t, this.rx.lastResp, (te) => this._afterPmr(te, cmd, this.rx.lastResp));
    }
    if (s !== 'R.waitPMC' && s !== 'R.waitPage') return;
    this.timers.stop('T2');
    const lp = s === 'R.waitPMC' ? this.rx.lastPage : null;   // in waitPage the page never arrived
    const resp = this.judgePage(lp?.result);
    const accepted = resp !== 'RTN';
    this._emit({ type: 'page-received', page: this.pagesReceived, bits: lp?.bits ?? null, result: lp?.result ?? null, response: resp, accepted });
    this._note(t, 'page-judged', { page: this.pagesReceived, response: resp, ...(lp?.result ?? {}) });
    if (accepted) this.pagesReceived++;
    this.rx.lastPage = null;
    this.rx.lastPmc = cmd;
    this.rx.lastResp = resp;
    this._respond(t, resp, (te) => this._afterPmr(te, cmd, resp));
  }

  _afterPmr(t, cmd, resp) {
    if (resp === 'RTN' || (resp === 'RTP' && cmd !== 'EOP')) {
      if (cmd === 'EOM' && resp === 'RTP') return this.onEomAccepted(t);
      return this._rxWait(t, 'R.waitDCS');
    }
    if (cmd === 'EOP') return this._rxWait(t, 'R.waitDCN');
    if (cmd === 'EOM') return this.onEomAccepted(t);
    this.rx.awaitingNext = true;
    this._rxWait(t, 'R.waitPage');                 // MPS + MCF: the next page comes at once, same training
  }

  /** After EOM is confirmed the receiver goes back to phase B; answerer.js sends DIS again. */
  onEomAccepted(t) { this._rxWait(t, 'R.waitDCS'); }
}

