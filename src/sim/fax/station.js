// The FO-70 as a working machine: the mechanism host (FaxSim) with its firmware (src/fax/firmware/, through the
// adapter sim-devices.js), the contact image sensor over the sheets laid in the feeder, the thermal head and paper on
// the head, and the telephone line: the in-browser exchange of the card index (src/fax/remote/) carrying each call as
// real modem audio over a line model (AudioLink). docs/fax/architecture.md 4 and 5; plan 7.2.
//
// Threads (plan 7.2): all of this runs wherever the host runs, on one clock, the mechanism's substeps. Before the
// first gesture and with ?localsim that is the page (LocalHost); after it, the fax's AudioWorklet, where the engine
// (src/audio/fax-engine.js) steps the host at the audio rate and reads the line's audio from `tap` at the same time,
// so the monitor speaker and the earpiece are never ahead of or behind the call, and nothing is streamed between
// threads. What crosses: the page images, once, when a sheet is laid (a command); a sheet's raw CIS lines read ahead
// by the kit's worker (a command; sheet-scan.js says why); and out, with the snapshots, the device events: each
// printed line's darkness, cuts, the LCD's text, beeps and rings, and the settings to store.
//
// The firmware's generator tasks cannot be carried across the handover to the audio thread, so the station exports
// its settings, journal and page images, and the audio thread boots the firmware afresh on the imported mechanism
// (the handover is at the first gesture, when the machine is standing by). Worklet rules hold: no structuredClone,
// setTimeout or DOM anywhere here.
import { FaxSim } from './index.js';
import { LineTap } from './line-tap.js';
import { attachToSim } from '../../fax/firmware/sim-devices.js';
import { STORAGE_KEY, JOURNAL_KEY } from '../../fax/firmware/setup.js';
import { Switchboard } from '../../fax/remote/switchboard.js';
import { Directory, deskProgramming } from '../../fax/remote/directory.js';
import { SheetScanner } from '../../fax/image/sheet-scan.js';
import { ThermalHead, HEAD_CAL } from '../../fax/thermal/head.js';
import { ThermalPaper } from '../../fax/thermal/paper.js';

const KEY_TAP_S = 0.09;              // a click on a key holds it this long [A]
const CUT_MARGIN = 0.002;            // paper fed past the cutter after the last line before a cut [A]

/** The switchboard, with the call's audio handed to the tap block by block and its signals told to it. */
class TappedSwitchboard extends Switchboard {
  constructor(opts, tap) { super(opts); this.tap = tap; }
  _emit(evt) { this.tap.progress(evt, this.clock.now()); super._emit(evt); }
  loop(closed) { if (!closed) this.tap.hangup(); super.loop(closed); }
  _pumpAudio() {
    const link = this.link;
    const step = () => {
      if (this.link !== link) return;
      const n = link.n;
      link.step();
      this.tap.block(n, link.aTx, link.aRx, link.block);
      this.pumpTimer = this.clock.at(link.n / link.rate, step);
    };
    this.tap.signal = null;
    this.pumpTimer = this.clock.at(link.n / link.rate, step);
  }
}

/** The thermal head and paper (src/fax/thermal/) as the head mechanism's model (architecture.md 4.1). */
export function thermalModel(head = new ThermalHead({ paper: new ThermalPaper() })) {
  const P = (HEAD_CAL.Vs * HEAD_CAL.Vs) / HEAD_CAL.R;
  const row = new Uint8Array(216);
  let lastT = -1, lastC = 0;
  return {
    head,
    printLine({ dots, energy, coated, coord, t }) {
      const out = new Uint8Array(dots.length);
      const gap = lastT < 0 ? 1 : t - lastT;
      // The head stands between lines. Its phases are exact matrix exponentials, which overflow past a fraction of a
      // second, so a long pause is stepped in short pieces; after a second the dots are at the substrate's temperature.
      if (gap > 0.15) for (let s = 0; s < Math.min(gap, 1); s += 0.1) head.idle(0.1);
      const pitchMm = lastT < 0 ? 1 / 7.7 : Math.min(1, Math.max(0.03, (coord - lastC) * 1000));
      lastT = t; lastC = coord;
      if (!coated) return out;
      row.fill(0);
      for (let i = 0; i < dots.length; i++) if (dots[i]) row[i >>> 3] |= 0x80 >>> (i & 7);
      const e = typeof energy === 'number' ? energy : energy[0];
      const r = head.printLine(row, { strobeMs: (e / P) * 1000, periodMs: Math.min(150, Math.max(5, gap * 1000)), pitchMm });
      for (let i = 0; i < out.length; i++) out[i] = Math.round(r.density[i] * 255);
      return out;
    },
  };
}

export class FaxStation extends FaxSim {
  /**
   * machine, geometry, cold (FaxSim's), storage ({ [key]: value } as last saved), wallBase (local wall-clock ms at
   * host time 0; default now, with the time-zone offset folded in, decision 12), transport ('audio' by default:
   * real modem audio; 'ideal' for quick tests).
   */
  constructor({ storage = null, wallBase = null, transport = 'audio', ...o } = {}) {
    super(o);
    this.cold = !!o.cold;
    this.transport = transport;
    this.wallBase = wallBase ?? (Date.now() - new Date().getTimezoneOffset() * 60000);
    this.images = new Map();            // sheet id -> page image (src/fax/image/pages.js form)
    this.scanner2 = new SheetScanner();
    this.thermal = thermalModel();
    this.attachThermal(this.thermal);
    this.tap = new LineTap();
    this.taps = [];                     // key releases due: { t, key }
    this.store = { ...(storage ?? {}) };
    this.boot();
  }

