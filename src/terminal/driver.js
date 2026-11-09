// The compositor's hands: takes parsed teletype ops and works the real machine, one keystroke at a time. Nothing here
// deposits ink. Pace comes from the machine's own state: the last key must be up, the escapement back at rest, the
// previous bar clear of the guide and the carriage arriving at its next position. In fast mode the mechanism runs
// with `typing.unlimited` (no bar collisions, one pitch per keystroke), and a key may go down every few milliseconds.
import { STROKE } from '../interact/keyboard.js';

export const FORCE_N = 34;                    // fixed, like a steady even touch; a key's own finger factor still applies
export const PACE = {
  keyUpM: 0.0015,                             // key height below which it counts as returned
  rockerRest: 0.08,                           // rocker fraction: the escapement has settled
  minPressGapS: 0.085,                        // press duration plus the finger starting back up (standard pace)
  barGateRad: 1.2,                            // previous bar must be below this angle on its way back (standard pace)
  strikeFlightS: 0.054,                       // press to impact; the carriage must arrive within it
  strikeMarginS: 0.012,
  carriageSettleMmS: 3,                       // mm/s
  carriageGiveUpS: 0.5,                       // the carriage stopped short of where it was going: carry on anyway
  minGapFastS: 0.022,                         // the fastest a finger can be put down in fast mode
  shiftEpsM: 0.00008,
  shiftRateMS: 0.01,                          // m/s
  strikeTimeoutS: 0.6,
  jamBarRad: 0.25, jamHoldS: 0.8,
  bellHoldS: 0.2,
  crSpeed: 0.28,                              // m/s of a bare carriage return slide by hand
  crTimeoutS: 3,
};

export class PrintDriver {
  constructor({ sim, geometry, machine, hands, charMap, paper = null, rng = Math.random, now = null }) {
    this.sim = sim; this.g = geometry; this.m = machine; this.hands = hands; this.map = charMap; this.paper = paper; this.rng = rng;
    this.L = sim.layout;
    this.queue = []; this.head = 0;
    this.pending = [];        // strikes fired and not yet reported by the mechanism, in order
    this.shiftHeld = false; this.shiftGrab = null;
    this.hold = null;         // a multi-tick action in progress: newline, bare CR, sheet change, jam clearing
    this.speed = 'standard';
    this.lastFireT = -1; this.lastBar = -1; this.lastKey = -1;
    this.targetCx = null;     // where the carriage should settle after the last spacing action
    this.jamT = new Float32Array(geometry.nPrint);
    this.lastTickT = null;
    this.shiftRate = 0;
    this.stats = { fired: 0, struck: 0, lost: 0, retries: 0, mismatches: 0, jams: 0, newlines: 0, lineErrors: 0, sheets: 0, bells: 0, firstFireT: null, lastStrikeT: null };
    this.nowFn = now ?? (() => sim.state[this.L.time]);
    this.onStrike = this.onStrike.bind(this);
    sim.on('strike', this.onStrike);
  }

  // ---- queue ----------------------------------------------------------------------------
  enqueue(ops) {
    for (const op of ops) {
      this.queue.push(op);
      this.collapseErase();
    }
  }

  /**
   * A shell deletes a character by sending BS, space, BS. On a screen that blanks the cell; on paper nothing can be
   * blanked, so all it would do is walk the carriage back, forward and back again. The net move is one step back.
   */
  collapseErase() {
    const q = this.queue, n = q.length;
    if (n - this.head < 3) return;
    if (q[n - 3].t === 'bs' && q[n - 2].t === 'char' && q[n - 2].ch === ' ' && q[n - 1].t === 'bs') q.length = n - 2;
  }
  get queued() { return this.queue.length - this.head; }
  get idle() { return this.queued === 0 && !this.hold && this.pending.length === 0; }
  next() { return this.head < this.queue.length ? this.queue[this.head] : null; }
  shift() {
    const op = this.queue[this.head++];
    if (this.head > 4096 && this.head * 2 > this.queue.length) { this.queue.splice(0, this.head); this.head = 0; }
    return op;
  }

  /** Ctrl-C: drop everything not yet struck. Physical actions under way finish; the queue does not resume. */
  clear() { this.queue.length = 0; this.head = 0; }

