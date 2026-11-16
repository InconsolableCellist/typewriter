// Analytic devices for Node tests (as src/wp/devices/virtual.js is for the Displaywriter): the device interface of
// devices.md, answered on the firmware's own clock with completion times from simple timing models [A], and the
// telephone line through the call-level exchange (src/fax/remote/switchboard.js) to the card index's parties.
// No mechanism: sheets are page bitmaps, the roll is a length, the printed output is a list of page bitmaps.
//
// What a person does to the machine is a method here: insertDocument, liftHandset, replaceHandset, openCover,
// closeCover, loadPaper, emptyPaper, unplugLine.

import { Switchboard } from '../remote/switchboard.js';
import { Directory } from '../remote/directory.js';
import { STRIDE, LINES_PER_MM } from './page.js';

/** Timing models [A]. */
export const VIRTUAL_TIMING = Object.freeze({
  loadS: 1.0,              // a sheet drawn from the tray to the read line
  ejectS: 0.6,             // the rest of a sheet fed out
  printMmPerS: 20,         // the thermal printer's paper speed
  cutS: 0.8,               // the cutter's cycle
  dtmfDigitS: 0.2,         // 100 ms tone + 100 ms gap
  pulseDigitS: 1.0,        // 10 pps plus the interdigit pause, about
});

export class VirtualDevices {
  /**
   * paperMm: thermal paper left on the roll (10 m starter roll [S] by default); transport: 'ideal' | 'audio';
   * directory: a Directory (made on attach when not given); wallMs: the remote world's wall clock.
   */
  constructor({ paperMm = 10000, transport = 'ideal', directory = null, ownNumber = '5550100', lineConnected = true } = {}) {
    this.fw = null;
    this.paperMm = paperMm;
    this.transport = transport;
    this.directory = directory;
    this.ownNumber = ownNumber;
    this.lineConnected = lineConnected;
    this.tray = [];              // sheets waiting: { rows, height, vres, jam }
    this.loaded = null;          // the sheet at the read line
    this.coverOpen = false;
    this.handsetOff = false;
    this.seized = false;
    this.holding = false;
    this.strip = [];             // rows printed since the last cut: [{ rows, count, vres }]
    this.output = [];            // cut sheets: { width, height, vres, rows }
    this.printerFree = 0;        // the printer and cutter share one mechanism: commands queue
    this.feederFree = 0;
    this.log = { lcd: [], beeps: [], rings: [], feeds: [], dials: [], monitor: [], scans: 0 };
    this._devices();
  }

  get now() { return this.fw ? this.fw.k.t : 0; }
  get clock() { return this.fw.k.clock; }

  attach(fw) {
    this.fw = fw;
    if (!this.directory) this.directory = new Directory({ clock: this.clock, wallMs: () => fw.wall0 + fw.k.t * 1000 });
    this.sb = new Switchboard({ clock: this.clock, directory: this.directory, ownNumber: this.ownNumber, transport: this.transport });
    this.directory.attach(this.sb);
    this.sb.attach({ event: (evt) => this.post(this.now, evt) });
  }

  post(t, evt) { this.clock.at(t, () => this.fw.deviceEvent(evt)); }
  done(dev, id, t, extra = {}) { this.post(t, { dev, ev: 'done', id, ok: true, ...extra }); }

  _loop() { this.sb?.loop(this.lineConnected && (this.seized || this.handsetOff || this.holding)); }

