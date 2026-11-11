// The print queue and the background task that empties it (architecture 7.7 item 2, SR 7.6). Jobs wait in a queue
// of six; the spooler takes the first, reads its pages from the diskette as it reaches them (a PRINT-key job carries
// its pages with it), formats each, orders each line's strikes from whichever end is nearer the carrier, encodes
// them as link commands (6.5) and sends them as the printer's credit allows. It runs beside whatever the operator is
// doing, and speaks only through the message line: printer off, load paper, change the printwheel, errors, printed.
import { waitSignal } from '../../sched.js';
import { DiskError } from '../../disk/fs.js';
import { Document } from '../editor/doc.js';
import { formatPage, PAPER_LENGTH } from './formatter.js';

export const QUEUE_MAX = 6;            // ORG p.213
export const KEY_PAGES = 25;           // pages the PRINT key queues for a document, ORG p.494
export const DEFAULT_OPTIONS = Object.freeze({ from: '0', through: '0', quantity: 1, paper: 2, cancelOnError: 2 });

const OP_ESCAPE = 2, OP_INDEX = 3;
const LOAD = 0x5001, EJECT = 0x5002, RESTORE = 0x6001, END_OF_DATA = 0x6002;
const CANCEL = Symbol('cancel');

/** Relative move words for n steps, each word at most 2047 (6.5). */
export function moves(op, n) {
  const out = [];
  for (let left = n; left !== 0;) {
    const k = Math.min(Math.abs(left), 2047);
    out.push((op << 12) | (left < 0 ? 0x800 : 0) | k);
    left -= Math.sign(left) * k;
  }
  return out;
}

/** A line's strikes left to right or right to left, whichever start is nearer `at`; overstrikes keep their order. */
export function orderLine(strikes, at) {
  const idx = strikes.map((s, k) => k);
  const ltr = [...idx].sort((a, b) => strikes[a].x - strikes[b].x || a - b);
  const rtl = [...idx].sort((a, b) => strikes[b].x - strikes[a].x || a - b);
  const pick = Math.abs(strikes[ltr[0]].x - at) <= Math.abs(strikes[rtl[0]].x - at) ? ltr : rtl;
  return pick.map((k) => strikes[k]);
}

/** Link words for a line, from the print position `head` ({ x, y } in 1/240 and 1/96 in), which they move on. */
export function encodeLine(line, head) {
  const words = [];
  for (const s of orderLine(line.strikes, head.x)) {
    words.push(...moves(OP_INDEX, line.y + s.dy - head.y), ...moves(OP_ESCAPE, s.x - head.x), 0x1000 | s.petal);
    head.x = s.x; head.y = line.y + s.dy;
  }
  return words;
}

/** Page indices for From and Through (system page numbers, 0 for the first and last); null if not in the document. */
export function pageRange(pages, from, through) {
  const at = (n, none) => (String(n) === '0' ? none : pages.findIndex((p) => p.n === String(n)));
  const a = at(from, 0), b = at(through, pages.length - 1);
  return a < 0 || b < 0 || a > b ? null : [a, b];
}

const three = (n) => String(n).padStart(3, '0');

export class Spooler {
  constructor(sys) {
    this.sys = sys;
    this.queue = sys.printQueue;
    const p = sys.devices.printer;
    this.depth = p.credit;               // the attachment's queue, all credit at the start
    this.credit = p.credit;
    this.status = { ...p.status };
    this.wheel = null;                   // the typestyle last confirmed on the printer; unknown at first
    this.task = null;
    this.job = null;
    this.out = true;                     // no sheet of ours is in the printer
    this.seen = { error: null, loadError: false, paper: null, done: false, start: false, confirm: false };
  }

