// The Sharp FO-70's firmware: the machine's top loop on a simulated clock. Pure: no DOM and no timers; the host hands
// in devices (devices.md), delivers their events with deviceEvent() and moves time with advance().
//
// What it does, and where the behaviour comes from (marks as in docs/fax/plan.md: [S] search summary of the manuals,
// [M] memory of machines of the class, [A] ours):
//   standby with the date, time and reception mode on the LCD [A: layout]; a document laid in the feeder is drawn to
//     the read line and DOCUMENT READY shown [A]
//   sending by keypad number + START, rapid key A-E, SPEED DIAL + two digits, REDIAL, or HOLD/SEARCH's list [S keys]
//   automatic redial on busy: 2 more tries at 5 minute intervals [M: Sharp's small machines of the period]
//   copy (COPY/HELP with a document) and the help list (COPY/HELP without) [photo legend; behaviour A]
//   the handset and SPEAKER: dial by hand, START to send or receive manually [S]; HOLD [S]
//   reception modes FAX (answers after the set rings) and TEL/FAX [S]; TEL and A.M. [A]; TEL/FAX answers, listens
//     for CNG, then pseudo-rings the handset for the set time and falls back to fax reception [A]
//   polling: E/POLL with no document [photo legend; behaviour A]
//   RESOLUTION/RECEPTION MODE: resolution with a document, reception mode without [S]
//   VOLUME: ringer volume, or the speaker's while it is on [A]
//   STOP at any point: every wait in an operation ends on it; a call in progress is ended with DCN [M]
//   faults: CHECK PAPER, COVER OPEN, DOCUMENT JAMMED, LINE ERROR [S wording], codes from messages.js [A]
//   no page memory [A, plan section 2]: the document is fed as fast as the modem takes its lines (pacing below), and
//     a received page is printed as it is decoded; with no paper the machine does not answer, and paper running out
//     during a reception ends the call.

import { Kernel, wait, event } from './kernel.js';
import { CallDriver } from './call.js';
import { msg, ERRORS, errorForHangup } from './messages.js';
import { Lcd, lcdPair, lcdText, isDigitKey, isRapidKey } from './panel.js';
import {
  loadSettings, MemoryStorage, STORAGE_KEY, JOURNAL_KEY, RX_MODES, digitsOf, rapidIndex, isJunk,
  numberEntry, chooseSpeed, functionMenu, SPEED_COUNT,
} from './setup.js';
import { encodeRows, pageChecker, STRIDE, LINES_PER_MM } from './page.js';
import { transmissionReport, activityReport, telephoneList, setupList, helpList, headerPage, JOURNAL_LENGTH } from './reports.js';
import { T30Caller } from '../t30/caller.js';
import { T30Answerer } from '../t30/answerer.js';
import { TRAINING_SECONDS } from '../transport.js';

/** Timing the manual does not give [A unless marked]. */
export const TIMING = Object.freeze({
  dialToneWaitS: 3,        // listen this long for dial tone before dialling blind
  resultS: 3,              // TRANSMISSION OK and the like stay this long
  flashS: 2,               // a setting's name after a key press
  redialTries: 2,          // [M]
  redialIntervalS: 300,    // [M]
  ringGapS: 7,             // no ring for this long: the caller has given up
  cngWindowS: 5,           // TEL/FAX: listen for CNG before pseudo-ringing
  amFallbackRings: 5,      // A.M. mode with no answering machine answering: the fax answers itself
  amWatchS: 30,            // A.M. mode: listen for CNG while the answering machine has the line
  paceChunkS: 0.5,         // the feed is commanded in steps of this many seconds of line time
  copyBlockLines: 128,     // copy: scan and print alternate in blocks (one motor [M])
  copyLineS: 1 / 154,      // copy: time a line takes to scan at fine (20 mm/s [A])
  stopWaitS: 10,           // after STOP, how long to wait for DCN to go out
});

export class Stop extends Error { constructor() { super('STOP'); } }

const RES_ORDER = ['STANDARD', 'FINE', 'SUPERFINE', 'HALFTONE'];
const RES_MSG = { STANDARD: 'RES_STANDARD', FINE: 'RES_FINE', SUPERFINE: 'RES_SUPERFINE', HALFTONE: 'RES_HALFTONE' };
const MODE_MSG = { FAX: 'MODE_FAX', TEL: 'MODE_TEL', 'TEL/FAX': 'MODE_TELFAX', 'A.M.': 'MODE_AM' };
const MODE_ABBR = { FAX: 'FAX', TEL: 'TEL', 'TEL/FAX': 'T/F', 'A.M.': 'A.M' };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const p2 = (n) => String(n).padStart(2, '0');

const isKey = (e, key) => e && e.dev === 'keys' && e.ev === 'down' && (key == null || e.key === key);
const isStop = (e) => isKey(e, 'STOP');

/**
 * options: cold (no settings stored: clock unset), t0 (the clock's start, seconds), wallClockMs (the wall-clock time
 * at t0 as UTC fields, i.e. local time; the kit passes Date.now() less the time-zone offset), desk ({ ownNumber,
 * ownName, speed: [{ number, name }] } programmed by a warm start when nothing is stored).
 */
export function createFirmware({ devices, storage = new MemoryStorage(), options = {} }) {
  return new FaxFirmware({ devices, storage, options });
}

