// The Sharp FO-70's firmware: the machine's top loop on a simulated clock. Pure: no DOM and no timers; the host hands
// in devices (devices.md), delivers their events with deviceEvent() and moves time with advance().
//
// What it does, and where the behaviour comes from. [OM p.N] the FO-10/FO-50/FO-70 operation manual, [SM p.N] the
// service manual (docs/fax/refs/), [A] ours:
//   power on: WAIT A MOMENT; STOP then offers MEMORY CLEAR? [SM p.7-2]
//   standby: "05-NOV 10:30" and an arrow to the reception mode's legend by the window [OM p.28]; a document laid in the
//     feeder is drawn in and READY TO SEND shown [OM p.33]
//   RESOLUTION/RECEPTION MODE: with a document, STANDARD FINE SUPER FINE HALF TONE at AUTO, then at DARK contrast
//     [OM p.37]; without, the reception mode TEL, FAX, TEL/FAX, A.M. [OM p.28]
//   sending: number keys + START (STOP backspaces) [OM p.47], a rapid key [OM p.45], SPEED DIAL + two digits + START
//     [OM p.46], HOLD/SEARCH 1, a letter, # or * and START [OM p.48]; the handset or SPEAKER, dial, START on the
//     fax tone [OM p.38]; REDIAL turns the speaker on and redials, START sends [OM p.39]
//   automatic redial when busy or unanswered: RECALLING, 2 more tries at 5 minutes [OM p.49, p.91; SM SW-B1, B2]
//   after a transaction TOTAL PAGE(S) nn and a 3 s tone, or a 5 s intermittent tone when it failed [OM p.91]; the
//     transaction report by the TRANSACTION LIST setting [OM p.50-51]
//   copy: COPY/HELP with a document; the Help List without [OM p.9, p.59]
//   reception: FAX answers on the set rings (2) [OM p.53]; TEL by the handset, reception starting by itself on a fax
//     tone (FAX SIGNAL RX) or by START [OM p.55-58]; TEL/FAX answers, listens about five seconds for a fax tone, else
//     pseudo-rings 30 seconds and then receives [OM p.52]; A.M. leaves the call to the answering machine and takes
//     over on a fax tone [OM p.64], or answers after 5 rings when FAX RX A.M. FAILS is on [OM p.67]
//   polling: dial (number keys, SPEED DIAL, or the handset), then E/POLL, when POLLING is set to YES [OM p.79-80]
//   Caller ID, priority call, duplex ringing, anti junk fax [OM p.69-78]
//   VOLUME: the ringer MIDDLE HIGH RINGER OFF: OK? LOW, or the speaker's MIDDLE HIGH LOW while it is on [OM p.29-30]
//   STOP at any point: every wait in an operation ends on it; a call in progress is ended with DCN [A]
//   no page memory [SM p.5-2: the 256 kbit SRAM is line memory]: the document is fed as fast as the modem takes its
//     lines (pacing below), and a received page is printed as it is decoded; with no paper the machine does not
//     answer, and paper running out during a reception ends the call.

import { Kernel, wait, event } from './kernel.js';
import { CallDriver } from './call.js';
import { msg, ERRORS, errorForHangup, commCode, resText } from './messages.js';
import { Lcd, lcdPair, lcdText, isDigitKey, isRapidKey } from './panel.js';
import {
  loadSettings, MemoryStorage, STORAGE_KEY, JOURNAL_KEY, RX_MODES, digitsOf, rapidIndex, isJunk,
  numberEntry, chooseSpeed, functionMenu, SPEED_COUNT, defaultSettings,
} from './setup.js';
import { decode } from './softswitch.js';
import { diagnostics } from './diag.js';
import { KEY_LETTERS } from './panel.js';
import { encodeRows, pageChecker, STRIDE, LINES_PER_MM } from './page.js';
import { transactionReport, telephoneList, junkList, helpList, headerPage, JOURNAL_LENGTH } from './reports.js';
import { T30Caller } from '../t30/caller.js';
import { T30Answerer } from '../t30/answerer.js';
import { TRAINING_SECONDS } from '../transport.js';