  setSpeed(mode) {
    if (mode === this.speed) return;
    this.speed = mode;
  }

  // ---- strikes reported back from the mechanism ----------------------------------------
  onStrike(evt) {
    const i = this.pending.findIndex((p) => p.key === evt.bar);
    if (i < 0) return;   // a press by the user, or a rebound
    const p = this.pending[i];
    this.pending.splice(i, 1);
    const k = this.g.keys[evt.bar];
    const got = evt.char ?? (evt.caseIndex ? k.upper : k.lower);
    if (got === p.ch) this.stats.struck++;
    else { this.stats.mismatches++; this.stats.lastMismatch = `wanted '${p.ch}' got '${got}'`; }
    this.stats.lastStrikeT = this.nowFn();
    this.stats.lastCh = got;
  }

  // ---- physics readouts -----------------------------------------------------------------
  pitch() { return this.m.escapement.pitch; }

  keyUp(st) {
    if (this.lastKey < 0) return true;
    return st[this.L.keyX + this.lastKey] < PACE.keyUpM;
  }

  /** True when the escapement could take the next keystroke and the carriage will be in place by the time the slug lands. */
  readyForNext(st, t) {
    if (this.speed === 'fast') return t - this.lastFireT >= PACE.minGapFastS;
    if (t - this.lastFireT < PACE.minPressGapS) return false;   // the finger is still on its way: the key cannot have returned yet
    if (!this.keyUp(st)) return false;
    if (Math.abs(st[this.L.rocker]) > PACE.rockerRest) return false;
    if (this.pending.length > 0) return false;                         // never fire over an unconfirmed strike
    for (let i = 0; i < this.g.nPrint; i++) if (i !== this.lastBar && st[this.L.barTheta + i] > PACE.jamBarRad) return false;   // another bar is up: let it clear (or be freed) first
    if (this.lastBar >= 0 && st[this.L.barTheta + this.lastBar] > PACE.barGateRad) return false;
    if (this.targetCx === null) return true;
    const remain = Math.abs(st[this.L.carriageX] - this.targetCx), speed = Math.abs(st[this.L.carriageV]);
    if (speed * 1000 < PACE.carriageSettleMmS && (remain < 0.5 * this.pitch() || t - this.lastFireT > PACE.carriageGiveUpS)) return true;
    return speed > 0.004 && remain / speed < PACE.strikeFlightS - PACE.strikeMarginS;
  }

  shiftTarget(wanted) { return wanted ? this.m.carriage.shiftTravel : 0; }

  /** Near the stop and no longer moving: a character struck while the carriage is still dropping prints low. */
  shiftSettled(st, wanted) {
    return Math.abs(st[this.L.shiftY] - this.shiftTarget(wanted)) < PACE.shiftEpsM && Math.abs(this.shiftRate) < PACE.shiftRateMS;
  }

  setShift(wanted) {
    if (wanted === this.shiftHeld) return;
    this.shiftHeld = wanted;
    if (wanted) {
      const k = this.g.keys[this.map.shiftL];
      this.shiftGrab = this.sim.grab('key', this.map.shiftL, { target: k.travel * 1.5, k: 2200, c: 18, maxF: 30 });
    } else if (this.shiftGrab) { this.sim.release(this.shiftGrab); this.shiftGrab = null; }
  }

  // ---- the main tick ----------------------------------------------------------------------
  tick() {
    const st = this.sim.state;
    const t = this.nowFn();
    if (this.shiftPrevT !== undefined && t > this.shiftPrevT) this.shiftRate = (st[this.L.shiftY] - this.shiftPrevY) / (t - this.shiftPrevT);
    this.shiftPrevY = st[this.L.shiftY]; this.shiftPrevT = t;
    if (this.sim.unlocking) return;                 // the mechanism is being handed to the audio thread; a press now would be lost
    this.checkPending(t);
    if (this.hold && !this.stepHold(st, t)) return;
    if (this.checkJam(st, t)) return;
    const op = this.next();
    if (!op) { if (this.queued === 0 && this.pending.length === 0 && this.shiftHeld) this.setShift(false); return; }
    if (op.t === 'screen') { this.shift(); this.onScreen?.(); return; }
    if (!this.readyForNext(st, t)) return;
    switch (op.t) {
      case 'char': return this.fireChar(op, st, t);
      case 'bs': return this.fireControl(this.map.backspace, 0.9, -1, st, t);
      case 'bel':
        this.shift(); this.sim.flickBell?.(); this.stats.bells++; this.onBell?.();
        this.hold = { kind: 'wait', until: t + PACE.bellHoldS };
        return;
      case 'nl': return this.startNewline(st, t);
      case 'cr': return this.startBareCR(st, t);
      default: this.shift();
    }
  }

