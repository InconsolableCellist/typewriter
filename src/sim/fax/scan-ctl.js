// The document feed's firmware (docs/fax/architecture.md 3.7): it watches the document sensor and reports a sheet
// laid on the table; it pre-feeds the bottom sheet until the registration sensor sees its leading edge and on to the
// first line under the contact image sensor (or reports a misfeed); it feeds one line at the resolution asked; it runs
// a sheet out past the registration sensor and the feed roller. It moves the document only by asking the drive
// controller for steps on the scanning train, and reads only its two sensors. It never writes a mechanical state.

// A deep copy for exportState/importState (no structuredClone in the audio thread).
const clone = (v) => (v === null || typeof v !== 'object' ? v : ArrayBuffer.isView(v) ? v.slice()
  : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])])));

const INF = Infinity;

export class ScanCtl {
  /**
   * def: machine.mech.feeder; stepsPerLine: machine.mech.drive.stepsPerLine; io: { docSensor(), regSensor() };
   * drive: the drive controller (drive-ctl.js); emit(event) sends a device event.
   */
  constructor(def, stepsPerLine, io, drive, emit, { t = 0 } = {}) {
    this.def = def; this.spl = stepsPerLine; this.io = io; this.drive = drive; this.emit = emit;
    drive.owners.scan = this;
    this.q = []; this.op = null;
    this.present = io.docSensor(); this.since = -INF;
    this.pollT = t + def.pollPeriod;
    this.nextT = this.pollT;
  }

  busy() { return !!this.op || this.q.length > 0; }

  /** { op: 'prefeed' | 'line' | 'eject', id, res ('standard' | 'fine' | 'superfine') }. */
  command(m, t) {
    if (!['prefeed', 'line', 'eject'].includes(m.op)) return;
    this.q.push({ kind: m.op, id: m.id ?? null, res: m.res ?? 'standard', stage: '' });
    if (!this.op) this.next(t);
  }

  next(t) {
    const op = (this.op = this.q.shift() ?? null);
    if (!op) return;
    const D = this.def;
    if (op.kind === 'prefeed') {
      if (!this.io.docSensor() && !this.io.regSensor()) { this.finish(t, 'noDocument'); return; }
      if (this.io.regSensor()) { op.stage = 'settle'; this.drive.move({ owner: 'scan', train: 'scan', steps: 0 }, t); return; }
      op.stage = 'seek';
      this.drive.move({ owner: 'scan', train: 'scan', steps: D.maxPrefeedSteps, watch: true }, t);
    } else if (op.kind === 'line') {
      const n = this.spl[op.res];
      if (!n) { this.finish(t, 'resolution'); return; }
      op.stage = 'line';
      this.drive.move({ owner: 'scan', train: 'scan', steps: n }, t);
    } else if (op.kind === 'eject') {
      op.stage = 'clear';
      this.drive.move({ owner: 'scan', train: 'scan', steps: D.maxSheetSteps, watch: true }, t);
    }
  }

  /** Called by the drive after each step of a watched move: true ends the move here. */
  driveStep(_tag, _t) {
    const op = this.op;
    if (op?.stage === 'seek') return this.io.regSensor();
    if (op?.stage === 'clear') return !this.io.regSensor();
    return false;
  }

  /** Called by the drive when a move ends. */
  driveDone(_tag, t) {
    const op = this.op, D = this.def;
    if (!op) return;
    switch (op.stage) {
      case 'seek':
        if (!this.io.regSensor()) { this.finish(t, 'misfeed'); return; }
        op.stage = 'settle';
        this.drive.move({ owner: 'scan', train: 'scan', steps: D.regToRead }, t);
        return;
      case 'settle': this.finish(t, null, 'ready'); return;
      case 'line': this.finish(t, null, 'line'); return;
      case 'clear':
        if (this.io.regSensor()) { this.finish(t, 'jam'); return; }
        op.stage = 'out';
        this.drive.move({ owner: 'scan', train: 'scan', steps: D.ejectSteps }, t);
        return;
      case 'out': this.finish(t, null, 'ejected'); return;
    }
  }

  finish(t, error, ev = 'error') {
    const op = this.op;
    this.op = null;
    this.emit(error ? { dev: 'scan', ev: 'error', error, id: op.id, op: op.kind, t } : { dev: 'scan', ev, id: op.id, res: op.res, t });
    this.next(t);
  }

  /** The document sensor, polled and debounced. */
  service(t) {
    if (t >= this.pollT) {
      const raw = this.io.docSensor();
      if (raw === this.present) this.since = -INF;
      else if (this.since === -INF) this.since = t;
      else if (t - this.since >= this.def.debounce) { this.present = raw; this.since = -INF; this.emit({ dev: 'scan', ev: 'document', present: raw, t }); }
      this.pollT = t + this.def.pollPeriod;
    }
    this.nextT = this.pollT;
  }

  exportState() { return clone({ q: this.q, op: this.op, present: this.present, since: this.since, pollT: this.pollT, nextT: this.nextT }); }
  importState(s) { Object.assign(this, clone(s)); }
}
