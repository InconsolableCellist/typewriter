// The drive unit's firmware (docs/fax/architecture.md 3.7): one stepper serves both trains, so moves are queued and
// run one at a time. Forward steps drive the scanning train, reverse steps the recording train (the definition's
// 'single-planetary' layout, ASSUMED); at a change of direction it first steps the changeover (the swing gear's lost
// motion and the train's backlash), counted in the definition. It ramps the step rate up and down, holds the motor at
// a reduced current after a move, then switches it off. Its only output is the motor's phase state and current; it
// reads no sensor (the scan and print controllers watch theirs while it steps, through `watch`). It never writes a
// mechanical state: it holds nothing of the mechanism but `io`.

// A deep copy for exportState/importState. Not structuredClone: the audio thread, where this state is imported at the
// handover, does not have it.
const clone = (v) => (v === null || typeof v !== 'object' ? v : ArrayBuffer.isView(v) ? v.slice()
  : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])])));

const INF = Infinity;
export const TRAIN_DIR = { scan: 1, record: -1 };

export class DriveCtl {
  /** def: machine.mech.drive; io: { setMotor(state, amp) }; owners: { name: controller } told of steps and ends. */
  constructor(def, io, { dir = 1 } = {}) {
    this.def = def; this.io = io;
    this.owners = {};
    this.state = 0;          // the phase sequence's count; the motor rests at state * step
    this.dir = dir;          // the direction of the last move: which train the planet is in (0: not known)
    this.q = [];
    this.mv = null;
    this.holdUntil = INF;
    this.nextT = INF;
    this.io.setMotor(this.state, 0);
  }

  busy() { return !!this.mv || this.q.length > 0; }

  /**
   * Queue a move of `steps` on train 'scan' or 'record' for controller `owner`, at up to `rate` steps/s. The owner's
   * driveStep(tag, t, k) is called after each counted step and may return true to end the move there (a sensor seen);
   * its driveDone(tag, t, steps) when it ends.
   */
  move({ owner, tag = null, train, steps, rate = this.def.maxRate, watch = false }, t) {
    this.q.push({ owner, tag, dir: TRAIN_DIR[train], steps: Math.max(0, steps | 0), rate, watch, pre: 0, preDone: 0, k: 0, ended: false });
    if (!this.mv) this.start(t);
  }

  start(t) {
    this.mv = this.q.shift() ?? null;
    const mv = this.mv;
    if (!mv) { this.nextT = this.holdUntil; return; }
    if (mv.dir !== this.dir) mv.pre = this.def.changeoverSteps;   // swing the planet over first
    this.dir = mv.dir;
    this.holdUntil = INF;
    if (mv.pre + mv.steps === 0) mv.ended = true;
    this.nextT = t;
  }

  /** The step rate after n steps of a move with `left` to go: a constant-acceleration ramp up and down. */
  rateAt(mv, n, left) {
    const D = this.def, s2 = D.startRate * D.startRate;
    return Math.min(mv.rate, D.maxRate, Math.sqrt(s2 + 2 * D.ramp * n), Math.sqrt(s2 + 2 * D.ramp * left));
  }

  service(t) {
    const mv = this.mv;
    if (!mv) {
      if (t >= this.holdUntil) { this.io.setMotor(this.state, 0); this.holdUntil = INF; }
      this.nextT = this.holdUntil;
      return;
    }
    if (mv.ended) { this.finish(t); return; }      // the last step's period is over
    this.state += mv.dir;
    this.io.setMotor(this.state, this.def.runCurrent);
    if (mv.preDone < mv.pre) mv.preDone++;
    else {
      mv.k++;
      if (mv.watch && this.owners[mv.owner]?.driveStep?.(mv.tag, t, mv.k)) mv.ended = true;
    }
    const left = mv.pre - mv.preDone + mv.steps - mv.k;
    if (left <= 0) mv.ended = true;
    this.nextT = t + 1 / this.rateAt(mv, mv.preDone + mv.k, mv.ended ? 0 : left);
  }

  finish(t) {
    const mv = this.mv;
    this.io.setMotor(this.state, this.def.holdCurrent);
    this.holdUntil = t + this.def.holdTime;
    this.mv = null;
    this.owners[mv.owner]?.driveDone?.(mv.tag, t, mv.k);
    if (!this.mv) this.start(t);                    // the owner may have queued the next move already
    if (!this.mv) this.nextT = this.holdUntil;
  }

  exportState() { return clone({ state: this.state, dir: this.dir, q: this.q, mv: this.mv, holdUntil: this.holdUntil, nextT: this.nextT }); }
  importState(s) { Object.assign(this, clone(s)); }
}