  fireChar(op, st, t) {
    const entry = op.ch === ' ' ? { key: this.map.space, shift: false, glyph: null } : this.map.get(op.ch) ?? this.map.get('?');
    const isSpace = op.ch === ' ';
    // Space prints nothing, so it can be struck in whichever case the carriage is in; a run of capitals keeps shift down.
    const wantShift = isSpace ? this.shiftHeld : entry.shift;
    if (wantShift !== this.shiftHeld) { this.setShift(wantShift); return; }
    if (!this.shiftSettled(st, wantShift)) return;
    this.shift();
    this.press(entry.key, isSpace ? FORCE_N * 0.8 : FORCE_N * (this.g.keys[entry.key].finger ?? 1), entry.glyph, 1, st, t);
    if (!isSpace) this.pending.push({ key: entry.key, ch: op.ch, t, op, retried: !!op.retried, cx: st[this.L.carriageX] });
  }

  fireControl(key, scale, dir, st, t) { this.shift(); this.press(key, FORCE_N * scale, null, dir, st, t); }

  /** @param dir +1 if this key advances the carriage one pitch, -1 for the backspace key. */
  press(key, force, glyph, dir, st, t) {
    const k = this.g.keys[key];
    const pinky = (k.finger ?? 1) <= 0.9;
    const spread = pinky ? STROKE.pinkyJitter : STROKE.jitter;
    const jitter = (pinky ? STROKE.pinkyBias : 1) * (1 + (this.rng() * 2 - 1) * spread);
    this.sim.pressKey(key, force * jitter, STROKE.durationS, glyph ?? undefined);
    this.lastKey = key; this.lastBar = key < this.g.nPrint ? key : -1;
    this.lastFireT = t;
    if (this.stats.firstFireT === null) this.stats.firstFireT = t;
    this.stats.fired++;
    // Measured from the last place the carriage was headed, so firing into a moving carriage does not accumulate error.
    const from = this.targetCx !== null && Math.abs(st[this.L.carriageX] - this.targetCx) < 1.5 * this.pitch() ? this.targetCx : st[this.L.carriageX];
    this.targetCx = from + dir * this.m.carriage.typingDirection * this.pitch();
  }