  /** What the printer reports (7.6): credit, status, paper, end of data, errors. */
  event(e) {
    const s = this.seen;
    switch (e.ev) {
      case 'credit': this.credit = Math.min(this.depth, this.credit + e.n); break;
      case 'cancel': this.credit = this.depth; break;
      case 'done': s.done = true; break;
      case 'paper': s.paper = e.kind; if (e.kind === 'eject') this.out = true; break;
      case 'error':
        if (e.code === 'loadPaper') s.loadError = true;
        else if (!e.recoverable) s.error = e.code;      // 55 and 45 are retried by the printer itself
        break;
      case 'status': {
        const { dev, ev, key, ...st } = e;
        if (st.on && !this.status.on) this.credit = this.depth;     // switched on: its queue is empty
        if (st.ready) s.error = null;                               // put right before the spooler saw it
        Object.assign(this.status, st);
        if (key === 'start') s.start = true;
        break;
      }
      default: return;
    }
    this.sys.sched.signal('printer');
  }

  /** Queue a job ({ name, disk, opts } or with `pages` carried along); false if the queue is full. */
  add(job) {
    if (this.queue.length >= QUEUE_MAX) return false;
    this.queue.push({ ...job, opts: { ...DEFAULT_OPTIONS, ...job.opts }, cancelled: false });
    if (!this.task) { this.task = this.sys.sched.spawn(this.run(), 'spooler'); this.sys.sched.run(); }
    return true;
  }

  /** Cancel a job: a waiting one leaves the queue; the one printing stops after what the printer holds. */
  cancel(job) {
    if (job === this.job) { job.cancelled = true; this.sys.sched.signal('printer'); }
    else this.queue.splice(this.queue.indexOf(job), 1);
  }

  /** REQST e: print on with the printwheel that is on the printer. */
  continuePrinting() { this.seen.confirm = true; this.sys.sched.signal('printer'); }

  post(key, args) { this.sys.messages.post(key, args); }

  *run() {
    while (this.queue.length) {
      const job = this.job = this.queue[0];
      let ok = false;
      try {
        ok = yield* this.print(job);
      } catch (e) {
        if (e instanceof DiskError) this.post('diskError', { disk: job.disk });
        else if (e !== CANCEL) throw e;
      }
      this.post(ok ? 'printed' : 'printCancelled', { name: job.name });
      // A sheet left part printed comes out once the printer has taken what it holds.
      if (!ok && !this.out) yield* this.send([EJECT], false);
      this.queue.splice(this.queue.indexOf(job), 1);
      this.job = null;
    }
    this.task = null;
  }

  /**
   * Wait for a condition, waking on anything the printer reports. A printer error is posted; with Cancel on Error
   * Yes it cancels the job, otherwise printing goes on once the operator has put it right and pressed START.
   */
  *until(cond, errors = true) {
    for (;;) {
      if (this.job?.cancelled) throw CANCEL;
      const code = this.seen.error;
      if (code !== null) {
        this.seen.error = null;
        if (errors) {
          this.post(code === 6 ? 'coverOpen' : 'printerError', { code: String(code).padStart(2, '0') });
          if (this.job?.opts.cancelOnError === 1) throw CANCEL;
        }
      }
      if (cond()) return;
      yield* waitSignal('printer');
    }
  }

  /** Send words as credit allows. */
  *send(words, errors = true) {
    for (let i = 0; i < words.length;) {
      if (errors) yield* this.until(() => this.credit > 0);
      else while (this.credit === 0) yield* waitSignal('printer');
      const n = Math.min(this.credit, words.length - i);
      this.credit -= n;
      this.sys.devices.printer.send(Uint16Array.from(words.slice(i, i + n)));
      i += n;
    }
  }