export class FaxFirmware {
  constructor({ devices, storage, options }) {
    this.devices = devices;
    this.storage = storage;
    this.options = options;
    this.k = new Kernel(options.t0 ?? 0);
    this.wall0 = options.wallClockMs ?? Date.UTC(1999, 5, 1, 9, 0);
    const { settings, loaded } = loadSettings(storage);
    this.settings = settings;
    if (!loaded) {
      if (options.cold) settings.clock = { set: false, offsetMs: Date.UTC(2000, 0, 1) - this.wall0 - this.k.t * 1000 };
      else this.programDesk(options.desk);
    }
    this.journal = storage.load(JOURNAL_KEY) ?? [];
    this.lcd = new Lcd(devices.lcd);
    this.lcd.now = () => this.k.t;
    this.state = { doc: false, docLoaded: false, docJam: false, paper: true, cover: false, handset: false };
    this.res = 'STANDARD';
    this.alert = null;          // a message id that stays until STOP (LINE ERROR, LINE BUSY)
    this.redial = null;         // { number, left, at }
    this.lastNumber = '';
    this.lastTx = null;         // the last send's journal entry and first page, for the transmission report
    this.callbacks = new Map(); // device op id -> callback
    this.nextId = 1;
    this.log = [];              // what the firmware did, for tests: { t, what, ... }
    this.ENTRY_TIMEOUT = 60;
    this.MENU_TIMEOUT = 60;
    this.k.onEvent = (ev) => this.background(ev);
    devices.attach?.(this);
    this.readSensors();
    this.armTick();
    this.mainTask = this.k.spawn(this.mainLoop(), 'main');
  }

  // ---- the host's side ----------------------------------------------------------------------------------------------

  get now() { return this.k.t; }
  get clock() { return this.k.clock; }
  advance(t) { this.k.advance(t); }
  runFor(s) { this.k.runFor(s); }
  runUntil(pred, limit) { return this.k.runUntil(pred, limit); }
  deviceEvent(evt) { this.k.post(evt); }
  keyDown(key) { this.k.post({ dev: 'keys', ev: 'down', key }); }

  // ---- settings, clock, journal -------------------------------------------------------------------------------------

  programDesk(desk) {
    if (!desk) return;
    this.settings.ownNumber = desk.ownNumber ?? '';
    this.settings.ownName = desk.ownName ?? '';
    (desk.speed ?? []).slice(0, SPEED_COUNT).forEach((e, i) => { this.settings.speed[i] = e ? { number: e.number, name: e.name } : null; });
  }

  save() { this.storage.save(STORAGE_KEY, this.settings); }

  wallMs() { return this.wall0 + this.k.t * 1000 + this.settings.clock.offsetMs; }

  setClock({ y, mo, d, h, mi }) {
    this.settings.clock = { set: true, offsetMs: Date.UTC(y, mo - 1, d, h, mi) - (this.wall0 + this.k.t * 1000) };
    this.armTick();
  }

  armTick() {
    this.k.cancel(this.tickTimer);
    const ms = this.wallMs();
    const next = this.k.t + (60000 - (((ms % 60000) + 60000) % 60000)) / 1000;
    this.tickTimer = this.k.at(next, () => { this.k.post({ dev: 'fw', ev: 'tick' }); this.armTick(); });
  }

  clockLine() {
    const d = new Date(this.wallMs());
    return `${MONTHS[d.getUTCMonth()]}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} ${MODE_ABBR[this.settings.rxMode]}`;
  }

  addJournal(entry) {
    entry.no = (this.journal.at(-1)?.no ?? 0) % 999 + 1;
    this.journal.push(entry);
    if (this.journal.length > JOURNAL_LENGTH) this.journal.splice(0, this.journal.length - JOURNAL_LENGTH);
    this.storage.save(JOURNAL_KEY, this.journal);
    this.log.push({ t: this.k.t, what: 'journal', ...entry });
    return entry;
  }

  // ---- UI helpers (setup.js uses these) ------------------------------------------------------------------------------

  show(text, opts) { this.lcd.show(text, opts); }
  beep(kind) { this.devices.beeper?.beep(kind); }

  /** Wait for an event `accept` takes; STOP throws Stop unless `stop` is set (then it is returned). */
  *ev(accept, timeout, { stop = false } = {}) {
    const e = yield* event((x) => isStop(x) || accept(x), timeout);
    if (isStop(e) && !stop) throw new Stop();
    return e;
  }

  /** The next key (STOP throws); null after `timeout` seconds. */
  *key(timeout) {
    const e = yield* this.ev((x) => isKey(x), timeout);
    return e.dev === 'keys' ? e.key : null;
  }

  *pause(s) { yield* wait(s); }

  /** Show a text for s seconds; a key ends it early and is returned (null when the time ran out); STOP throws. */
  *flash(text, s = TIMING.flashS) {
    this.show(text);
    const e = yield* this.ev((x) => isKey(x), s);
    return e.dev === 'keys' ? e.key : null;
  }

  // ---- devices ---------------------------------------------------------------------------------------------------

  readSensors() {
    const f = this.devices.feeder?.status?.() ?? {};
    const p = this.devices.printer?.status?.() ?? {};
    const n = this.devices.ncu?.status?.() ?? {};
    this.state.doc = !!f.docPresent;
    this.state.docLoaded = !!f.loaded;
    this.state.paper = p.paper !== false;
    this.state.cover = !!p.coverOpen;
    this.state.handset = !!n.handsetOff;
  }

  /** Issue a device command that completes with { dev, ev: 'done', id }; `cb(result)` runs on completion. */
  cmd(dev, op, args = {}, cb = null) {
    const id = this.nextId++;
    if (cb) this.callbacks.set(id, cb);
    this.devices[dev][op]({ ...args, id });
    return id;
  }

  /** The same, waited for by the running task. STOP is not taken here: a mechanism finishes its motion. */
  *io(dev, op, args = {}) {
    const id = this.cmd(dev, op, args);
    return yield* event((x) => x.dev === dev && x.ev === 'done' && x.id === id);
  }

