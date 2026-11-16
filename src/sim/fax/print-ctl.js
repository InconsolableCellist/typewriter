// The recorder's firmware (docs/fax/architecture.md 3.7): it prints a dot line (strobes the head, waits the strobe
// time, then steps the platen one line at the resolution asked), feeds paper, and runs the cutter through one cycle:
// motor on, wait for the cam to leave home and come back, brake, off; a cutter that does not come home in time is a
// jam. It watches the paper sensor and the cover switch and reports their changes. It moves the paper only by asking
// the drive controller for steps on the recording train; its only other outputs are the head's strobe and the cutter
// motor's drive. It never writes a mechanical state.

// A deep copy for exportState/importState (no structuredClone in the audio thread).
const clone = (v) => (v === null || typeof v !== 'object' ? v : ArrayBuffer.isView(v) ? v.slice()
  : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])])));

const INF = Infinity;
const CUT_POLL = 0.5e-3;

export class PrintCtl {
  /**
   * def: { printer, cutter, stepsPerLine } from machine.mech; io: { strobe(dots, energy), setCutter(volts, closed),
   * cutterHome(), paperSensor(), coverClosed() }; drive: the drive controller; emit(event) sends a device event.
   */
  constructor(def, io, drive, emit, { t = 0 } = {}) {
    this.def = def; this.io = io; this.drive = drive; this.emit = emit;
    drive.owners.print = this;
    this.q = []; this.op = null; this.tOp = INF;
    this.paper = io.paperSensor(); this.cover = io.coverClosed(); this.since = -INF; this.coverSince = -INF;
    this.pollT = t + def.printer.pollPeriod;
    this.io.setCutter(0, false);
    this.updateNext();
  }

  busy() { return !!this.op || this.q.length > 0; }
  updateNext() { this.nextT = Math.min(this.pollT, this.tOp); }

  /**
   * { op: 'line', id, dots, energy, res }: print one dot line and step one line. { op: 'feed', id, lines, res } or
   * { op: 'feed', id, steps }: paper on. { op: 'cut', id }: one cutter cycle.
   */
  command(m, t) {
    if (!['line', 'feed', 'cut'].includes(m.op)) return;
    this.q.push({ kind: m.op, id: m.id ?? null, res: m.res ?? 'standard', dots: m.dots ?? null, energy: m.energy ?? 0,
      lines: m.lines ?? 1, steps: m.steps ?? null, stage: '' });
    if (!this.op) this.next(t);
    this.updateNext();
  }

  next(t) {
    const op = (this.op = this.q.shift() ?? null);
    this.tOp = INF;
    if (op) this.begin(op, t);
    this.updateNext();
  }

  begin(op, t) {
    const P = this.def.printer;
    if (op.kind !== 'cut' && !this.io.coverClosed()) { this.finish(t, 'coverOpen'); return; }
    if (op.kind === 'line') {
      if (!this.io.paperSensor()) { this.finish(t, 'noPaper'); return; }
      this.io.strobe(op.dots, op.energy);
      op.stage = 'strobe';
      this.tOp = t + P.strobeBlocks * P.strobeTime;      // the blocks fire one after another before the paper moves
    } else if (op.kind === 'feed') {
      op.stage = 'feed';
      const steps = op.steps ?? op.lines * (this.def.stepsPerLine[op.res] ?? 0);
      this.drive.move({ owner: 'print', train: 'record', steps }, t);
    } else {
      op.stage = 'leave';
      op.t0 = t;
      this.io.setCutter(this.def.cutter.volts, true);
      this.tOp = t + CUT_POLL;
    }
  }

  driveDone(_tag, t) {
    const op = this.op;
    if (!op) return;
    if (op.stage === 'line' || op.stage === 'feed') this.finish(t, null, op.kind);
  }

  finish(t, error, ev = 'error') {
    const op = this.op;
    this.op = null; this.tOp = INF;
    this.emit(error ? { dev: 'print', ev: 'error', error, id: op.id, op: op.kind, t } : { dev: 'print', ev, id: op.id, t });
    this.next(t);
  }

  service(t) {
    const op = this.op, C = this.def.cutter, P = this.def.printer;
    if (op && t >= this.tOp) {
      this.tOp = INF;
      if (op.stage === 'strobe') {
        op.stage = 'line';
        this.drive.move({ owner: 'print', train: 'record', steps: this.def.stepsPerLine[op.res] ?? 0 }, t);
      } else if (op.stage === 'leave' || op.stage === 'return') {
        const home = this.io.cutterHome();
        if (op.stage === 'leave' && !home) op.stage = 'return';
        else if (op.stage === 'return' && home) { this.io.setCutter(0, true); op.stage = 'brake'; this.tOp = t + C.brakeTime; }
        if (op.stage !== 'brake') {
          if (t - op.t0 > C.timeout) { this.io.setCutter(0, false); this.finish(t, 'cutterJam'); }
          else this.tOp = t + CUT_POLL;
        }
      } else if (op.stage === 'brake') {
        this.io.setCutter(0, false);
        this.finish(t, null, 'cut');
      }
    }
    if (t >= this.pollT) {
      // The paper sensor and the cover switch, debounced.
      const paper = this.io.paperSensor(), cover = this.io.coverClosed();
      if (paper === this.paper) this.since = -INF;
      else if (this.since === -INF) this.since = t;
      else if (t - this.since >= P.debounce) { this.paper = paper; this.since = -INF; this.emit({ dev: 'print', ev: 'paper', present: paper, t }); }
      if (cover === this.cover) this.coverSince = -INF;
      else if (this.coverSince === -INF) this.coverSince = t;
      else if (t - this.coverSince >= P.debounce) { this.cover = cover; this.coverSince = -INF; this.emit({ dev: 'print', ev: 'cover', closed: cover, t }); }
      this.pollT = t + P.pollPeriod;
    }
    this.updateNext();
  }

  exportState() {
    return clone({ q: this.q, op: this.op, tOp: this.tOp, paper: this.paper, cover: this.cover, since: this.since, coverSince: this.coverSince, pollT: this.pollT, nextT: this.nextT });
  }
  importState(s) { Object.assign(this, clone(s)); }
}
