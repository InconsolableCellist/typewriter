// FaxSim: the Sharp FO-70's mechanism host (docs/fax/architecture.md 3). It owns time, the hands, the bodies and their
// controllers, the snapshot and the events, behind the same interface as WordprocSim (src/sim/wp/index.js), so the
// LocalHost, the worklet (src/audio/worklet-fax.js) and Node tests drive it unchanged. The bodies follow the service
// manual's blocks: the drive unit (drive-mech.js), the scanner frame's document path (scanner-mech.js), the head frame
// unit with the platen, the roll and the cover (head-mech.js), the cutter (cutter-mech.js), the TEL/LIU board's relays
// and hook switch (liu-mech.js) and the operation panel's keys (panel-mech.js). Each controller reaches its body only
// through a frozen `io` of drive commands and sensor reads (tests/fax_mech.test.js proves it).
//
// Plug points for the other parts of the fax (architecture.md 4): attachThermal(model) for the thermal head and paper
// (src/fax/thermal/), scanLine() for the contact image sensor (src/fax/image/), and `ctl` for the firmware
// (src/fax/firmware/), which drives the controllers' methods directly in the worklet.
import { SUBSTEP_HZ } from '../rate.js';
import { Inputs } from '../common/inputs.js';
import { makeFaxLayout } from './layout.js';
import { FAX_PORT } from './ports.js';
import { DriveMech, SCAN, RECORD } from './drive-mech.js';
import { ScannerMech } from './scanner-mech.js';
import { HeadMech, defaultThermal } from './head-mech.js';
import { CutterMech } from './cutter-mech.js';
import { LiuMech, RELAYS } from './liu-mech.js';
import { PanelMech } from './panel-mech.js';
import { DriveCtl } from './drive-ctl.js';
import { ScanCtl } from './scan-ctl.js';
import { PrintCtl } from './print-ctl.js';
import { LiuCtl } from './liu-ctl.js';
import { PanelCtl } from './panel-ctl.js';

/** What the drive controller may touch: the motor's phase state and current. */
export function driveIO(drive) {
  return Object.freeze({ setMotor: (s, a) => drive.setMotor(s, a) });
}
/** What the document feed's controller may read: its two sensors. */
export function scanIO(scanner) {
  return Object.freeze({ docSensor: () => scanner.docSensor(), regSensor: () => scanner.regSensor() });
}
/** What the recorder's controller may touch: the head's strobe, the cutter motor, and its sensors. */
export function printIO(head, cutter) {
  return Object.freeze({
    strobe: (dots, energy) => head.strobe(dots, energy), setCutter: (v, closed) => cutter.setDrive(v, closed),
    cutterHome: () => cutter.home(), paperSensor: () => head.paperSensor(), coverClosed: () => head.coverClosed(),
  });
}
/** What the line interface's controller may touch: the relay coils and the hook switch. */
export function liuIO(liu) {
  return Object.freeze({ setRelay: (n, a) => liu.setRelay(n, a), hookOn: () => liu.hookOn() });
}
/** What the panel's controller may read: the key contacts. */
export function panelIO(panel) {
  return Object.freeze({ keyContact: (i) => panel.contact(i) });
}

export class FaxSim {
  /**
   * cold: no roll in the bay (the warm start has the part-used starter roll, decision 18), the handset on its
   * cradle either way. documents: sheets already on the document table ([{ id, length, width, skew, offset }]).
   */
  constructor({ machine, geometry, cold = false, documents = [] } = {}) {
    if (!machine || !geometry) throw new Error('FaxSim needs { machine, geometry }');
    this.kind = 'fax';
    this.m = machine; this.g = geometry;
    this.h = 1 / SUBSTEP_HZ; this.t = 0;
    this.layout = makeFaxLayout(machine);
    this.ports = new Float64Array(FAX_PORT.COUNT);
    this.acQ = new Float64Array(3 * 256); this.acN = 0;
    this.events = [];
    this.lastForce = 0;
    this.env = {};
    const M = machine.mech;
    this.inputs = new Inputs(this.h);
    this.drive = new DriveMech(this, M.drive);
    this.scanner = new ScannerMech(this, M.feeder);
    this.head = new HeadMech(this, M.printer, M.cover, { warm: !cold });
    this.cutter = new CutterMech(this, M.cutter, this.head);
    this.liu = new LiuMech(this, M.liu);
    this.panel = new PanelMech(this, M.panel);
    for (const b of [this.scanner, this.head, this.liu, this.panel]) b.registerDofs(this.inputs);
    if (documents.length) this.scanner.load(documents);
    const emit = (e) => this.emitEvent({ type: 'device', ...e });
    const driveCtl = new DriveCtl(M.drive, driveIO(this.drive), { dir: 1 });
    this.ctl = {
      drive: driveCtl,
      scan: new ScanCtl(M.feeder, M.drive.stepsPerLine, scanIO(this.scanner), driveCtl, (e) => emit(this.scanEvent(e))),
      print: new PrintCtl({ printer: M.printer, cutter: M.cutter, stepsPerLine: M.drive.stepsPerLine }, printIO(this.head, this.cutter), driveCtl, emit),
      liu: new LiuCtl(M.liu, liuIO(this.liu), emit),
      panel: new PanelCtl(M.panel, panelIO(this.panel), emit),
    };
    this.ctlList = Object.values(this.ctl);
    this.firmware = null;
  }