  background(ev) {
    switch (ev.dev) {
      case 'keys':
        if (ev.ev === 'down') this.beep('key');
        break;
      case 'feeder':
        if (ev.ev === 'doc') {
          this.state.doc = !!ev.present;
          if (!ev.present) { this.state.docLoaded = false; this.state.docJam = false; this.redial = null; }
        } else if (ev.ev === 'jam') { this.state.docJam = true; this.state.docLoaded = false; }
        break;
      case 'printer':
        if (ev.ev === 'paper') this.state.paper = !!ev.present;
        else if (ev.ev === 'cover') this.state.cover = !!ev.open;
        break;
      case 'ncu':
        if (ev.ev === 'handset') this.state.handset = !!ev.off;
        break;
      default:
    }
    if (ev.ev === 'done' && this.callbacks.has(ev.id)) {
      const cb = this.callbacks.get(ev.id);
      this.callbacks.delete(ev.id);
      cb(ev);
    }
  }

  // ---- the top loop ------------------------------------------------------------------------------------------------

  *mainLoop() {
    for (;;) {
      try {
        yield* this.standby();
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        this.releaseLine();
      }
    }
  }

  releaseLine() {
    const n = this.devices.ncu;
    n.monitor?.(0);
    n.seize(false);
    this.devices.beeper?.ring?.(false);
  }

  idleText() {
    const s = this.state;
    if (s.cover) return msg('COVER_OPEN');
    if (s.docJam) return msg('DOC_JAMMED');
    if (!s.paper) return msg('CHECK_PAPER');
    if (this.alert) return msg(this.alert);
    if (this.redial) {
      const left = Math.max(0, Math.ceil(this.redial.at - this.k.t));
      return lcdPair(msg('REDIAL_WAIT'), `${Math.floor(left / 60)}:${p2(left % 60)}`);
    }
    if (s.docLoaded) return msg('DOC_READY');
    if (!this.settings.clock.set && Math.floor(this.k.t / 2) % 2) return msg('SET_CLOCK');
    return this.clockLine();
  }

  /** One turn of standby: draw the LCD, take one event, act on it. */
  *standby() {
    const s = this.state;
    if (s.doc && !s.docLoaded && !s.docJam) { yield* this.loadDocument(); return; }
    if (s.handset) { yield* this.telephone('handset'); return; }
    this.show(this.idleText());
    let timeout = this.redial ? Math.max(0, Math.min(1, this.redial.at - this.k.t)) : null;
    if (!this.settings.clock.set) timeout = Math.min(timeout ?? 2, 2);
    const e = yield* event((x) => x.dev !== 'fw' || x.ev === 'tick' || x.ev === 'timeout', timeout);
    if (e.dev === 'fw') {
      if (e.ev === 'timeout' && this.redial && this.k.t >= this.redial.at - 1e-9) {
        const r = this.redial;
        if (!this.state.docLoaded) { this.redial = null; return; }
        r.left--;
        yield* this.send(r.number, { redial: r });
      }
      return;
    }
    if (e.dev === 'ncu') {
      if (e.ev === 'ring' && e.on) yield* this.incoming(e);
      return;
    }
    if (e.dev !== 'keys' || e.ev !== 'down') return;
    yield* this.onKey(e.key);
  }

  *onKey(k) {
    const s = this.state;
    const doc = s.docLoaded;
    if (k === 'STOP') {
      if (this.alert) this.alert = null;
      else if (this.redial) this.redial = null;
      else if (s.docJam) s.docJam = false;
      else if (doc) yield* this.eject();
      return;
    }
    this.alert = null;
    if (k === 'RESOLUTION') {
      // Each press while the setting is shown moves it on; another key ends the display and is acted on.
      for (let next = k; next === 'RESOLUTION';) {
        if (doc) {
          this.res = RES_ORDER[(RES_ORDER.indexOf(this.res) + 1) % RES_ORDER.length];
          next = yield* this.flash(msg(RES_MSG[this.res]));
        } else {
          this.settings.rxMode = RX_MODES[(RX_MODES.indexOf(this.settings.rxMode) + 1) % RX_MODES.length];
          this.save();
          next = yield* this.flash(msg(MODE_MSG[this.settings.rxMode]));
        }
        if (next && next !== 'RESOLUTION') return yield* this.onKey(next);
      }
      return;
    }
    if (k === 'FUNCTION') { try { yield* functionMenu(this); } catch (e) { if (!(e instanceof Stop)) throw e; } return; }
    if (k === 'SPEAKER') { yield* this.telephone('speaker'); return; }
    if (k === 'COPY_HELP') { if (doc) yield* this.copy(); else yield* this.printList('help'); return; }
    if (k === 'VOLUME') { yield* this.volume('ringer'); return; }
    if (k === 'E' && !doc) { yield* this.pollEntry(); return; }
    if (isRapidKey(k)) {
      const e = this.settings.speed[rapidIndex(k) - 1];
      if (!e) { yield* this.flash(msg('NOT_STORED')); return; }
      if (doc) yield* this.send(e.number, { name: e.name });
      else yield* this.flash(e.name || e.number);
      return;
    }
    if (k === 'SPEED_DIAL') {
      const n = yield* chooseSpeed(this);
      if (n == null) return;
      const e = this.settings.speed[n - 1];
      if (!e) { yield* this.flash(msg('NOT_STORED')); return; }
      this.show(e.name || e.number);
      const go = yield* this.key(this.ENTRY_TIMEOUT);
      if (go === 'START' && this.state.docLoaded) yield* this.send(e.number, { name: e.name });
      return;
    }
    if (k === 'REDIAL') {
      if (!this.lastNumber) return;
      if (doc) yield* this.send(this.lastNumber);
      else yield* this.flash(this.lastNumber);
      return;
    }
    if (k === 'HOLD_SEARCH') {
      const e = yield* this.search();
      if (e && this.state.docLoaded) yield* this.send(e.number, { name: e.name });
      return;
    }
    if (isDigitKey(k)) {
      const n = yield* numberEntry(this, { first: k });
      if (n && this.state.docLoaded) yield* this.send(n);
      else if (n) this.beep('error');
      return;
    }
    if (k === 'START' && !doc) this.beep('error');
  }

