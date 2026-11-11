// The diskette adapter's firmware (architecture.md 8.3; HW 3.5, 3.7): one adapter for both drives, one operation at
// a time. It steps the head one phase every 5 ms and waits 35 ms after the last step; it recalibrates by stepping
// back at least 77 times against the stop pin, ending on track 00's phase; it loads the head and waits for the
// wanted sector's ID field to come past; it counts sectors passing to the end of the transfer; it retries three
// times; it watches the index period and the lever switch for ready and not ready, and lifts the head after 2 s idle.
// Event driven: it holds deadlines on the host's clock, and the mechanism interrupts it with index pulses, lever
// switch changes and ID fields. Its only outputs are the head stepper's phases, the head-load solenoid and device
// events. It never writes a mechanical state: it holds nothing of the mechanism but `io`.

const INF = Infinity;
const mod = (a, n) => ((a % n) + n) % n;

export class DisketteCtl {
  /** def: machine.diskettes; io: drives and sensors (diskette-mech.js); emit(event) sends a device event. */
  constructor(def, io, emit, { loaded = [false, false], t = 0 } = {}) {
    this.def = def; this.io = io; this.emit = emit;
    this.reset(loaded, t);
  }

  get rotation() { return 60 / this.def.rpm; }

  /** Power on. A drive loaded at a warm start is ready; where its head stands is not known until a recalibrate. */
  reset(loaded, t) {
    const A = this.def.adapter;
    this.dr = [0, 1].map((i) => ({
      ready: loaded[i], type: loaded[i] ? this.io.mediaType(i) : null,
      lastIdx: -1, tWatch: loaded[i] ? t + 2 * A.maxPeriod : INF,
      state: 0, base: 0, known: false, head: false, tUnload: INF,
    }));
    this.q = [];
    this.op = null;
    this.tOp = INF;
    for (let i = 0; i < 2; i++) { this.io.setHead(i, 0, 1); this.io.setHeadLoad(i, false); }
    this.updateNext();
  }

  updateNext() { this.nextT = Math.min(this.tOp, this.dr[0].tWatch, this.dr[1].tWatch, this.dr[0].tUnload, this.dr[1].tUnload); }

  status(i) { const d = this.dr[i]; return d.ready ? { ready: true, type: d.type } : { ready: false }; }
  /** The track the adapter believes the head is on, or -1 before a recalibrate. */
  track(i) { const d = this.dr[i]; return d.known ? d.state - d.base : -1; }
  busy() { return !!this.op || this.q.length > 0; }

  // ---- commands from the software (7.6) --------------------------------------------------------------------------
  /** { op: 'transfer', id, drive, side, track, sector, count, write } or { op: 'recalibrate', id, drive }. */
  command(m, t) {
    if (m.op !== 'transfer' && m.op !== 'recalibrate') return;
    this.q.push({ kind: m.op, id: m.id, drive: m.drive | 0, side: m.side | 0, track: m.track | 0, sector: m.sector | 0,
      count: Math.max(1, m.count | 0), write: !!m.write, phase: 'start', left: 0, dir: 0, retries: 0 });
    if (!this.op) this.next(t);
    this.updateNext();
  }

  next(t) {
    this.op = this.q.shift() ?? null;
    this.tOp = INF;
    if (this.op) this.begin(t);
  }

  /** (Re)start the operation in hand: recalibrate first when the head's track is not known. */
  begin(t) {
    const op = this.op, d = this.dr[op.drive];
    d.tUnload = INF;
    if (!d.ready) { op.phase = 'fail'; this.tOp = t + 2 * this.rotation; return; }
    if (op.kind === 'transfer' && (op.track < 0 || op.track >= this.def.head.tracks)) { this.finish(t, 'seek'); return; }
    if (op.kind === 'recalibrate' || !d.known) {
      // Step back at least 77 times, ending on the phase of track 00 (the stop pin holds the head there).
      op.phase = 'recal'; op.dir = -1;
      op.left = this.def.adapter.recalSteps + mod(d.state - this.def.adapter.recalSteps, 4);
      this.stepOn(t);
      return;
    }
    this.seek(t);
  }

  seek(t) {
    const op = this.op, n = op.track - this.track(op.drive);
    op.phase = 'seek';
    if (n === 0) { this.load(t); return; }
    op.dir = Math.sign(n); op.left = Math.abs(n);
    this.stepOn(t);
  }