/** Timing, from the manuals where marked, else ours [A]. */
export const TIMING = Object.freeze({
  bootS: 1,                // WAIT A MOMENT [SM p.7-2; its length A]
  memoryClearS: 3,         // MEMORY CLEAR? waits for START [SM p.7-2]
  dialToneWaitS: 3,        // listen this long for dial tone before dialling blind
  resultS: 3,              // TOTAL PAGE(S) stays this long
  flashS: 2,               // a setting's name after a key press
  redialTries: 2,          // [OM p.49; SM SW-B2 No. 1-4]
  redialIntervalS: 300,    // [OM p.49: 5 minutes; SM SW-B1 No. 4-8]
  ringGapS: 7,             // no ring for this long: the caller has given up
  cngWindowS: 5,           // TEL/FAX: listen "about five seconds" for a fax tone [OM p.52; SM SW-E1 No. 5]
  telFaxRings: 2,          // TEL/FAX answers on two rings [OM p.52]
  amFallbackRings: 5,      // FAX RX A.M. FAILS: the fax answers after 5 rings [OM p.67]
  duplexRings: 2,          // duplex ringing: a fax call is answered after 2 rings [OM p.75]
  amWatchS: 40,            // A.M. mode: listen for CNG while the answering machine has the line [SM SW-G3 No. 3-4: 40 s]
  paceChunkS: 0.5,         // the feed is commanded in steps of this many seconds of line time
  copyBlockLines: 128,     // copy: scan and print alternate in blocks (one motor [M])
  copyLineS: 1 / 154,      // copy: time a line takes to scan at fine (20 mm/s [A])
  stopWaitS: 10,           // after STOP, how long to wait for DCN to go out
});

export class Stop extends Error { constructor() { super('STOP'); } }