  /** HOLD/SEARCH in standby: step through the stored numbers by name; START chooses [A]. */
  *search() {
    const list = this.settings.speed.filter(Boolean).slice().sort((a, b) => (a.name || a.number).localeCompare(b.name || b.number));
    if (!list.length) { yield* this.flash(msg('NOT_STORED')); return null; }
    for (let i = 0; ;) {
      this.show(list[i].name || list[i].number);
      const k = yield* this.key(this.ENTRY_TIMEOUT);
      if (k == null) return null;
      if (k === 'HOLD_SEARCH') i = (i + 1) % list.length;
      else if (k === 'START') return list[i];
    }
  }

  *volume(which) {
    const names = ['OFF', 'LOW', 'MIDDLE', 'HIGH'];
    const min = which === 'speaker' ? 1 : 0;
    const v = this.settings.volume;
    v[which] = v[which] >= 3 ? min : v[which] + 1;
    this.save();
    if (which === 'speaker') this.devices.ncu.monitor?.(v.speaker);
    else this.devices.beeper?.ring?.(true, { volume: v.ringer, sample: true });
    yield* this.flash(lcdPair(msg(which === 'speaker' ? 'SPEAKER_VOL' : 'RINGER_VOL'), names[v[which]]));
    if (which !== 'speaker') this.devices.beeper?.ring?.(false);
  }

  // ---- the document --------------------------------------------------------------------------------------------------

  *loadDocument() {
    this.show(msg('DOC_READY'));
    const r = yield* this.io('feeder', 'load');
    if (r.ok) { this.state.docLoaded = true; this.res = 'STANDARD'; return true; }
    if (r.error === 'jam') { this.state.docJam = true; this.beep('error'); }
    else this.state.doc = this.devices.feeder.status().docPresent;
    return false;
  }

  *eject() {
    yield* this.io('feeder', 'eject');
    this.state.docLoaded = false;
  }

  scanParams() {
    const vres = this.res === 'STANDARD' ? 'standard' : this.res === 'SUPERFINE' ? 'superfine' : 'fine';
    return { vres, halftone: this.res === 'HALFTONE', contrast: this.settings.contrast };
  }

  /**
   * The page source handed to the T.30 caller: each page is the sheet at the read line, scanned and coded when the
   * station asks for it, with the header line on top. The page count is what the feeder holds: the pages begun plus
   * the sheets still to come (so the post-message command is MPS while a sheet waits, EOP after the last).
   */
  scanSource(job) {
    const fw = this;
    return {
      started: 0,
      error: null,
      get pageCount() {
        const f = fw.devices.feeder.status();
        const unscanned = f.loaded && !job.currentScanned ? 1 : 0;
        return this.started + unscanned + (f.waiting ?? 0);
      },
      pageBits(index, params) {
        this.started = index + 1;
        const f = fw.devices.feeder.status();
        if (!f.loaded || job.currentScanned) {
          this.error = 'DOC_JAM';
          fw.k.post({ dev: 'fw', ev: 'scanfault' });
          return encodeRows(() => null, 0, params).bits;
        }
        job.currentScanned = true;
        const sp = fw.scanParams();
        const vres = params.vres;
        const sc = fw.devices.scanner;
        sc.begin({ vres, halftone: sp.halftone, contrast: sp.contrast });
        const scanned = [];
        for (let k = 0; k < 20000; k++) { const row = sc.readLine(k); if (!row) break; scanned.push(row); }
        sc.end();
        const head = fw.settings.header ? headerPage(fw.settings, { wallMs: fw.wallMs(), page: index + 1, vres }) : null;
        const headRows = head ? head.height : 0;
        const rowAt = (i) => {
          if (i < headRows) {
            const r = head.rows.subarray(i * STRIDE, (i + 1) * STRIDE);
            const s = scanned[i];
            if (!s) return r;
            const o = s.slice();
            for (let b = 0; b < STRIDE; b++) o[b] |= r[b];
            return o;
          }
          return scanned[i] ?? null;
        };
        const n = Math.max(scanned.length, headRows);
        const coded = encodeRows(rowAt, n, params);
        if (index === 0) {
          const rows = new Uint8Array(n * STRIDE);
          for (let i = 0; i < n; i++) rows.set(rowAt(i), i * STRIDE);
          job.firstPage = { width: 1728, height: n, vres, rows };
        }
        fw.pace(job, coded, scanned.length, params);
        return coded.bits;
      },
    };
  }

