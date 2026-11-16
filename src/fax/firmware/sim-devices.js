// The firmware's devices (devices.md) mapped onto the mechanism host, FaxSim (src/sim/fax/; docs/fax/architecture.md
// 4.3): a thin adapter, so the same firmware runs on VirtualDevices in Node tests and on the modelled machine.
//
//   attachToSim(sim, opts) -> { fw, devices }   makes the firmware and attaches it with sim.attachFirmware(hook)
//
// The hook is { nextT, service(t), device(e, t) }. Device events are queued in device() and acted on at the next
// service() (the next substep): a controller emits from inside its own bookkeeping, and a command issued from there
// would start before it has finished. The firmware's clock is the host's: service(t) advances it to t.
//
// Mapping (firmware device -> host):
//   feeder.load / feed / eject   -> ctl.scan prefeed / `lines` x line / eject; replies scan ready | line | ejected | error
//   scanner.readLine(k)          -> the sheet's pose at `ready` (sim.scanLine(), carried as `at`), advanced k line
//                                   pitches, handed to opts.sampleLine(pose, res, params) (the kit's image and CIS
//                                   model); with no sampler the sheet reads white
//   printer.print                -> one ctl.print line a row (dots unpacked, energy per dot); replies print line | error
//   cutter.cut                   -> ctl.print cut; reply print cut | error cutterJam
//   ncu.seize / hold             -> ctl.liu relay cml; the loop the line sees is sim.liu.lineLoop(), polled
//   ncu.dial, progress, ring ... -> opts.line: a call-level line (src/fax/remote/switchboard.js's Switchboard, or the
//                                   same interface over the sample exchange): attach(sub), loop(closed), dialled(d),
//                                   port. With none the line cord is out (status().line false)
//   keys                         <- panel key events, the host's key names mapped to panel.js's
//   lcd, beeper                  -> opts.lcd.show / opts.beeper (the kit draws fw.lcd.text otherwise)
//   unsolicited                  <- scan document, print paper / cover, liu hook

import { createFirmware } from './main.js';
import { MemoryStorage } from './setup.js';
import { LINES_PER_MM, STRIDE } from './page.js';