/** The RESOLUTION/RECEPTION MODE key's settings with a document: each resolution at AUTO, then at DARK [OM p.37]. */
const RES_ORDER = ['STANDARD', 'FINE', 'SUPERFINE', 'HALFTONE'];
/** Where the arrow stands for each reception mode: column and glyph (▲ to TEL or FAX above, ▼ to TEL/FAX or A.M. below) [OM p.28]. */
export const MODE_ARROW = { TEL: [13, '▲'], FAX: [15, '▲'], 'TEL/FAX': [13, '▼'], 'A.M.': [15, '▼'] };
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
    this.contrast = 'AUTO';     // [OM p.36: the defaults are STANDARD and AUTO, set again for each document]
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

  /** The soft switches decoded (softswitch.js). */
  get sw() { return decode(this.settings.softSwitches); }

  /** "05-NOV 10:30" and the reception mode's arrow [OM p.28; SM p.1-9]; 12-hour and month-first by SW-J3. */
  clockLine() {
    const d = new Date(this.wallMs());
    const sw = this.sw;
    let h = d.getUTCHours();
    if (sw.clock12h) h = h % 12 || 12;
    const date = sw.monthFirst ? `${MONTHS[d.getUTCMonth()]}-${p2(d.getUTCDate())}` : `${p2(d.getUTCDate())}-${MONTHS[d.getUTCMonth()]}`;
    const line = `${date} ${p2(h)}:${p2(d.getUTCMinutes())}`.padEnd(16).split('');
    const [col, glyph] = MODE_ARROW[this.settings.rxMode] ?? MODE_ARROW.FAX;
    line[col] = glyph;
    return line.join('');
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

  /** The next key, STOP included (returned, not thrown); null after `timeout` seconds. */
  *keyOrStop(timeout) {
    const e = yield* this.ev((x) => isKey(x), timeout, { stop: true });
    return e.dev === 'keys' ? e.key : null;
  }

  /** Show a text and wait for a key (STOP throws). */
  *showKey(text, timeout = this.MENU_TIMEOUT) { this.show(text); return yield* this.key(timeout); }

  throwStop() { throw new Stop(); }

  *diagnostics() { yield* diagnostics(this); }

  /** Back to the factory settings, the desk's numbers kept out (memory clear) [SM p.2-3, p.7-2]. */
  memoryClear() {
    const d = defaultSettings();
    for (const k of Object.keys(this.settings)) delete this.settings[k];
    Object.assign(this.settings, d);
    this.save();
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

  /** Power on [SM p.7-2]: WAIT A MOMENT; STOP then shows MEMORY CLEAR?, which START answers within 3 s. */
  *powerOn() {
    if (this.options.resume) return;
    this.show(msg('WAIT_MOMENT'));
    const e = yield* event((x) => isStop(x), TIMING.bootS);
    if (!isStop(e)) return;
    this.show(msg('MEMORY_CLEAR_Q'));
    const k = yield* event((x) => isKey(x), TIMING.memoryClearS);
    if (isKey(k, 'START')) { this.memoryClear(); this.show(msg('MEMORY_CLEARED')); yield* wait(TIMING.flashS); }
  }

  *mainLoop() {
    yield* this.powerOn();
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
    if (!s.paper) return msg('OUT_OF_PAPER');
    if (this.alert) return msg(this.alert);
    if (this.redial) return msg('RECALLING');
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
      if (!doc) {
        // The arrow moves to the next mode [OM p.28].
        this.settings.rxMode = RX_MODES[(RX_MODES.indexOf(this.settings.rxMode) + 1) % RX_MODES.length];
        this.save();
        return;
      }
      // Each press while the setting is shown moves it on: STANDARD :AUTO ... HALF TONE :DARK [OM p.37]; the first
      // press shows the setting in force.
      let first = true;
      for (let next = k; next === 'RESOLUTION';) {
        if (!first) {
          const i = RES_ORDER.indexOf(this.res) + (this.contrast === 'DARK' ? 4 : 0) + 1;
          this.res = RES_ORDER[i % 4]; this.contrast = i % 8 >= 4 ? 'DARK' : 'AUTO';
        }
        first = false;
        next = yield* this.flash(resText(this.res, this.contrast));
        if (next && next !== 'RESOLUTION') return yield* this.onKey(next);
      }
      return;
    }
    if (k === 'FUNCTION') { try { yield* functionMenu(this); } catch (e) { if (!(e instanceof Stop)) throw e; } return; }
    if (k === 'SPEAKER') { yield* this.telephone('speaker'); return; }
    if (k === 'COPY_HELP') { if (doc) yield* this.copy(); else yield* this.printList('help'); return; }
    if (k === 'VOLUME') { yield* this.volume('ringer'); return; }
    const pollKey = this.settings.pollingKey;
    if (k === 'E' && pollKey) { this.beep('error'); return; }       // Rapid Dial Keys cannot be used for polling [OM p.80]
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
      else if (go === 'E' && pollKey && !this.state.docLoaded) yield* this.receive({ poll: e.number, name: e.name });
      return;
    }
    if (k === 'REDIAL') {
      // The speaker comes on and the last number is redialled; START sends on the fax tone [OM p.39, p.61; SM SW-B1 No. 2].
      if (!this.lastNumber) return;
      yield* this.telephone('speaker', { dial: this.lastNumber });
      return;
    }
    if (k === 'HOLD_SEARCH') {
      const e = yield* this.search();
      if (e && this.state.docLoaded) yield* this.send(e.number, { name: e.name });
      return;
    }
    if (isDigitKey(k)) {
      const n = yield* numberEntry(this, { first: k, ends: pollKey ? ['START', 'E'] : ['START'], stopBackspace: true });
      if (!n || !n.text) return;
      if (n.key === 'E' && !this.state.docLoaded) yield* this.receive({ poll: n.text });
      else if (n.key === 'START' && this.state.docLoaded) yield* this.send(n.text);
      else this.beep('error');
      return;
    }
    if (k === 'START' && !doc) this.beep('error');
  }

  /**
   * HOLD/SEARCH: SEARCH DIAL; 1, then the first letter of the name by its key (1 for a symbol or number, 0 for the
   * numbers); # or * scrolls in alphabetical order from there; START chooses [OM p.48-49]. 2 reviews the Caller ID list
   * [OM p.72]. NO DATA with nothing stored.
   */
  *search() {
    let k = yield* this.showKey(msg('SEARCH_DIAL'), this.ENTRY_TIMEOUT);
    if (k === '2') return yield* this.reviewCalls();
    const byName = this.settings.speed.filter(Boolean).slice().sort((a, b) => (a.name || a.number).localeCompare(b.name || b.number));
    if (!byName.length) { yield* this.flash(msg('NO_DATA')); return null; }
    let list = byName, i = -1, letter = '', last = null, li = 0;
    const show = () => this.show(i >= 0 ? (list[i].name || list[i].number) : letter ? letter : msg('SEARCH_DIAL'));
    if (k === '1') {
      for (;;) {
        show();
        k = yield* this.key(this.ENTRY_TIMEOUT);
        if (k == null) return null;
        if (k === '0' && !letter) { list = this.settings.speed.filter(Boolean).slice().sort((a, b) => a.number.localeCompare(b.number)).map((e) => ({ ...e, name: '' })); break; }
        if (/^[1-9]$/.test(k)) {
          const cyc = k === '1' ? '1' : KEY_LETTERS[k];
          li = k === last ? (li + 1) % cyc.length : 0; last = k; letter = cyc[li];
          continue;
        }
        break;
      }
    }
    for (;;) {
      if (k === '#' || k === '*') {
        if (i < 0) {
          const from = letter ? list.findIndex((e) => (e.name || e.number).toUpperCase() >= letter) : 0;
          i = from < 0 ? 0 : from;
          if (k === '*' && !letter) i = list.length - 1;
        } else i = (i + (k === '#' ? 1 : list.length - 1)) % list.length;
      } else if (k === 'START' && i >= 0) return list[i];
      else if (k == null) return null;
      show();
      k = yield* this.key(this.ENTRY_TIMEOUT);
    }
  }

  /** The Caller ID list: * from the most recent, # from the oldest; 0 deletes; START chooses [OM p.72-73]. */
  *reviewCalls() {
    const calls = this.settings.callers;
    let k = yield* this.showKey(msg('REVIEWING_CALLS'), this.ENTRY_TIMEOUT);
    if (!calls.length) { yield* this.flash(msg('NO_DATA')); return null; }
    let i = -1;
    for (;;) {
      if (k === '*') i = i < 0 ? calls.length - 1 : (i + calls.length - 1) % calls.length;
      else if (k === '#') i = i < 0 ? 0 : (i + 1) % calls.length;
      else if (k === '0' && i >= 0) { calls.splice(i, 1); this.save(); if (!calls.length) return null; i = Math.min(i, calls.length - 1); }
      else if (k === 'START' && i >= 0) return { number: calls[i].number, name: calls[i].name };
      else if (k == null) return null;
      this.show(i >= 0 ? (calls[i].name || calls[i].number) : msg('REVIEWING_CALLS'));
      k = yield* this.key(this.ENTRY_TIMEOUT);
    }
  }

  /**
   * VOLUME [OM p.29-30]. The speaker's (while SPEAKER is on): MIDDLE, HIGH, LOW in turn, "SPEAKER: HIGH". The ringer's:
   * MIDDLE, HIGH, then RINGER OFF: OK? (START turns it off), then LOW, "RINGER: HIGH". Each press moves on.
   */
  *volume(which) {
    const names = ['OFF', 'LOW', 'MIDDLE', 'HIGH'];
    const v = this.settings.volume;
    for (let k = 'VOLUME'; k === 'VOLUME';) {
      if (which === 'speaker') {
        v.speaker = v.speaker >= 3 ? 1 : v.speaker + 1;
        this.devices.ncu.monitor?.(v.speaker);
        this.save();
        k = yield* this.flash(`${msg('SPEAKER_VOL')} ${names[v.speaker]}`);
        continue;
      }
      if (v.ringer === 3 && !this.offAsked) {
        this.offAsked = true;
        k = yield* this.flash(msg('RINGER_OFF_Q'));
        if (k === 'START') { v.ringer = 0; this.save(); this.offAsked = false; return; }
        continue;
      }
      this.offAsked = false;
      v.ringer = v.ringer >= 3 || v.ringer === 0 ? 1 : v.ringer + 1;
      this.save();
      this.devices.beeper?.ring?.(true, { volume: v.ringer, sample: true });
      k = yield* this.flash(`${msg('RINGER_VOL')} ${names[v.ringer]}`);
      this.devices.beeper?.ring?.(false);
    }
  }

  // ---- the document --------------------------------------------------------------------------------------------------

  *loadDocument() {
    this.show(msg('DOC_READY'));
    const r = yield* this.io('feeder', 'load');
    if (r.ok) { this.state.docLoaded = true; this.res = 'STANDARD'; this.contrast = 'AUTO'; return true; }
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
    return { vres, halftone: this.res === 'HALFTONE', contrast: this.contrast === 'DARK' ? 'DARK' : 'NORMAL' };
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
        // The name, number, date and time at the top of every page sent [OM p.20, p.24].
        const head = headerPage(fw.settings, { wallMs: fw.wallMs(), page: index + 1, vres });
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
      if (drv?.station?.result) entry.call = drv.station.result;
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
    entry.code = ERRORS[result].note === 'COM' ? commCode('TX', entry.call ?? { reason: 'no-signal' }) : null;
    delete entry.call;
    entry.durationS = this.k.t - t0;
    // Busy, or no answer: RECALLING, and two more tries five minutes apart, for automatic dialling [OM p.49, p.91].
    if ((result === 'BUSY' || (result === 'NO_ANSWER' && !entry.pages)) && !manual) {
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
    yield* this.endOf(entry);
  }

  /** The end of a transaction [OM p.91]: TOTAL PAGE(S) and the 3 s tone, or the failure's message and the intermittent
   * tone; then the transaction report by its setting [OM p.50]. */
  *endOf(entry) {
    const result = entry.result;
    if (result === 'OK') { this.beep('end'); yield* this.flash(`${msg('TOTAL_PAGES')} ${p2(entry.pages)}`, TIMING.resultS); }
    else if (result !== 'STOPPED') { this.beep('error'); const lcd = ERRORS[result].lcd; if (lcd && !['COVER_OPEN', 'OUT_OF_PAPER'].includes(lcd)) this.alert = lcd; }
    const rep = this.settings.report;
    const print = result !== 'BLOCKED' && (rep === 'ALWAYS' || (rep === 'SEND' && entry.kind === 'TX') || (rep === 'ERROR' && result !== 'OK'));   // a blocked junk fax prints nothing [A]
    if (print && !this.printerReady()) yield* this.printList('transaction', entry);
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

  /**
   * Receive: answer (or, `poll`, dial and poll), print each page as it is decoded, cut it. With `seized` the line
   * is already held (TEL/FAX, manual).
   */
  *receive({ poll = null, name = '', manual = false, how = 'auto', pollManual = false } = {}) {
    const n = this.devices.ncu;
    this.alert = null;
    const entry = { kind: poll || pollManual ? 'POLL' : 'RX', dialled: poll ?? '', remote: name, wallMs: this.wallMs(), pages: 0, mode: '', result: 'OK' };
    const t0 = this.k.t;
    let drv = null, result = null, fault = null;
    const printing = { busy: 0 };
    const onPage = (page) => {
      entry.pages++;
      printing.busy++;
      this.cmd('printer', 'print', { rows: page.rows, count: page.height, vres: page.vres, contrast: 'NORMAL' }, (r) => {
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
      this.show(msg(poll || pollManual ? 'POLLING' : 'RECEIVING'));
      const checker = pageChecker(onPage, refuse);
      const station = poll || pollManual
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
      if (station.result) entry.call = station.result;
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
    entry.code = ERRORS[result].note === 'COM' ? commCode('RX', entry.call ?? { reason: 'no-signal' }) : null;
    delete entry.call;
    entry.durationS = this.k.t - t0;
    this.log.push({ t: this.k.t, what: 'receive', result, pages: entry.pages });
    if (result === 'NO_LINE') { this.alert = 'LINE_ERROR'; return; }
    this.addJournal(entry);
    yield* this.endOf(entry);
  }

  // ---- an incoming call ---------------------------------------------------------------------------------------------

  *incoming(first) {
    const s = this.settings;
    let rings = first.count ?? 1;
    let cid = null;
    let ringerPattern = 'normal', lastRing = this.k.t;
    const ringer = (on) => this.devices.beeper?.ring?.(on, { volume: s.volume.ringer, ...(ringerPattern !== 'normal' ? { pattern: ringerPattern } : {}) });
    ringer(true);
    let mode = s.rxMode, faxRings = s.rings;
    // Duplex ringing: the long cadence is a fax, answered after two rings whatever the mode; the short, a voice call
    // [OM p.75]. (The switchboard's 'distinctive' cadence stands for the fax number's.)
    if (s.duplex) { if (first.pattern === 'distinctive') { mode = 'FAX'; faxRings = TIMING.duplexRings; } else mode = 'TEL'; }
    if (mode === 'TEL/FAX') faxRings = s.rings;          // the set rings, two at the factory [OM p.52, p.54]
    let shown = 0;
    try {
      for (;;) {
        // Caller ID: the name and the number in turn [OM p.71].
        this.show(cid ? ((shown++ % 2 && cid.name) ? cid.number : (cid.name || cid.number)) : msg('INCOMING'));
        const junk = cid && isJunk(s, cid.number);
        if (junk) {
          // With Caller ID on, a junk number's call is broken off as soon as its number arrives [OM p.74].
          ringer(false); this.devices.ncu.seize(true); yield* wait(0.5); this.devices.ncu.seize(false);
          this.addJournal({ kind: 'RX', dialled: '', remote: cid.name || cid.number, wallMs: this.wallMs(), pages: 0, mode: '', result: 'BLOCKED', durationS: 0 });
          return;
        }
        if (mode === 'FAX' && rings >= faxRings && this.state.paper && !this.state.cover) { ringer(false); return yield* this.receive({ how: 'auto' }); }
        if (mode === 'TEL/FAX' && rings >= faxRings) { ringer(false); return yield* this.telFax(); }
        if (mode === 'A.M.' && s.amFailsFax && rings >= TIMING.amFallbackRings && this.state.paper) { ringer(false); return yield* this.receive({ how: 'auto' }); }
        const e = yield* this.ev((x) => x.dev === 'ncu' && ['ring', 'callerId', 'handset', 'ext'].includes(x.ev), cid ? 1.5 : TIMING.ringGapS);
        if (e.ev === 'timeout') { if (cid && this.k.t - lastRing < TIMING.ringGapS) continue; return; }    // the caller gave up
        if (e.ev === 'ring') { ringer(e.on); if (e.on) { rings = e.count ?? rings + 1; lastRing = this.k.t; } }
        else if (e.ev === 'callerId') {
          if (s.callerId) {
            cid = e;
            s.callers.push({ number: e.number, name: e.name ?? '', wallMs: this.wallMs() });
            if (s.callers.length > 20) s.callers.splice(0, s.callers.length - 20);     // the most recent 20 [OM p.72]
            this.save();
            // A priority call rings with its own sound [OM p.73].
            if (s.priority && digitsOf(s.priority).replace(/-/g, '').slice(-7) === digitsOf(e.number).replace(/-/g, '').slice(-7)) {
              ringerPattern = 'priority';
            }
          }
        }
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

  /** TEL/FAX: answer, listen about five seconds for CNG, then pseudo-ring for 30 s; no pickup in time: send the fax
   * tone and receive [OM p.52]. */
  *telFax() {
    const n = this.devices.ncu;
    n.seize(true);
    this.watchCng();
    const accept = (x) => (x.dev === 'fw' && x.ev === 'cng') || (x.dev === 'ncu' && (x.ev === 'released' || (x.ev === 'handset' && x.off)));
    let e = yield* this.ev(accept, TIMING.cngWindowS);
    if (e.ev === 'timeout') {
      this.show(msg('PICK_UP'));
      this.devices.beeper?.ring?.(true, { volume: Math.max(1, this.settings.volume.ringer), pattern: 'pseudo' });
      try { e = yield* this.ev(accept, this.sw.pseudoRingS); }   // 30 s [OM p.52; SM SW-E1]
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
  *telephone(via, { answered = false, dial: first = null } = {}) {
    const n = this.devices.ncu;
    let speaker = via === 'speaker';
    let dialled = '';
    let hold = false;
    if (speaker) { n.seize(true); n.monitor?.(this.settings.volume.speaker); }
    const dial = (digits) => { dialled += digits; this.cmd('ncu', 'dial', { digits, mode: this.settings.dialMode }); };
    if (first) { this.lastNumber = first; dial(digitsOf(first)); }
    // A call answered by the handset: a fax tone heard starts the reception by itself (FAX SIGNAL RX) [OM p.55, p.58].
    if (answered && this.settings.faxSignalRx) this.watchCng();
    try {
      for (;;) {
        this.show(hold ? msg('HOLD') : dialled ? lcdText(dialled, 'right') : msg(speaker ? 'ON_HOOK_DIAL' : 'TELEPHONE'));
        const e = yield* this.ev((x) => isKey(x) || (x.dev === 'ncu' && (x.ev === 'handset' || x.ev === 'released')) || (answered && x.dev === 'fw' && x.ev === 'cng'), null, { stop: true });
        if (e.dev === 'fw') { yield* this.receive({ how: 'manual', manual: true }); return; }
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
        // E/POLL after dialling by hand: POLLING, and the handset can be replaced [OM p.80].
        if (k === 'E' && this.settings.pollingKey && !this.state.docLoaded) { yield* this.receive({ how: 'manual', manual: true, pollManual: true }); return; }
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
          const p = yield* this.io('printer', 'print', { rows: buf, count: block.length, vres, contrast: 'NORMAL' });
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
    if (pages) { this.beep('end'); yield* this.flash(`${msg('TOTAL_PAGES')} ${p2(pages)}`, TIMING.resultS); }
  }

  /**
   * Print a report or list: 'transaction' (after a transaction, by the TRANSACTION LIST setting; it cannot be printed on
   * demand [OM p.50]), 'tel' (the Telephone Number List), 'junk' (the Anti Junk Number List) [OM p.81], 'help' [OM p.9].
   */
  *printList(kind, entry = null) {
    const now = this.wallMs();
    let page;
    if (kind === 'transaction') page = transactionReport(entry, this.settings, { now });
    else if (kind === 'tel') page = telephoneList(this.settings, { now });
    else if (kind === 'junk') page = junkList(this.settings, { now });
    else page = helpList(this.settings, { now });
    yield* this.printPage(page, kind);
  }

  *printPage(page, kind = 'page') {
    const err = this.printerReady();
    if (err) { this.beep('error'); return false; }
    this.show(msg('PRINTING'));
    const r = yield* this.io('printer', 'print', { rows: page.rows, count: page.height, vres: page.vres, contrast: 'NORMAL' });
    if (r.ok) yield* this.io('cutter', 'cut');
    this.log.push({ t: this.k.t, what: 'print', kind, ok: r.ok, rows: page.height });
    return r.ok;
  }
}