  /**
   * Memory-less pacing: the sheet moves past the sensor as its coded lines go out on the line. Line i is on the line
   * at start + training + its first bit / rate; the feed is commanded in chunks of that timeline. When the last line
   * has gone the sheet is fed out and the next one drawn in.
   */
  pace(job, coded, lines, params) {
    const port = this.devices.line;
    const training = port.trainingSeconds?.(params.rate) ?? TRAINING_SECONDS[params.rate] ?? 0;
    const t0 = this.k.t + training;
    const times = coded.lineStarts.slice(0, lines).map((b) => t0 + b / params.rate);
    let i = 0;
    const step = () => {
      if (job.cancelled) return;
      const from = i;
      const until = this.k.t + TIMING.paceChunkS;
      while (i < times.length && times[i] < until) i++;
      if (i > from) this.cmd('feeder', 'feed', { lines: i - from, vres: params.vres, seconds: TIMING.paceChunkS });
      if (i < times.length) job.timers.push(this.k.at(Math.max(until, times[i]), step));
      else {
        this.cmd('feeder', 'eject', {}, () => {
          if (job.cancelled) return;
          job.currentScanned = false;
          if ((this.devices.feeder.status().waiting ?? 0) > 0) this.cmd('feeder', 'load', {}, (r) => { if (!r.ok) this.k.post({ dev: 'fw', ev: 'scanfault' }); });
        });
      }
    };
    job.timers.push(this.k.at(times.length ? times[0] : this.k.t, step));
  }

  // ---- calls -----------------------------------------------------------------------------------------------------------

  callStation(station, extra = {}) {
    const drv = new CallDriver({
      clock: this.k.clock, station, port: this.devices.line.port(), name: 'FO-70',
      onEvent: (a, t) => this.k.post({ dev: 't30', ev: a.type, t, ...a }),
      onStep: (state) => this.k.post({ dev: 't30', ev: 'state', state }),
      ...extra,
    });
    return drv;
  }

  /**
   * Send the document in the feeder: dial `number` (or, `manual`, on a line already open), call, send every sheet.
   * Busy arms the automatic redial while tries remain.
   */
  *send(number, { redial = null, manual = false, name = '' } = {}) {
    const n = this.devices.ncu;
    this.alert = null;
    if (!manual) { this.lastNumber = number; if (!redial) this.redial = null; }
    const job = { timers: [], cancelled: false, currentScanned: false, firstPage: null };
    const entry = { kind: 'TX', dialled: manual ? '' : number, remote: name, wallMs: this.wallMs(), pages: 0, mode: '', result: 'OK' };
    const t0 = this.k.t;
    let drv = null, result = null;
    try {
      this.show(msg('DIALING'));
      if (!manual) {
        if (n.status().line === false) { result = 'NO_LINE'; return; }
        n.seize(true);
        n.monitor?.(this.settings.volume.speaker);
        yield* this.ev((x) => x.dev === 'ncu' && x.ev === 'progress' && x.signal === 'dialtone', TIMING.dialToneWaitS);
        this.show(lcdText(name || number, name ? 'left' : 'right'));
        const id = this.cmd('ncu', 'dial', { digits: digitsOf(number), mode: this.settings.dialMode });
        const d = yield* this.ev((x) => (x.dev === 'ncu' && x.ev === 'done' && x.id === id) || (x.dev === 'ncu' && x.ev === 'progress' && (x.signal === 'busy' || x.signal === 'reorder')), 120);
        if (d.ev === 'progress') { result = d.signal === 'busy' ? 'BUSY' : 'NO_ANSWER'; return; }
      } else {
        n.seize(true);
      }
      const src = this.scanSource(job);
      const vres = this.scanParams().vres;
      const station = new T30Caller({ ident: this.settings.ownNumber, source: src, vres, twoD: true });
      drv = this.callStation(station);
      drv.start();
      for (;;) {
        const e = yield* this.ev((x) => x.dev === 't30' || (x.dev === 'ncu' && (x.ev === 'released' || (x.ev === 'progress' && (x.signal === 'busy' || x.signal === 'reorder')))) || (x.dev === 'feeder' && x.ev === 'jam') || (x.dev === 'fw' && x.ev === 'scanfault'), null, { stop: true });
        if (isStop(e)) { result = 'STOPPED'; yield* this.stopCall(drv); break; }
        if (e.dev === 'ncu') {
          if (e.ev === 'released') { result = drv.done ? null : 'LINE_DROP'; if (!drv.done) break; continue; }
          result = e.signal === 'busy' ? 'BUSY' : 'NO_ANSWER';
          break;
        }
        if (e.dev === 'feeder' || e.dev === 'fw') { result = 'DOC_JAM'; drv.abort(); yield* this.waitHangup(drv); break; }
        if (e.ev === 'state') {
          if (e.state === 'T.sendDCS' || e.state.startsWith('B.')) n.monitor?.(0);
          if (e.state === 'T.sendPage') {
            this.show(lcdPair(msg('SENDING'), `P.${p2(station.tx.page + 1)}`));
            entry.mode = `G3 ${station.rate}`;
          }
          continue;
        }
        if (e.ev === 'page-sent') { if (e.response !== 'RTN') entry.pages++; continue; }
        if (e.ev === 'hangup') { result = result ?? errorForHangup(e.reason); entry.remote = station.remote.ident || entry.remote; break; }
      }
    } finally {
      job.cancelled = true;
      for (const t of job.timers) this.k.cancel(t);
      drv?.drop();
      n.monitor?.(0);
      n.seize(false);
      this.log.push({ t: this.k.t, what: 'send', number, result });
    }
    result = result ?? 'OK';
    if (result === 'NO_LINE') { this.alert = 'LINE_ERROR'; return; }
    if (job.currentScanned) yield* this.eject();         // a sheet caught half sent goes out
    entry.result = result;
    entry.durationS = this.k.t - t0;
    if (result === 'BUSY') {
      const left = redial ? redial.left : TIMING.redialTries;
      if (left > 0 && this.state.docLoaded) {
        this.redial = { number, left, at: this.k.t + TIMING.redialIntervalS };
        this.beep('error');
        yield* this.flash(msg('LINE_BUSY'), TIMING.resultS);
        return;
      }
    }
    this.redial = null;
    this.addJournal(entry);
    this.lastTx = { entry, firstPage: job.firstPage };
    if (result === 'OK') { this.beep('end'); yield* this.flash(msg('TX_OK'), TIMING.resultS); }
    else if (result !== 'STOPPED') { this.beep('error'); this.alert = ERRORS[result].lcd ?? 'LINE_ERROR'; }
    const rep = this.settings.report;
    if (rep === 'ALWAYS' || (rep === 'ERROR' && result !== 'OK' && result !== 'STOPPED')) yield* this.printList('transmission');
  }

