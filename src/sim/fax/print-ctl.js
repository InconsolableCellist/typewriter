// The recorder's firmware (docs/fax/architecture.md 3.7): it prints a dot line (strobes the head, waits the strobe
// time, then steps the platen one line at the resolution asked), feeds paper, and runs the cutter through one cycle.
// The cutter has no motor of its own [S p.3-7/pdf41]: a cycle is a jog of the drive that steps the mode cam to the
// cutter (the cam switch opens), the cutter train turned until the cutter switch has opened and made again, and a jog
// back (the cam switch makes) [A: the sequence; S: the two switches, CSWI and CUTI, p.4-3/pdf51]. A crank that does not
// come home within its steps is a jam. It watches the paper sensor and the door sensor and reports their changes. It
// moves the paper and the cutter only by asking the drive controller for steps; its only other output is the head's
// strobe. It never writes a mechanical state.

// A deep copy for exportState/importState (no structuredClone in the audio thread).
const clone = (v) => (v === null || typeof v !== 'object' ? v : ArrayBuffer.isView(v) ? v.slice()
  : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])])));

const INF = Infinity;

export class PrintCtl {
  /**
   * def: { printer, cutter, stepsPerLine } from machine.mech; io: { strobe(dots, energy), cutterHome(), camHome(),
   * paperSensor(), coverClosed() }; drive: the drive controller; emit(event) sends a device event.
   */
  constructor(def, io, drive, emit, { t = 0 } = {}) {
    this.def = def; this.io = io; this.drive = drive; this.emit = emit;
    drive.owners.print = this;
    this.q = []; this.op = null; this.tOp = INF;
    this.paper = io.paperSensor(); this.cover = io.coverClosed(); this.since = -INF; this.coverSince = -INF;
    this.pollT = t + def.printer.pollPeriod;
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
    // The mode cam left at the cutter (a cut that jammed): a jog brings it back to the platen first.
    if (op.kind !== 'cut' && !this.io.camHome() && op.stage !== 'mode') {
      op.stage = 'mode';
      this.drive.move({ owner: 'print', train: 'jog' }, t);
      return;
    }
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
      op.jam = false;
      if (this.io.camHome()) { op.stage = 'toCut'; this.drive.move({ owner: 'print', train: 'jog' }, t); }
      else this.crank(op, t);
    }
  }

  /** Turn the cutter train until its switch has opened and made again. */
  crank(op, t) {
    op.stage = 'cutting'; op.left = false;
    this.drive.move({ owner: 'print', train: 'cut', steps: this.def.cutter.maxSteps, watch: true }, t);
  }

  driveStep(_tag, _t) {
    const op = this.op;
    if (!op || op.stage !== 'cutting') return false;
    const home = this.io.cutterHome();
    if (!home) op.left = true;
    return home && op.left;
  }

  driveDone(_tag, t) {
    const op = this.op;
    if (!op) return;
    if (op.stage === 'line' || op.stage === 'feed') this.finish(t, null, op.kind);
    else if (op.stage === 'mode') {
      // A motor that lost steps in a jam may need more than one jog to find the cam [A: three tries].
      op.tries = (op.tries ?? 0) + 1;
      if (this.io.camHome()) { op.stage = ''; this.begin(op, t); }
      else if (op.tries < 3) this.drive.move({ owner: 'print', train: 'jog' }, t);
      else this.finish(t, 'cutterJam');
    } else if (op.stage === 'toCut') {
      if (this.io.camHome()) this.finish(t, 'cutterJam');          // the cam did not step: nothing reaches the cutter
      else this.crank(op, t);
    } else if (op.stage === 'cutting') {
      op.jam = !(op.left && this.io.cutterHome());
      op.stage = 'toHome';
      this.drive.move({ owner: 'print', train: 'jog' }, t);
    } else if (op.stage === 'toHome') {
      this.finish(t, op.jam || !this.io.camHome() ? 'cutterJam' : null, 'cut');
    }
  }

  finish(t, error, ev = 'error') {
    const op = this.op;
    this.op = null; this.tOp = INF;
    this.emit(error ? { dev: 'print', ev: 'error', error, id: op.id, op: op.kind, t } : { dev: 'print', ev, id: op.id, t });
    this.next(t);
  }

  service(t) {
    const op = this.op, P = this.def.printer;
    if (op && t >= this.tOp) {
      this.tOp = INF;
      if (op.stage === 'strobe') {
        op.stage = 'line';
        this.drive.move({ owner: 'print', train: 'record', steps: this.def.stepsPerLine[op.res] ?? 0 }, t);
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