  /** One step now; the next one a step time later, or the settle after the last. */
  stepOn(t) {
    const op = this.op, d = this.dr[op.drive], A = this.def.adapter;
    d.state += op.dir;
    this.io.setHead(op.drive, d.state, 1);
    op.left--;
    if (op.left > 0) { this.tOp = t + A.stepTime; return; }
    op.phase = op.phase === 'recal' ? 'recalSettle' : 'settle';
    this.tOp = t + A.stepTime + A.settle;
  }

  load(t) {
    const op = this.op, d = this.dr[op.drive];
    if (!d.head) { this.io.setHeadLoad(op.drive, true); d.head = true; }
    op.phase = 'search';
    this.tOp = t + this.def.adapter.searchTurns * this.rotation;
  }

  finish(t, error) {
    const op = this.op, d = this.dr[op.drive];
    this.emit(error ? { id: op.id, ok: false, error, t } : { id: op.id, ok: true, t });
    if (d.head) d.tUnload = t + this.def.adapter.headUnload;
    this.next(t);
  }

  retry(t, error) {
    const op = this.op;
    if (++op.retries > this.def.adapter.retries) { this.finish(t, error); return; }
    this.dr[op.drive].known = false;
    this.begin(t);
  }

  // ---- deadlines ----------------------------------------------------------------------------------------------
  /** Called by the host whenever its clock passes nextT. */
  service(t) {
    for (let i = 0; i < 2; i++) {
      const d = this.dr[i];
      if (t >= d.tWatch) { d.tWatch = INF; d.lastIdx = -1; if (d.ready) this.notReady(i, t); }
      if (t >= d.tUnload) { d.tUnload = INF; d.head = false; this.io.setHeadLoad(i, false); }
    }
    if (this.op && t >= this.tOp) {
      const op = this.op, d = this.dr[op.drive];
      this.tOp = INF;
      switch (op.phase) {
        case 'fail': this.finish(t, 'notReady'); break;
        case 'recal': case 'seek': this.stepOn(t); break;
        case 'recalSettle':
          d.base = d.state; d.known = true;
          if (op.kind === 'recalibrate') this.finish(t, null); else this.seek(t);
          break;
        case 'settle': this.load(t); break;
        case 'search': case 'data': this.retry(t, 'seek'); break;
        default:
      }
    }
    this.updateNext();
  }

  // ---- interrupts from the sensors ------------------------------------------------------------------------------
  /** An index pulse: the period decides ready and not ready (162.5 to 170.9 ms accepted, HW 3.5). */
  index(i, t) {
    const d = this.dr[i], A = this.def.adapter;
    if (!this.io.leverClosed(i)) return;
    const p = d.lastIdx >= 0 ? t - d.lastIdx : -1;
    d.lastIdx = t;
    d.tWatch = t + A.maxPeriod;
    if (p > 0) {
      const ok = p >= A.minPeriod && p <= A.maxPeriod;
      if (ok && !d.ready) {
        d.ready = true; d.type = this.io.mediaType(i);
        this.emit({ ev: 'ready', drive: i, type: d.type, t });
      } else if (!ok && d.ready) this.notReady(i, t);
    }
    this.updateNext();
  }

  /** The lever switch. Opening it drops ready at once and abandons an operation on that drive. */
  lever(i, closed, t) {
    const d = this.dr[i];
    d.lastIdx = -1; d.tWatch = INF;
    if (!closed && d.ready) this.notReady(i, t);
    this.updateNext();
  }

  notReady(i, t) {
    const d = this.dr[i];
    d.ready = false; d.type = null;
    if (d.head) { d.head = false; d.tUnload = INF; this.io.setHeadLoad(i, false); }
    this.emit({ ev: 'notReady', drive: i, t });
    if (this.op && this.op.drive === i) this.finish(t, 'notReady');
  }

  /** An ID field read under the head: the address of the sector now starting. */
  idField(i, track, sector, t) {
    const op = this.op;
    if (!op || op.drive !== i || (op.phase !== 'search' && op.phase !== 'data')) return;
    if (op.phase === 'search') {
      if (track !== op.track) { this.retry(t, 'seek'); this.updateNext(); return; }
      if (sector !== op.sector) return;
      op.phase = 'data'; op.left = op.count;
      this.tOp = t + 2 * this.rotation;
      this.updateNext();
      return;
    }
    if (--op.left === 0) this.finish(t, null);
    this.updateNext();
  }

  // ---- state transfer -------------------------------------------------------------------------------------------
  exportState() {
    const s = {};
    for (const [k, v] of Object.entries(this)) if (k !== 'def' && k !== 'io' && k !== 'emit') s[k] = v;
    return structuredClone(s);
  }

  importState(s) { Object.assign(this, structuredClone(s)); }
}
