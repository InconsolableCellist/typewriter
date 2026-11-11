// An analytic printer for Node (architecture 7.6): it takes the link commands of 6.5 into a 32-word queue, returns
// credit as it takes them, prints at the controller's rates (timing.js) and reports status, paper and errors as the
// controller does. What it would have printed is kept per sheet, so tests can check columns and lines. The operator's
// side (power, Start, the cover, laying a sheet and pressing Load, the sheet feeder) is a method each.
import { PRINTER, moveTime, indexTime } from './timing.js';
import { PETALS } from '../charset.js';

const OP_PRINT = 1, OP_ESCAPE = 2, OP_INDEX = 3, OP_PAPER = 5, OP_CONTROL = 6;
const SELF_TEST_S = 15;                     // power-on checks and homing (architecture 6.8 item 16)
const signed = (w) => (w & 0x800 ? -1 : 1) * (w & 0x7ff);

export class VirtualPrinter {
  /** power: switched on and ready; feeder: sheets in the sheet feeder; sheetLength in 1/96 in (letter). */
  constructor(dev, { power = true, feeder = 100, sheetLength = 11 * 96 } = {}) {
    this.dev = dev;
    this.on = power; this.online = power; this.coverOpen = false; this.error = 0; this.testing = false;
    this.feeder = feeder; this.slot = 0; this.sheetLength = sheetLength;
    this.sheet = null;                       // { y, strikes } while a sheet is in the printer
    this.sheets = [];                        // sheets fed out, in order
    this.platen = [];                        // strikes with no paper in
    this.words = [];                         // every word received
    this.fifo = [];
    this.L = 0; this.dx = 0; this.dy = 0;    // logical position of the last print, and the pending moves (1/240, 1/96 in)
    this.S = 0; this.dir = 0; this.moving = false;   // where the carrier stands, and whether it is running on
    this.free = 0;                           // when the mechanism can take the next command
    this.due = Infinity;                     // the pending service time
    this.credit = PRINTER.fifo;              // the credit the software starts with
  }

  get status() {
    return { on: this.on, ready: this.ready, online: this.online, coverOpen: this.coverOpen, error: this.error, paper: !!this.sheet, feeder: this.feeder, queued: this.fifo.length };
  }

  get ready() { return this.on && !this.testing && this.online && !this.coverOpen && !this.error; }
  get now() { return this.dev.now; }

  post(t, e) { this.dev.post(t, { dev: 'printer', ...e }); }
  report(extra) { this.post(this.now, { ev: 'status', ...this.status, ...extra }); }

  /** Words from the attachment. */
  send(words) {
    for (const w of words) {
      this.words.push(w);
      if (this.fifo.length >= PRINTER.fifo) { this.post(this.now, { ev: 'error', code: 'overrun' }); break; }
      this.fifo.push(w);
    }
    this.schedule(Math.max(this.now, this.free));
  }

  schedule(t) {
    if (!this.on || t >= this.due) return;
    this.due = t;
    this.dev.sys.sched.at(t, () => { if (this.due === t) { this.due = Infinity; this.service(); } });
  }

  /** Take commands until one takes time; credit for what was taken goes back at once. */
  service() {
    let t = Math.max(this.now, this.free), taken = 0;
    const done = () => { if (taken) this.post(this.now, { ev: 'credit', n: taken }); this.free = t; };
    while (this.ready && this.fifo.length) {
      const w = this.fifo.shift(), op = w >> 12;
      taken++;
      if (op === OP_ESCAPE) { this.dx += signed(w); continue; }
      if (op === OP_INDEX) { this.dy += signed(w); continue; }
      t = this.index(t);
      if (op === OP_PRINT) { t = this.print(t, w); done(); this.schedule(t); return; }
      this.moving = false;
      if (op === OP_PAPER) { t = this.paper(t, w & 0xf); done(); this.schedule(t); return; }
      if (op === OP_CONTROL) {
        const k = w & 0xf;
        if (k === 1) { this.dx = 0; this.L = 0; t += moveTime(Math.abs(this.S), PRINTER.slewRate, PRINTER.ramp); this.S = 0; done(); this.schedule(t); return; }
        if (k === 2) { this.L += this.dx; this.dx = 0; this.post(t, { ev: 'done' }); }
        if (k === 3) this.post(t, { ev: 'status', ...this.status });
      }
    }
    if (this.ready) t = this.index(t);
    done();
  }