  *print(job) {
    const src = job.pages ? carried(job) : yield* this.fromDiskette(job);
    if (!src) return false;
    if (!this.status.ready) {
      this.post(this.status.on ? 'printerNotReady' : 'printerOn');
      yield* this.until(() => this.status.ready);
    }
    const state = { phase: 0 }, head = { x: 0, y: 0 };
    const total = () => src.count() * job.opts.quantity;      // copies collated; PRINT may add pages meanwhile
    for (let n = 0; ;) {
      for (; n < total(); n++) {
        const pg = yield* src.page(src.from + (n % src.count()));
        for (const sheet of formatPage(pg.units, pg.objects, pg.ctx, state)) yield* this.sheet(sheet, job, head);
      }
      this.seen.done = false;
      yield* this.send([END_OF_DATA]);
      yield* this.until(() => this.seen.done);
      if (n >= total()) return true;
    }
  }

  /** The pages of a stored document, read when they are reached; the diskette is asked for if it is not in place. */
  *fromDiskette(job) {
    let vol, asked = false;
    while (!(vol = this.sys.volume(job.disk))) {
      if (!asked) { this.post('insertToPrint', { disk: job.disk, name: job.name }); asked = true; }
      yield* waitSignal(['mounted', 'printer']);
      if (job.cancelled) return null;
    }
    const e = vol.find(job.name);
    if (!e) { this.post('notFound', { name: job.name, disk: job.disk }); return null; }
    const { head, lsns } = yield* vol.readHead(e);
    const doc = new Document(vol, e, head, lsns);
    const range = pageRange(head.pages, job.opts.from, job.opts.through);
    if (!range) { this.post('pagesNotFound'); return null; }
    return {
      from: range[0],
      count: () => range[1] - range[0] + 1,
      *page(k) {
        const { units, objects } = yield* vol.readPage(head.pages[k].lsn);
        return { units, objects, ctx: doc.layoutCtx(k) };
      },
    };
  }

  /** One sheet: paper in, the carrier back to the left end, the lines, paper out (or on to the next form). */
  *sheet(sheet, job, head) {
    const cut = job.opts.paper !== 3;
    if (cut) { yield* this.load(job); head.y = 0; }
    const words = [RESTORE];
    head.x = 0;
    for (const line of sheet.lines) {
      if (line.style !== this.wheel) { yield* this.send(words.splice(0)); yield* this.changeWheel(line.style); }
      words.push(...encodeLine(line, head));
      if (words.length >= this.depth) yield* this.send(words.splice(0));
    }
    if (cut) words.push(EJECT);
    else words.push(...moves(OP_INDEX, Math.max(0, PAPER_LENGTH[sheet.fmt.paper] - head.y)));
    head.y = 0;
    yield* this.send(words);
  }

  /**
   * A sheet in: Automatic Feed loads from the sheet feeder; with Manual Feed, or an empty feeder, the operator is
   * asked to lay a sheet in and press LOAD on the printer.
   */
  *load(job) {
    const s = this.seen;
    if (job.opts.paper === 2) {
      s.paper = null; s.loadError = false;
      yield* this.send([LOAD]);
      if (yield* this.loaded()) return;
    } else yield* this.until(() => this.credit === this.depth && this.out);
    this.post('loadPaper');
    for (;;) {
      s.paper = null; s.loadError = false;
      if (yield* this.loaded()) return;
    }
  }

  /** The next load the printer reports; false if it found no paper. */
  *loaded() {
    yield* this.until(() => this.seen.paper === 'load');
    if (this.seen.loadError) return false;
    this.out = false;
    return true;
  }

  /**
   * Another printwheel (TB2 p.553): once the printer has taken everything sent, ask for it by typestyle and keyboard
   * number and wait for START on the printer or REQST e (Continue Printing With Element Now On Printer). Errors
   * while the wheel is changed (the cover is opened for it) are part of the change.
   */
  *changeWheel(style) {
    yield* this.until(() => this.credit === this.depth);
    const s = this.seen;
    s.start = false; s.confirm = false;
    this.post('putOnWheel', { style: three(style), kbd: three(this.sys.settings.keyboard ?? 1) });
    yield* this.until(() => s.start || s.confirm, false);
    this.wheel = style;
  }
}

function carried(job) {
  return { from: 0, count: () => job.pages.length, *page(k) { return job.pages[k]; } };
}