  /**
   * The machine's firmware (src/fax/firmware/; architecture.md 4.3): an object with nextT and service(t), run on the
   * host's clock after the controllers, and device(e), told of every device event as it happens. It reaches the
   * machine only through this.ctl's methods (scan.command, print.command, liu.command, panel events). Null detaches.
   */
  attachFirmware(fw) {
    if (this.firmware) this.ctlList = this.ctlList.filter((c) => c !== this.firmware);
    this.firmware = fw ?? null;
    if (fw) this.ctlList.push(fw);
  }

  /** A scanned line's event carries where the sensor's line fell on the document (scanner-mech.js scanLine). */
  scanEvent(e) { return e.ev === 'line' || e.ev === 'ready' ? { ...e, at: this.scanner.scanLine() } : e; }

  /** The thermal head and paper model (src/fax/thermal/; architecture.md 4.1), or null for the default mark rule. */
  attachThermal(model) { this.head.thermal = model ?? defaultThermal(this.m.mech.printer); }

  /** Where the contact image sensor's line falls on the document now, or null (architecture.md 4.2). */
  scanLine() { return this.scanner.scanLine(); }

  /** One substep: hands, then the controllers whose deadlines have come, then the bodies. */
  step() {
    const h = this.h;
    this.t += h;
    this.inputs.apply();
    const t = this.t;
    for (let i = 0; i < this.ctlList.length; i++) { const c = this.ctlList[i]; if (t >= c.nextT) c.service(t); }
    const d = this.drive, sc = this.scanner, hd = this.head;
    if (d.awake || sc.awake || hd.awake) {
      d.prepare();
      const nipScan = sc.awake || d.awake ? sc.step(h, d.trains[SCAN]) : 0;
      const nipRecord = hd.awake || d.awake ? hd.step(h, d.trains[RECORD]) : 0;
      if (sc.awake || hd.awake) d.wake();
      d.integrate(h, nipScan, nipRecord);
    }
    this.cutter.step(h);
    this.liu.step(h);
    this.panel.step(h);
  }

  /**
   * Commands from the kit and, until the firmware runs here (M6), from tests:
   *   { dev: 'feeder', op: 'load', sheets } | { dev: 'feeder', op: 'unload' }   sheets laid on or taken off the table
   *   { dev: 'scan', op: 'prefeed' | 'line' | 'eject', id, res }                 the document feed's controller
   *   { dev: 'print', op: 'line', id, dots, energy, res } | { op: 'feed', id, lines, res } | { op: 'cut', id }
   *   { dev: 'roll', op: 'load', length, used, coated } | { dev: 'roll', op: 'remove' }   a hand at the paper bay
   *   { dev: 'handset', op: 'lift' | 'replace' }
   *   { dev: 'liu', op: 'relay', name, on }
   *   { dev: 'panel', op: 'finger', key, force }                                  a finger on a key until changed
   */
  command(msg) {
    const t = this.t;
    switch (msg?.dev) {
      case 'feeder':
        if (msg.op === 'load') this.emitEvent({ type: 'device', dev: 'feeder', ev: 'loaded', taken: this.scanner.load(msg.sheets ?? []) });
        else if (msg.op === 'unload') this.scanner.unload();
        break;
      case 'scan': this.ctl.scan.command(msg, t); break;
      case 'print': this.ctl.print.command(msg, t); break;
      case 'roll': if (msg.op === 'load') this.head.loadRoll(msg); else if (msg.op === 'remove') this.head.removeRoll(); break;
      case 'handset': this.liu.setHandset(msg.op === 'replace'); break;
      case 'liu': this.ctl.liu.command(msg, t); break;
      case 'panel': if (msg.op === 'finger') this.panel.setFinger(msg.key, msg.force ?? 0); break;
    }
  }