/** The host's key names (machine.mech.panel.keys) to the firmware's. VOLUME ▲ and ▼ both step the volume [A]. */
export const SIM_KEYS = Object.freeze({
  rapid1: 'A', rapid2: 'B', rapid3: 'C', rapid4: 'D', rapid5: 'E',
  speedDial: 'SPEED_DIAL', redial: 'REDIAL', holdSearch: 'HOLD_SEARCH', speaker: 'SPEAKER', resolution: 'RESOLUTION',
  function: 'FUNCTION', volume: 'VOLUME', copyHelp: 'COPY_HELP', start: 'START', stop: 'STOP',
});
const keyName = (k) => SIM_KEYS[k] ?? (/^[0-9*#]$/.test(k) ? k : null);

const LINE_POLL_S = 0.01;
const IDLE_POLL_S = 0.05;
const DIGIT_S = { TONE: 0.2, PULSE: 1.0 };

export class SimDevices {
  /**
   * sim: a FaxSim; opts: line (a call-level line, above), sampleLine(pose, res, params) -> Uint8Array(216) | null,
   * lcd { show }, beeper { beep, ring }, energy (J a dot; default 1.2 x the definition's mark energy),
   * sheetsWaiting() (default: a read of the feeder's table).
   */
  constructor(sim, { line = null, sampleLine = null, lcd = null, beeper = null, energy = null, sheetsWaiting = null } = {}) {
    this.sim = sim;
    this.fw = null;
    this.lineSide = line;
    this.sampleLine = sampleLine;
    this.t = sim.t;
    this.pending = [];
    this.jobs = new Map();          // host op id -> { dev, kind, fwId, need, got, done }
    this.seq = 0;
    this.pose = null;               // the sheet at the read line, as `ready` reported it
    this.fedM = 0;                  // how far it has been fed since (m)
    this.res = 'standard';
    this.loopShown = null;
    this.relays = { cml: false, hold: false };
    this.markEnergy = sim.m?.mech?.printer?.markEnergy ?? 0.25e-3;
    this.energy = energy;
    this.sheetsWaiting = sheetsWaiting ?? (() => {
      const sc = sim.scanner;
      return sc ? sc.tray.length + Math.max(0, sc.moving.length - (this.pose ? 1 : 0)) : 0;
    });
    const pc = sim.ctl.print;
    this.state = { doc: !!sim.ctl.scan.present, paper: pc.paper !== false, cover: pc.cover === false, handset: !!sim.ctl.liu.offHook };
    this.hook = { nextT: Infinity, service: (t) => this.service(t), device: (e, t) => this.device(e, t) };
    this._build(lcd, beeper);
  }

  attach(fw) {
    this.fw = fw;
    this.setLine(this.lineSide);
  }

  /** Join a call-level line (made after the firmware, since it runs on the firmware's clock: fw.clock). */
  setLine(line) {
    this.lineSide = line;
    this.loopShown = null;
    line?.attach({ event: (evt) => { this.pending.push({ fwEvent: evt }); this._wake(this.t); } });
  }

  // ---- the hook ---------------------------------------------------------------------------------------------------

  device(e, t) {
    if (e.dev === 'print' && e.darkness) return;            // the head's line for the kit, not a reply
    this.pending.push(e);
    this._wake(t);
  }

  service(t) {
    this.t = t;
    this.fw.advance(t);
    const q = this.pending; this.pending = [];
    for (const e of q) this._translate(e);
    if (this.lineSide) {
      const loop = !!this.sim.liu.lineLoop();
      if (loop !== this.loopShown) { this.loopShown = loop; this.lineSide.loop(loop); }
    }
    this._next();
  }

  _wake(t) { if (t < this.hook.nextT) this.hook.nextT = t; }

  _next() {
    const timers = this.fw.k.timers;
    let n = timers.length ? timers[0].t : Infinity;
    if (this.pending.length) n = this.t;
    // A light poll: the line's loop, and anything the kit handed the firmware directly (fw.keyDown).
    n = Math.min(n, this.t + (this.lineSide ? LINE_POLL_S : IDLE_POLL_S));
    this.hook.nextT = n;
  }

  _post(evt) { this.fw.deviceEvent(evt); }

  _job(dev, kind, fwId, need = 1, extra = {}) {
    const id = `fw${++this.seq}`;
    this.jobs.set(id, { dev, kind, fwId, need, got: 0, done: false, ...extra });
    return id;
  }

  _finish(id, job, reply) {
    job.done = true;
    this.jobs.delete(id);
    this._post({ dev: job.dev, ev: 'done', id: job.fwId, ...reply });
  }

  _translate(e) {
    if (e.fwEvent) { this._post(e.fwEvent); return; }
    const s = this.state;
    if (e.dev === 'scan' && e.ev === 'document') { s.doc = e.present; this._post({ dev: 'feeder', ev: 'doc', present: e.present }); return; }
    if (e.dev === 'print' && e.ev === 'paper') { s.paper = e.present; this._post({ dev: 'printer', ev: 'paper', present: e.present }); return; }
    if (e.dev === 'print' && e.ev === 'cover') { s.cover = !e.closed; this._post({ dev: 'printer', ev: 'cover', open: !e.closed }); return; }
    if (e.dev === 'liu' && e.ev === 'hook') { s.handset = e.offHook; this._post({ dev: 'ncu', ev: 'handset', off: e.offHook }); return; }
    if (e.dev === 'panel' && e.ev === 'key') { const k = keyName(e.key); if (k && e.down) this._post({ dev: 'keys', ev: 'down', key: k }); return; }
    const job = e.id != null ? this.jobs.get(e.id) : null;
    if (!job || job.done) return;
    if (e.ev === 'error') {
      if (job.kind === 'load') {
        if (e.error === 'misfeed') this._post({ dev: 'feeder', ev: 'jam' });
        this._finish(e.id, job, { ok: false, error: e.error === 'misfeed' ? 'jam' : 'empty' });
      } else if (job.kind === 'eject') { this._post({ dev: 'feeder', ev: 'jam' }); this._finish(e.id, job, { ok: false, error: 'jam' }); }
      else if (job.kind === 'print') this._finish(e.id, job, { ok: false, error: e.error === 'coverOpen' ? 'cover' : 'paper', printed: job.got });
      else if (job.kind === 'cut') this._finish(e.id, job, { ok: false, error: 'jam' });
      else this._finish(e.id, job, { ok: false, error: e.error });
      return;
    }
    if (job.kind === 'load' && e.ev === 'ready') { this.pose = e.at ?? this.sim.scanLine?.() ?? null; this.fedM = 0; this._finish(e.id, job, { ok: true }); return; }
    if (job.kind === 'eject' && e.ev === 'ejected') {
      this.pose = null;
      this._finish(e.id, job, { ok: true });
      if (!this.state.doc && !this.sheetsWaiting()) this._post({ dev: 'feeder', ev: 'doc', present: false });
      return;
    }
    if ((job.kind === 'feed' && e.ev === 'line') || (job.kind === 'print' && e.ev === 'line')) {
      if (++job.got >= job.need) this._finish(e.id, job, { ok: true, printed: job.got });
      return;
    }
    if (job.kind === 'cut' && e.ev === 'cut') this._finish(e.id, job, { ok: true });
  }

  // ---- the devices ---------------------------------------------------------------------------------------------------

  _build(lcd, beeper) {
    const self = this, sim = this.sim;
    const scan = (m) => sim.ctl.scan.command(m, self.t);
    const print = (m) => sim.ctl.print.command(m, self.t);
    this.feeder = {
      status: () => ({ docPresent: self.state.doc || !!self.pose, loaded: !!self.pose, waiting: self.sheetsWaiting() }),
      load({ id }) { scan({ op: 'prefeed', id: self._job('feeder', 'load', id) }); },
      feed({ id, lines, vres }) {
        if (!lines) { self._post({ dev: 'feeder', ev: 'done', id, ok: true }); return; }
        self.fedM += (lines * 1e-3) / LINES_PER_MM[vres ?? 'standard'];
        const hid = self._job('feeder', 'feed', id, lines);
        for (let i = 0; i < lines; i++) scan({ op: 'line', id: hid, res: vres ?? 'standard' });
      },
      // What the firmware knows from the lines it fed: where the sheet's tail is. Once it is past the registration
      // sensor, that sensor may already see the next sheet close behind, so the sheet is run out by count.
      eject({ id }) {
        const P = sim.m?.mech?.feeder?.path, adv = sim.m?.mech?.drive?.advancePerStep;
        const pose = self.pose;
        let steps = null;
        if (P && adv && pose?.length != null) {
          const tail = P.readLine + pose.y + self.fedM - pose.length;
          if (tail > P.regSensor + 0.001) steps = Math.max(0, Math.ceil((P.feed - tail + 0.004) / adv));
        }
        scan({ op: 'eject', id: self._job('feeder', 'eject', id), steps });
      },
    };
    this.scanner = {
      params: null,
      begin(p) { this.params = p; self.res = p.vres ?? 'standard'; },
      readLine(k) {
        const pose = self.pose;
        if (!pose) return null;
        const y = pose.y + (k * 1e-3) / LINES_PER_MM[self.res];
        if (pose.length != null && y > pose.length) return null;
        const row = self.sampleLine?.({ ...pose, y }, self.res, this.params);
        return row ?? new Uint8Array(STRIDE);
      },
      end() { this.params = null; },
    };
    this.printer = {
      status: () => ({ paper: self.state.paper, coverOpen: self.state.cover }),
      print({ id, rows, count, vres, contrast }) {
        if (!count) { self._post({ dev: 'printer', ev: 'done', id, ok: true, printed: 0 }); return; }
        const energy = self.energy ?? self.markEnergy * (contrast === 'DARK' ? 1.5 : 1.2);
        const hid = self._job('printer', 'print', id, count);
        for (let y = 0; y < count; y++) {
          const dots = new Uint8Array(1728);
          const o = y * STRIDE;
          for (let x = 0; x < 1728; x++) dots[x] = (rows[o + (x >>> 3)] >>> (7 - (x & 7))) & 1;
          print({ op: 'line', id: hid, dots, energy, res: vres ?? 'fine' });
        }
      },
    };
    this.cutter = { cut({ id }) { print({ op: 'cut', id: self._job('cutter', 'cut', id) }); } };
    const relay = () => sim.ctl.liu.command({ op: 'relay', name: 'cml', on: self.relays.cml || self.relays.hold });
    this.ncu = {
      status: () => ({ handsetOff: self.state.handset, seized: self.relays.cml, line: !!self.lineSide, extOffHook: false }),
      seize(on) { self.relays.cml = !!on; relay(); },
      hold(on) { self.relays.hold = !!on; relay(); },
      monitor() {},
      dial({ id, digits, mode = 'TONE' }) {
        const k = self.fw.k, per = DIGIT_S[mode] ?? DIGIT_S.TONE;
        let t = k.t;
        for (const d of String(digits)) { t += per; k.at(t, () => self.lineSide?.dialled(d)); }
        k.at(t + 0.01, () => self._post({ dev: 'ncu', ev: 'done', id, ok: true }));
      },
    };
    this.line = {
      port: () => self.lineSide?.port ?? DEAD_PORT,
      trainingSeconds: (rate) => self.lineSide?.port?.trainingSeconds?.(rate),
    };
    this.lcd = lcd ?? { show() {} };
    this.beeper = beeper ?? { beep() {}, ring() {} };
    this.keys = { isDown: () => false };
  }
}

const DEAD_PORT = { listen() {}, setHighSpeedRx() {}, sendV21: (b, t) => t + b.length / 300, sendTone: (_x, s, t) => t + s, sendHighSpeed: (r, b, t) => t + b.length / r };

/**
 * Make the firmware on a FaxSim and attach it. opts: storage, options (createFirmware's; t0 defaults to the host's
 * time), and SimDevices' options. Returns { fw, devices }.
 */
export function attachToSim(sim, { storage = new MemoryStorage(), options = {}, ...deviceOptions } = {}) {
  const devices = new SimDevices(sim, deviceOptions);
  const fw = createFirmware({ devices, storage, options: { t0: sim.t, ...options } });
  sim.attachFirmware(devices.hook);
  devices._next();
  return { fw, devices };
}