  /**
   * STOP during a call: between signals the station sends DCN and hangs up [M]; while a page's carrier is going out
   * (the modem layer cannot cut a transmission short here) the line is simply released [A].
   */
  *stopCall(drv) {
    if (drv.done) return;
    if (drv.station.txBusy && (drv.station.state === 'T.sendPage' || drv.station.state === 'T.sendTCF')) return;
    drv.abort();
    yield* this.waitHangup(drv);
  }

  *waitHangup(drv) {
    if (drv.done) return;
    yield* this.ev((x) => x.dev === 't30' && x.ev === 'hangup', TIMING.stopWaitS, { stop: true });
  }

  /** E/POLL with no document: a number, then START. */
  *pollEntry() {
    this.show(msg('POLLING'));
    const k = yield* this.key(this.ENTRY_TIMEOUT);
    if (k == null) return;
    let number = null, name = '';
    if (isRapidKey(k)) { const e = this.settings.speed[rapidIndex(k) - 1]; if (!e) return; number = e.number; name = e.name; }
    else if (k === 'SPEED_DIAL') { const i = yield* chooseSpeed(this); const e = i && this.settings.speed[i - 1]; if (!e) return; number = e.number; name = e.name; }
    else if (isDigitKey(k)) number = yield* numberEntry(this, { first: k });
    else return;
    if (!number) return;
    if (name) { this.show(name); const go = yield* this.key(this.ENTRY_TIMEOUT); if (go !== 'START') return; }
    yield* this.receive({ poll: number, name });
  }

  /**
   * Receive: answer (or, `poll`, dial and poll), print each page as it is decoded, cut it. With `seized` the line
   * is already held (TEL/FAX, manual).
   */
  *receive({ poll = null, name = '', manual = false, how = 'auto' } = {}) {
    const n = this.devices.ncu;
    this.alert = null;
    const entry = { kind: poll ? 'POLL' : 'RX', dialled: poll ?? '', remote: name, wallMs: this.wallMs(), pages: 0, mode: '', result: 'OK' };
    const t0 = this.k.t;
    let drv = null, result = null, fault = null;
    const printing = { busy: 0 };
    const onPage = (page) => {
      entry.pages++;
      printing.busy++;
      this.cmd('printer', 'print', { rows: page.rows, count: page.height, vres: page.vres, contrast: this.settings.contrast }, (r) => {
        if (!r.ok) { printing.busy--; fault = fault ?? (r.error === 'cover' ? 'COVER' : 'PAPER'); this.k.post({ dev: 'fw', ev: 'rxfault' }); return; }
        this.cmd('cutter', 'cut', {}, (c) => {
          printing.busy--;
          if (!c.ok) { fault = fault ?? 'CUTTER'; this.k.post({ dev: 'fw', ev: 'rxfault' }); }
          this.k.post({ dev: 'fw', ev: 'printed' });
        });
      });
    };
    const refuse = () => !this.state.paper || this.state.cover || fault != null;
    try {
      if (poll) {
        this.show(msg('DIALING'));
        if (n.status().line === false) { result = 'NO_LINE'; return; }
        n.seize(true);
        n.monitor?.(this.settings.volume.speaker);
        yield* this.ev((x) => x.dev === 'ncu' && x.ev === 'progress' && x.signal === 'dialtone', TIMING.dialToneWaitS);
        this.show(lcdText(name || poll, name ? 'left' : 'right'));
        const id = this.cmd('ncu', 'dial', { digits: digitsOf(poll), mode: this.settings.dialMode });
        const d = yield* this.ev((x) => (x.dev === 'ncu' && x.ev === 'done' && x.id === id) || (x.dev === 'ncu' && x.ev === 'progress' && (x.signal === 'busy' || x.signal === 'reorder')), 120);
        if (d.ev === 'progress') { result = d.signal === 'busy' ? 'BUSY' : 'NO_ANSWER'; return; }
      } else {
        n.seize(true);
      }
      this.show(msg('RECEIVING'));
      const checker = pageChecker(onPage, refuse);
      const station = poll
        ? new T30Caller({ ident: this.settings.ownNumber, poll: true, checker })
        : new T30Answerer({ ident: this.settings.ownNumber, checker });
      drv = this.callStation(station);
      drv.start();
      let blocked = false;
      for (;;) {
        const e = yield* this.ev((x) => x.dev === 't30' || (x.dev === 'ncu' && (x.ev === 'released' || (x.ev === 'progress' && (x.signal === 'busy' || x.signal === 'reorder')))) || (x.dev === 'fw' && x.ev === 'rxfault'), null, { stop: true });
        if (isStop(e)) { result = 'STOPPED'; yield* this.stopCall(drv); break; }
        if (e.dev === 'fw') { if (!drv.done) { drv.abort(); yield* this.waitHangup(drv); } result = fault; break; }
        if (e.dev === 'ncu') {
          if (e.ev === 'released') { if (!drv.done) { result = 'LINE_DROP'; break; } continue; }
          result = e.signal === 'busy' ? 'BUSY' : 'NO_ANSWER';
          break;
        }
        if (e.ev === 'state') {
          if (e.state.startsWith('R.') || e.state.startsWith('T.')) n.monitor?.(0);
          if (!blocked && station.remote.ident && isJunk(this.settings, station.remote.ident)) {
            blocked = true; result = 'BLOCKED'; drv.abort(); yield* this.waitHangup(drv); break;
          }
          if (e.state === 'R.waitPage' && station.rx?.dcs) {
            entry.mode = `G3 ${station.rx.dcs.rate}`;
            this.show(lcdPair(msg('RECEIVING'), `P.${p2(station.pagesReceived + 1)}`));
          }
          continue;
        }
        if (e.ev === 'hangup') { result = result ?? fault ?? errorForHangup(e.reason); break; }
      }
      entry.remote = station.remote.ident || entry.remote;
    } finally {
      drv?.drop();
      n.monitor?.(0);
      n.seize(false);
    }
    // The last page finishes printing before the result is shown.
    while (printing.busy > 0 && !fault) {
      const e = yield* this.ev((x) => x.dev === 'fw' && (x.ev === 'printed' || x.ev === 'rxfault'), 120);
      if (e.ev === 'timeout') break;
    }
    result = fault ?? result ?? 'OK';
    entry.result = result;
    entry.durationS = this.k.t - t0;
    this.log.push({ t: this.k.t, what: 'receive', result, pages: entry.pages });
    if (result === 'NO_LINE') { this.alert = 'LINE_ERROR'; return; }
    this.addJournal(entry);
    if (result === 'OK') { this.beep('end'); yield* this.flash(msg('RX_OK'), TIMING.resultS); }
    else if (result !== 'STOPPED') { this.beep('error'); if (!['PAPER', 'COVER', 'CUTTER'].includes(result)) this.alert = ERRORS[result].lcd ?? 'LINE_ERROR'; }
  }