  /** Exercise the hot paths once (the worklet runs this on a scratch instance): a line fed and printed, a key. */
  warmUp() {
    this.command({ dev: 'print', op: 'feed', lines: 1, res: 'fine' });
    this.command({ dev: 'panel', op: 'finger', key: 'start', force: 2 });
  }

  grab(dof, index, opts) { return this.inputs.grab(dof, index, opts); }
  moveGrab(id, target) { this.inputs.moveGrab(id, target); }
  release(id) { this.inputs.release(id); }

  setEnv(e) { Object.assign(this.env, e); }

  /** Update a parameter of the machine by dotted path, e.g. setParam('mech.printer.headForce', 4). */
  setParam(path, value) {
    const keys = path.split('.');
    let o = this.m;
    for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; if (o === undefined) return false; }
    o[keys[keys.length - 1]] = value;
    if (keys[1] === 'drive' && keys[2] === 'motor') this.drive.motor.setParams(this.m.mech.drive.motor);
    return true;
  }

  emitEvent(e) { this.events.push(e); if (this.firmware?.device && e.type === 'device') this.firmware.device(e, this.t); }
  /** Queue an acoustic event for the audio thread (no allocation). */
  ac(t, a, b, c = 0) {
    const n = this.acN;
    // Three numbers an event: time, kind * 64 + its index, and its magnitude.
    if (n < 256) { const q = this.acQ; q[n * 3] = t; q[n * 3 + 1] = a * 64 + b; q[n * 3 + 2] = c; this.acN = n + 1; }
  }
  drainEvents(out) { for (const e of this.events) out.push(e); this.events.length = 0; }

  writeSnapshot(s) {
    const L = this.layout, d = this.drive, sc = this.scanner, hd = this.head, cu = this.cutter, li = this.liu;
    s[L.time] = this.t; s[L.lastForce] = this.lastForce;
    s[L.motorTheta] = d.motor.th; s[L.motorOmega] = d.motor.w; s[L.planet] = d.phi;
    s[L.scanPsi] = d.trains[SCAN].psi; s[L.platenPsi] = d.trains[RECORD].psi;
    const first = sc.moving[0];
    s[L.sheetS] = first ? first.s : -1; s[L.sheetIndex] = sc.nOut; s[L.sheetsInTray] = sc.tray.length; s[L.sheetsOut] = sc.nOut;
    s[L.paperU] = hd.u; s[L.paperLead] = hd.lead; s[L.rollRadius] = hd.roll ? hd.rollRadius() : 0; s[L.rollRemaining] = hd.remaining();
    s[L.headDown] = hd.headDown() ? 1 : 0; s[L.cover] = hd.a;
    s[L.cutterCam] = cu.cam(); s[L.blade] = cu.blade();
    s[L.hookX] = li.hx; s[L.onCradle] = li.onCradle ? 1 : 0;
    for (let k = 0; k < RELAYS.length; k++) s[L.relays + k] = li.rel[k].x / li.rel[k].d.travel;
    s[L.docSensor] = sc.docSensor() ? 1 : 0; s[L.regSensor] = sc.regSensor() ? 1 : 0; s[L.paperSensor] = hd.paperSensor() ? 1 : 0;
    s[L.cutterHome] = cu.home() ? 1 : 0; s[L.coverClosed] = hd.coverClosed() ? 1 : 0; s[L.lineLoop] = li.lineLoop() ? 1 : 0;
    for (let i = 0; i < this.panel.n; i++) s[L.keyX + i] = this.panel.x[i];
  }

  exportState() {
    const ctl = {};
    for (const [k, c] of Object.entries(this.ctl)) ctl[k] = c.exportState();
    return {
      t: this.t, env: { ...this.env }, lastForce: this.lastForce,
      drive: this.drive.exportState(), scanner: this.scanner.exportState(), head: this.head.exportState(), cutter: this.cutter.exportState(),
      liu: this.liu.exportState(), panel: this.panel.exportState(), ctl,
    };
  }

  importState(s) {
    this.t = s.t; this.lastForce = s.lastForce;
    Object.assign(this.env, s.env);
    this.drive.importState(s.drive); this.scanner.importState(s.scanner); this.head.importState(s.head);
    this.cutter.importState(s.cutter); this.liu.importState(s.liu); this.panel.importState(s.panel);
    for (const [k, c] of Object.entries(this.ctl)) if (s.ctl[k]) c.importState(s.ctl[k]);
  }
}