  // ---- housekeeping --------------------------------------------------------------------
  checkPending(t) {
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (t - p.t < PACE.strikeTimeoutS) break;
      this.pending.splice(i, 1); i--;
      const st = this.sim.state;
      const moved = Math.abs(st[this.L.carriageX] - p.cx) > this.pitch() * 0.3;
      if (!p.retried && !moved && this.speed !== 'fast') {
        p.op.retried = true;
        this.queue.splice(this.head, 0, p.op);
        this.stats.retries++;
      } else this.stats.lost++;
    }
  }

  checkJam(st, t) {
    if (this.hold) return false;
    const dt = this.lastTickT === null ? 0 : Math.max(0, t - this.lastTickT);
    this.lastTickT = t;
    let jammed = false;
    for (let i = 0; i < this.g.nPrint; i++) {
      this.jamT[i] = st[this.L.barTheta + i] > PACE.jamBarRad ? this.jamT[i] + dt : 0;
      if (this.jamT[i] > PACE.jamHoldS) jammed = true;
    }
    if (!jammed) return false;
    this.jamT.fill(0);
    this.stats.jams++;
    this.hands.freeBars();
    this.hold = { kind: 'jam', until: t + 3 };
    return true;
  }

  /** Advance a multi-tick action. Returns true when it has finished and the queue may proceed. */
  stepHold(st, t) {
    const h = this.hold;
    switch (h.kind) {
      case 'wait':
        if (t < h.until) return false;
        break;
      case 'jam': {
        let up = false;
        for (let i = 0; i < this.g.nPrint; i++) if (st[this.L.barTheta + i] > 0.05) up = true;
        if (up && t < h.until) return false;
        this.targetCx = null;
        break;
      }
      case 'nl': {
        if (this.hands.busy) return false;
        if (Math.abs(st[this.L.carriageV]) > 0.01) return false;
        const delta = Math.abs(st[this.L.platenPsi] - h.psi0);
        const tooth = (2 * Math.PI) / this.m.platen.ratchetTeeth;
        const space = this.lineStep(st, tooth);
        if (Math.abs(delta - space) > 0.3 * tooth) this.stats.lineErrors++;
        this.stats.lastLineDelta = delta;
        this.stats.newlines++;
        this.targetCx = null;
        if (this.paper?.needsNewSheet()) {
          this.stats.sheets++;
          const sheet = { kind: 'sheet', done: false };
          this.hold = sheet;
          Promise.resolve(this.paper.newSheet()).catch((e) => console.warn('terminal: new sheet failed', e)).finally(() => { sheet.done = true; });
          return false;
        }
        break;
      }
      case 'sheet':
        if (!h.done) return false;
        break;
      case 'cr': {
        const target = st[this.L.marginL];
        const f = Math.min(1, (t - h.t0) * PACE.crSpeed / Math.max(1e-4, target - h.x0));
        this.sim.moveGrab(h.carriage, h.x0 + (target - h.x0) * f);
        if ((st[this.L.carriageX] < target - 0.0006 || Math.abs(st[this.L.carriageV]) > 0.01) && t - h.t0 < PACE.crTimeoutS) return false;
        this.sim.release(h.carriage);
        // The lever latches, so the hand has to put it back before letting go.
        this.sim.moveGrab(h.release, 0);
        this.hold = { kind: 'crRelease', release: h.release, until: t + 0.5 };
        this.targetCx = null;
        return false;
      }
      case 'crRelease':
        if (st[this.L.carriageRelease] > 0.03 && t < h.until) return false;
        this.sim.release(h.release);
        break;
      default: break;
    }
    this.hold = null;
    return true;
  }

  lineStep(st, tooth) {
    const setting = st[this.L.lineSpaceSetting];
    const teeth = this.m.lineSpace.pawlTeethPerSpace[Math.max(0, Math.round(setting) - 1)] ?? 1;
    return teeth * tooth;
  }

  startNewline(st, t) {
    if (this.shiftHeld) { this.setShift(false); return; }
    if (!this.shiftSettled(st, false)) return;
    if (this.pending.length > 0 || this.hands.busy || !this.keyUp(st)) return;
    this.shift();
    this.hold = { kind: 'nl', psi0: st[this.L.platenPsi], t0: t };
    this.hands.carriageReturn();
  }

  /** A carriage return with no line space: the left hand lifts the release lever and slides the carriage to the margin. */
  startBareCR(st, t) {
    if (this.shiftHeld) { this.setShift(false); return; }
    if (!this.shiftSettled(st, false)) return;
    if (this.pending.length > 0 || !this.keyUp(st)) return;
    this.shift();
    const x0 = st[this.L.carriageX];
    if (x0 >= st[this.L.marginL] - 0.0012) { this.targetCx = null; return; }
    const release = this.sim.grab('carriageRelease', 0, { target: 0.35, k: 2, c: 0.03, maxF: 0.8 });
    const carriage = this.sim.grab('carriage', 0, { target: x0, k: 600, c: 30, maxF: 40 });
    this.hold = { kind: 'cr', t0: t, x0, release, carriage };
  }

  /** Letting go: nothing left held, and no fast-mode overrides left active. */
  shutdown() {
    this.clear();
    if (this.shiftGrab) { this.sim.release(this.shiftGrab); this.shiftGrab = null; this.shiftHeld = false; }
    if (this.hold?.carriage) this.sim.release(this.hold.carriage);
    if (this.hold?.release) { const g = this.hold.release; this.sim.moveGrab(g, 0); setTimeout(() => this.sim.release(g), 200); }
    this.hold = null;
    this.pending.length = 0;
  }
}