  // ---- an incoming call ---------------------------------------------------------------------------------------------

  *incoming(first) {
    const s = this.settings;
    let rings = first.count ?? 1;
    let cid = null;
    const ringer = (on) => this.devices.beeper?.ring?.(on, { volume: s.volume.ringer });
    ringer(true);
    let mode = s.rxMode;
    if (s.distinctive && first.pattern !== 'distinctive') mode = 'TEL';     // [A] other patterns are voice calls
    try {
      for (;;) {
        this.show(cid ? (cid.name || cid.number) : msg('INCOMING'));
        const junk = cid && isJunk(s, cid.number);
        if (!junk) {
          if (mode === 'FAX' && rings >= s.rings && this.state.paper && !this.state.cover) { ringer(false); return yield* this.receive({ how: 'auto' }); }
          if (mode === 'TEL/FAX' && rings >= s.rings) { ringer(false); return yield* this.telFax(); }
          if (mode === 'A.M.' && rings >= TIMING.amFallbackRings && this.state.paper) { ringer(false); return yield* this.receive({ how: 'auto' }); }
        }
        const e = yield* this.ev((x) => x.dev === 'ncu' && ['ring', 'callerId', 'handset', 'ext'].includes(x.ev), TIMING.ringGapS);
        if (e.ev === 'timeout') return;                     // the caller gave up
        if (e.ev === 'ring') { ringer(e.on); if (e.on) rings = e.count ?? rings + 1; }
        else if (e.ev === 'callerId') { if (s.callerId) cid = e; }
        else if (e.ev === 'handset' && e.off) { ringer(false); return yield* this.telephone('handset', { answered: true }); }
        else if (e.ev === 'ext' && e.off && mode === 'A.M.') { ringer(false); return yield* this.amWatch(); }
      }
    } finally {
      ringer(false);
    }
  }

  /** Watch the line's tones for CNG while something else holds it; posts { dev: 'fw', ev: 'cng' }. */
  watchCng() {
    const port = this.devices.line.port();
    const nop = () => {};
    port.listen({ v21Carrier: nop, v21Bits: nop, hsCarrier: nop, hsBits: nop, tone: (tone, on) => { if (tone === 'CNG' && on) this.k.post({ dev: 'fw', ev: 'cng' }); } });
  }

  /** TEL/FAX: answer, listen for CNG, then pseudo-ring the handset; no pickup in time: receive [A]. */
  *telFax() {
    const n = this.devices.ncu;
    n.seize(true);
    this.watchCng();
    const accept = (x) => (x.dev === 'fw' && x.ev === 'cng') || (x.dev === 'ncu' && (x.ev === 'released' || (x.ev === 'handset' && x.off)));
    let e = yield* this.ev(accept, TIMING.cngWindowS);
    if (e.ev === 'timeout') {
      this.show(msg('PICK_UP'));
      this.devices.beeper?.ring?.(true, { volume: Math.max(1, this.settings.volume.ringer), pattern: 'pseudo' });
      try { e = yield* this.ev(accept, this.settings.pseudoRingS); }
      finally { this.devices.beeper?.ring?.(false); }
    }
    if (e.ev === 'released') { n.seize(false); return; }
    if (e.ev === 'handset') { n.seize(false); return yield* this.telephone('handset', { answered: true }); }
    return yield* this.receive({ how: 'telfax' });     // CNG heard, or nobody picked up
  }

  /** A.M. mode: the answering machine has the line; take over if CNG is heard. */
  *amWatch() {
    this.watchCng();
    const e = yield* this.ev((x) => (x.dev === 'fw' && x.ev === 'cng') || (x.dev === 'ncu' && (x.ev === 'released' || (x.ev === 'ext' && !x.off))), TIMING.amWatchS);
    if (e.ev === 'cng') return yield* this.receive({ how: 'am' });
  }

  // ---- the telephone ---------------------------------------------------------------------------------------------------