  /** Run the summed index moves. */
  index(t) {
    if (!this.dy) return t;
    if (this.sheet) this.sheet.y += this.dy;
    t += indexTime(this.dy);
    this.dy = 0; this.moving = false;
    return t;
  }

  print(t, w) {
    const P = PRINTER, x = this.L + this.dx, d = Math.abs(x - this.S), dir = Math.sign(x - this.S);
    this.L = x; this.dx = 0;
    if (this.moving && d > 0 && d <= P.onTheMove && dir === this.dir) t += Math.max(P.minCycle, d / P.printRate);
    else t += moveTime(d, P.slewRate, P.ramp) + P.minCycle;
    this.S = x; this.moving = true;
    if (dir) this.dir = dir;
    const petal = w & 0x7f, s = { x, y: this.sheet?.y ?? 0, ch: PETALS[petal], petal, impression: (w >> 8) & 0xf, t };
    (this.sheet ? this.sheet.strikes : this.platen).push(s);
    return t;
  }

  paper(t, k) {
    const P = PRINTER;
    if (k === 1) return this.load(t);
    if (k === 2) {
      const left = this.sheet ? Math.max(0, this.sheetLength - this.sheet.y) : P.loadSteps;
      t += 2 * P.camS + left / P.indexRate;
      if (this.sheet) { this.sheets.push(this.sheet); this.sheet = null; }
      this.post(t, { ev: 'paper', kind: 'eject' });
      return t;
    }
    return t + P.camS;       // bail open or close
  }

  /** Bail open, feed a sheet from the slot or the feeder to the first writing line, bail closed (6.7). */
  load(t) {
    const P = PRINTER;
    t += P.camS;
    if (!this.sheet && this.slot > 0) { this.slot--; this.sheet = { y: 0, strikes: [] }; }
    else if (!this.sheet && this.feeder > 0) { this.feeder--; this.sheet = { y: 0, strikes: [] }; }
    if (this.sheet) t += P.loadSteps / P.indexRate;
    else { t += (5 * 96) / P.indexRate; this.post(t, { ev: 'error', code: 'loadPaper' }); }
    t += P.camS;
    this.post(t, { ev: 'paper', kind: 'load' });
    return t;
  }

  // ---- the operator ------------------------------------------------------------------------------------------------

  /** The power switch. Switched on, the printer tests itself and homes before it is ready. */
  power(on) {
    if (on === this.on) return;
    this.on = on;
    this.fifo.length = 0; this.dx = 0; this.dy = 0; this.L = 0; this.due = Infinity;
    if (!on) { this.online = false; this.testing = false; this.report(); return; }
    this.testing = true; this.error = 0;
    this.report();
    this.dev.sys.sched.at(this.now + SELF_TEST_S, () => {
      this.testing = false; this.online = true; this.S = 0; this.free = this.now;
      this.report();
    });
  }

  /** Start: clears an error once its cause is gone and puts the printer back on line. */
  start() {
    if (!this.on || this.testing || this.coverOpen) return;
    this.error = 0; this.online = true;
    this.report({ key: 'start' });
    this.schedule(Math.max(this.now, this.free));
  }

  stop() { this.online = false; this.report(); }

  openCover() {
    this.coverOpen = true;
    if (this.on && !this.error) { this.error = 6; this.moving = false; this.post(this.now, { ev: 'error', code: 6 }); }
    this.report();
  }

  closeCover() { this.coverOpen = false; this.report(); }

  /** A fault the printer stops on (for tests): it reports the code and waits for Start. */
  fault(code) { this.error = code; this.moving = false; this.post(this.now, { ev: 'error', code }); this.report(); }

  /** Lay a sheet in the rear slot and press Load. */
  loadPaper() {
    this.slot++;
    if (!this.ready || this.fifo.length || this.free > this.now) return;
    this.free = this.load(this.now);
  }

  fillFeeder(n) { this.feeder += n; }
}