  /** Make the firmware, its devices and the exchange, on the host's present time. */
  boot() {
    const self = this;
    const storage = {
      load: (k) => (k in self.store ? JSON.parse(JSON.stringify(self.store[k])) : null),
      save: (k, v) => { self.store[k] = JSON.parse(JSON.stringify(v)); self.emitEvent({ type: 'device', dev: 'store', key: k, value: self.store[k] }); },
    };
    const lcd = { show: (text, { cursor = null } = {}) => this.emitEvent({ type: 'device', dev: 'lcd', text, cursor }) };
    const beeper = {
      beep: (kind) => { this.tap.beep(kind, this.t); },
      ring: (on, opts = {}) => { this.tap.setRinger(on, opts, this.t); this.emitEvent({ type: 'device', dev: 'ringer', on: !!on }); },
    };
    const stored = STORAGE_KEY in this.store;
    const { fw, devices } = attachToSim(this, {
      storage, lcd, beeper,
      sampleLine: (pose, res) => this.scanner2.line(this.images.get(pose.id) ?? null, pose, res),
      options: { wallClockMs: this.wallBase + this.t * 1000, cold: this.cold && !stored, desk: deskProgramming() },
    });
    this.fw = fw; this.devices = devices;
    // The adapter's scanner starts the video stage's page; the monitor speaker and the dialler's digits reach the tap.
    const sc = devices.scanner, begin = sc.begin.bind(sc);
    sc.begin = (p) => { begin(p); this.scanner2.begin(p); };
    const ncu = devices.ncu, dial = ncu.dial.bind(ncu);
    ncu.dial = (a) => { this.tap.dial(a.digits, fw.k.t, a.mode); dial(a); };
    ncu.monitor = (level) => { this.tap.monitor = level | 0; };
    // The cutter cuts after the last line: the strip is fed until that line has passed the blade.
    const cut = devices.cutter.cut.bind(devices.cutter);
    const P = this.m.mech.printer, spl = this.m.mech.drive.stepsPerLine;
    const steps = Math.round((P.cutterAt + CUT_MARGIN) * 1000 * 7.7 * spl.fine);
    devices.cutter.cut = (a) => { this.ctl.print.command({ op: 'feed', steps }, this.t); cut(a); };
    const dir = new Directory({ clock: fw.clock, wallMs: () => fw.wall0 + fw.k.t * 1000 });
    const sb = new TappedSwitchboard({ clock: fw.clock, directory: dir, ownNumber: '5550100', transport: this.transport }, this.tap);
    dir.attach(sb);
    devices.setLine(sb);
    this.directory = dir; this.sb = sb;
  }

  step() {
    super.step();
    if (this.taps.length && this.t >= this.taps[0].t) this.panel.setFinger(this.taps.shift().key, 0);
  }

  /**
   * FaxSim's commands, and:
   *   { dev: 'doc', op: 'place', sheets: [{ id, page, skew, offset, faceDown }] }   sheets laid in the feeder with images
   *   { dev: 'doc', op: 'raw', id, res, y0, raw }                                      a sheet's CIS lines read ahead
   *   { dev: 'panel', op: 'tap', key }                                                 a click on a key
   *   { dev: 'lcd', op: 'refresh' }                                                    the LCD's text again, as an event
   */
  command(msg) {
    if (msg?.dev === 'lcd') { this.emitEvent({ type: 'device', dev: 'lcd', text: this.fw.lcd.text, cursor: null }); return; }
    if (msg?.dev === 'doc') {
      if (msg.op === 'place') {
        const sheets = (msg.sheets ?? []).map((s) => {
          if (s.page) this.images.set(s.id, s.page);
          const p = s.page ?? this.images.get(s.id);
          return { id: s.id, length: p ? p.heightMm / 1000 : undefined, width: p ? p.widthMm / 1000 : undefined, skew: s.skew ?? 0, offset: s.offset ?? 0, faceDown: s.faceDown !== false };
        });
        this.emitEvent({ type: 'device', dev: 'feeder', ev: 'loaded', taken: this.scanner.load(sheets) });
      } else if (msg.op === 'raw') this.scanner2.addRaw(msg.id, msg.res, msg.y0, msg.raw);
      return;
    }
    if (msg?.dev === 'panel' && msg.op === 'tap') {
      this.panel.setFinger(msg.key, msg.force ?? 2);
      this.taps.push({ t: this.t + KEY_TAP_S, key: msg.key });
      return;
    }
    if (msg?.dev === 'feeder' && msg.op === 'unload') for (const s of this.scanner.tray) { this.images.delete(s.id); this.scanner2.forget(s.id); }
    super.command(msg);
  }

  /** The sheet image of a sheet that has gone out of the feeder is no longer needed. */
  emitEvent(e) {
    if (e.dev === 'feeder' && e.ev === 'out') { this.images.delete(e.id); this.scanner2.forget(e.id); }
    super.emitEvent(e);
  }

  warmUp() {
    super.warmUp();
    this.thermal.printLine({ dots: new Uint8Array(1728).fill(1), energy: 3e-4, coated: true, coord: 0, t: 0 });
  }

  exportState() {
    const s = super.exportState();
    s.station = { store: JSON.parse(JSON.stringify(this.store)), images: [...this.images.entries()], wallBase: this.wallBase, cold: this.cold, transport: this.transport };
    return s;
  }

  importState(s) {
    super.importState(s);
    const st = s.station;
    if (!st) return;
    this.store = JSON.parse(JSON.stringify(st.store ?? {}));
    this.images = new Map(st.images ?? []);
    this.wallBase = st.wallBase ?? this.wallBase;
    this.cold = !!st.cold; this.transport = st.transport ?? this.transport;
    this.attachFirmware(null);
    this.boot();
  }
}

export { JOURNAL_KEY, STORAGE_KEY };