  /** Handset off hook, or SPEAKER: dial by hand, talk, HOLD, START to send or receive by hand. */
  *telephone(via, { answered = false } = {}) {
    const n = this.devices.ncu;
    let speaker = via === 'speaker';
    let dialled = '';
    let hold = false;
    if (speaker) { n.seize(true); n.monitor?.(this.settings.volume.speaker); }
    const dial = (digits) => { dialled += digits; this.cmd('ncu', 'dial', { digits, mode: this.settings.dialMode }); };
    try {
      for (;;) {
        this.show(hold ? msg('ON_HOLD') : dialled ? lcdText(dialled, 'right') : msg(speaker ? 'ON_HOOK_DIAL' : 'TELEPHONE'));
        const e = yield* this.ev((x) => isKey(x) || (x.dev === 'ncu' && (x.ev === 'handset' || x.ev === 'released')), null, { stop: true });
        if (e.dev === 'ncu') {
          if (e.ev === 'handset') {
            if (!e.off && !speaker && !hold) return;
            if (e.off && speaker) { speaker = false; n.monitor?.(0); n.seize(false); }   // the handset takes over
          }
          continue;
        }
        const k = e.key;
        if (k === 'STOP' || (k === 'SPEAKER' && speaker)) {
          if (speaker || !this.state.handset) return;
          continue;
        }
        if (isDigitKey(k)) { dial(k); continue; }
        if (isRapidKey(k) || k === 'REDIAL') {
          const num = k === 'REDIAL' ? this.lastNumber : this.settings.speed[rapidIndex(k) - 1]?.number;
          if (num) { this.lastNumber = num; dial(digitsOf(num)); }
          continue;
        }
        if (k === 'SPEED_DIAL') {
          const i = yield* chooseSpeed(this);
          const num = i && this.settings.speed[i - 1]?.number;
          if (num) { this.lastNumber = num; dial(digitsOf(num)); }
          continue;
        }
        if (k === 'HOLD_SEARCH') { hold = !hold; n.hold?.(hold); if (hold) n.seize(true); continue; }
        if (k === 'VOLUME' && speaker) { yield* this.volume('speaker'); continue; }
        if (k === 'START') {
          if (this.state.docLoaded) yield* this.send(null, { manual: true });
          else yield* this.receive({ how: 'manual', manual: true });
          return;
        }
      }
    } finally {
      if (speaker || hold) { n.monitor?.(0); n.seize(false); n.hold?.(false); }
      void answered;
    }
  }

  // ---- copy and printing ------------------------------------------------------------------------------------------------

  printerReady() {
    if (this.state.cover) return 'COVER';
    if (!this.state.paper) return 'PAPER';
    return null;
  }

  /** COPY: scan and print in alternate blocks (one motor, no memory [M]), then cut. Fine at least [A]. */
  *copy() {
    if (this.printerReady()) { this.beep('error'); return; }
    const sp = this.scanParams();
    const vres = sp.vres === 'standard' ? 'fine' : sp.vres;
    let pages = 0;
    try {
      while (this.state.docLoaded) {
        this.show(lcdPair(msg('COPYING'), `P.${p2(pages + 1)}`));
        const sc = this.devices.scanner;
        sc.begin({ vres, halftone: sp.halftone, contrast: sp.contrast });
        const rows = [];
        for (let k = 0; k < 20000; k++) { const r = sc.readLine(k); if (!r) break; rows.push(r); }
        sc.end();
        for (let i = 0; i < rows.length; i += TIMING.copyBlockLines) {
          const block = rows.slice(i, i + TIMING.copyBlockLines);
          const f = yield* this.io('feeder', 'feed', { lines: block.length, vres, seconds: block.length * TIMING.copyLineS * LINES_PER_MM.fine / LINES_PER_MM[vres] });
          if (!f.ok) { this.state.docJam = true; return; }
          const buf = new Uint8Array(block.length * STRIDE);
          block.forEach((r, j) => buf.set(r, j * STRIDE));
          const p = yield* this.io('printer', 'print', { rows: buf, count: block.length, vres, contrast: this.settings.contrast });
          if (!p.ok) { this.beep('error'); return; }
          const stop = this.k.queue.find(isStop);
          if (stop) throw new Stop();
        }
        yield* this.io('cutter', 'cut');
        pages++;
        yield* this.eject();
        if ((this.devices.feeder.status().waiting ?? 0) > 0) { if (!(yield* this.loadDocument())) break; }
      }
    } finally {
      this.log.push({ t: this.k.t, what: 'copy', pages });
    }
  }

  /** Print a report or list: 'transmission', 'activity', 'tel', 'setup', 'help'. */
  *printList(kind) {
    const now = this.wallMs();
    let page;
    if (kind === 'transmission') { if (!this.lastTx) { this.beep('error'); return; } page = transmissionReport(this.lastTx.entry, this.settings, { now, firstPage: this.lastTx.firstPage }); }
    else if (kind === 'activity') page = activityReport(this.journal, this.settings, { now });
    else if (kind === 'tel') page = telephoneList(this.settings, { now });
    else if (kind === 'setup') page = setupList(this.settings, { now });
    else page = helpList(this.settings, { now });
    yield* this.printPage(page, kind);
  }

  *printPage(page, kind = 'page') {
    const err = this.printerReady();
    if (err) { this.beep('error'); return false; }
    this.show(msg('PRINTING'));
    const r = yield* this.io('printer', 'print', { rows: page.rows, count: page.height, vres: page.vres, contrast: this.settings.contrast });
    if (r.ok) yield* this.io('cutter', 'cut');
    this.log.push({ t: this.k.t, what: 'print', kind, ok: r.ok, rows: page.height });
    return r.ok;
  }
}