  _devices() {
    const self = this;
    const T = VIRTUAL_TIMING;
    this.feeder = {
      status: () => ({ docPresent: !!(self.loaded || self.tray.length), loaded: !!self.loaded, waiting: self.tray.length }),
      load({ id }) {
        const t = Math.max(self.now, self.feederFree) + T.loadS;
        self.feederFree = t;
        self.clock.at(t, () => {
          const s = self.tray.shift();
          if (!s) { self.fw.deviceEvent({ dev: 'feeder', ev: 'done', id, ok: false, error: 'empty' }); return; }
          if (s.jam) {
            self.fw.deviceEvent({ dev: 'feeder', ev: 'jam' });
            self.fw.deviceEvent({ dev: 'feeder', ev: 'done', id, ok: false, error: 'jam' });
            self.jammed = s;
            return;
          }
          self.loaded = s;
          self.fw.deviceEvent({ dev: 'feeder', ev: 'done', id, ok: true });
        });
      },
      feed({ id, lines, vres, seconds }) {
        self.log.feeds.push({ t: self.now, lines, vres, seconds });
        const t = Math.max(self.now, self.feederFree) + seconds;
        self.feederFree = t;
        self.done('feeder', id, t);
      },
      eject({ id }) {
        const t = Math.max(self.now, self.feederFree) + T.ejectS;
        self.feederFree = t;
        self.clock.at(t, () => {
          self.loaded = null;
          self.fw.deviceEvent({ dev: 'feeder', ev: 'done', id, ok: true });
          if (!self.tray.length) self.fw.deviceEvent({ dev: 'feeder', ev: 'doc', present: false });
        });
      },
    };
    this.scanner = {
      params: null,
      begin(p) { this.params = p; self.log.scans++; },
      readLine(k) {
        const s = self.loaded;
        if (!s) return null;
        const ratio = LINES_PER_MM[s.vres ?? 'fine'] / LINES_PER_MM[this.params?.vres ?? 'fine'];
        const y = Math.floor(k * ratio);
        if (y >= s.height) return null;
        return s.rows.slice(y * STRIDE, (y + 1) * STRIDE);
      },
      end() { this.params = null; },
    };
    this.printer = {
      status: () => ({ paper: self.paperMm > 0, coverOpen: self.coverOpen }),
      print({ id, rows, count, vres }) {
        const start = Math.max(self.now, self.printerFree);
        const mmPerLine = 1 / LINES_PER_MM[vres ?? 'fine'];
        let n = count, error = null;
        if (self.coverOpen) { n = 0; error = 'cover'; }
        else if (self.paperMm <= 0) { n = 0; error = 'paper'; }
        else if (count * mmPerLine > self.paperMm) { n = Math.floor(self.paperMm / mmPerLine); error = 'paper'; }
        self.paperMm = Math.max(0, self.paperMm - n * mmPerLine);
        if (n) self.strip.push({ rows: rows.slice(0, n * STRIDE), count: n, vres });
        const t = start + (n * mmPerLine) / T.printMmPerS + 0.05;
        self.printerFree = t;
        self.clock.at(t, () => {
          if (error === 'paper') self.fw.deviceEvent({ dev: 'printer', ev: 'paper', present: false });
          self.fw.deviceEvent({ dev: 'printer', ev: 'done', id, ok: !error, printed: n, error });
        });
      },
    };
    this.cutter = {
      cut({ id }) {
        const t = Math.max(self.now, self.printerFree) + T.cutS;
        self.printerFree = t;
        self.clock.at(t, () => { self._cutSheet(); self.fw.deviceEvent({ dev: 'cutter', ev: 'done', id, ok: true }); });
      },
    };
    this.ncu = {
      status: () => ({ handsetOff: self.handsetOff, seized: self.seized, line: self.lineConnected, extOffHook: false }),
      seize(on) { self.seized = !!on; self._loop(); },
      hold(on) { self.holding = !!on; self._loop(); },
      monitor(level) { self.log.monitor.push({ t: self.now, level }); },
      dial({ id, digits, mode = 'TONE' }) {
        const per = mode === 'PULSE' ? T.pulseDigitS : T.dtmfDigitS;
        self.log.dials.push({ t: self.now, digits, mode });
        let t = self.now;
        for (const d of String(digits)) { t += per; self.clock.at(t, () => self.sb.dialled(d)); }
        self.done('ncu', id, t + 0.01);
      },
    };
    this.line = {
      port: () => self.sb.port,
      trainingSeconds: (rate) => self.sb.port.trainingSeconds(rate),
    };
    this.lcd = { show: (text, { cursor } = {}) => { self.log.lcd.push({ t: self.now, text, cursor }); } };
    this.beeper = {
      beep: (kind) => { if (kind !== 'key') self.log.beeps.push({ t: self.now, kind }); },
      ring: (on, opts = {}) => { self.log.rings.push({ t: self.now, on, ...opts }); },
    };
    this.keys = { isDown: () => false };
  }

  _cutSheet() {
    if (!this.strip.length) return;
    const count = this.strip.reduce((s, x) => s + x.count, 0);
    const rows = new Uint8Array(count * STRIDE);
    let o = 0;
    for (const s of this.strip) { rows.set(s.rows, o); o += s.rows.length; }
    this.output.push({ width: 1728, height: count, vres: this.strip[0].vres, rows });
    this.strip = [];
  }

  // ---- what a person does ---------------------------------------------------------------------------------------------

  /** Lay sheets face down in the feeder: each { rows, height, vres } (or a page bitmap), `jam: true` to misfeed. */
  insertDocument(sheets) {
    const was = !!(this.loaded || this.tray.length);
    for (const s of [].concat(sheets)) this.tray.push({ ...s });
    if (!was) this.fw.deviceEvent({ dev: 'feeder', ev: 'doc', present: true });
  }

  /** Pull the document out (and a jammed sheet). */
  removeDocument() {
    this.tray = []; this.loaded = null; this.jammed = null;
    this.fw.deviceEvent({ dev: 'feeder', ev: 'doc', present: false });
  }

  liftHandset() { this.handsetOff = true; this._loop(); this.fw.deviceEvent({ dev: 'ncu', ev: 'handset', off: true }); }
  replaceHandset() { this.handsetOff = false; this._loop(); this.fw.deviceEvent({ dev: 'ncu', ev: 'handset', off: false }); }
  openCover() { this.coverOpen = true; this.fw.deviceEvent({ dev: 'printer', ev: 'cover', open: true }); }
  closeCover() { this.coverOpen = false; this.fw.deviceEvent({ dev: 'printer', ev: 'cover', open: false }); }
  loadPaper(mm = 30000) { this.paperMm = mm; this.fw.deviceEvent({ dev: 'printer', ev: 'paper', present: true }); }
  emptyPaper() { this.paperMm = 0; this.fw.deviceEvent({ dev: 'printer', ev: 'paper', present: false }); }
  unplugLine() { this.lineConnected = false; this._loop(); }
}
