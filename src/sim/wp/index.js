// WordprocSim: the word processor's mechanism host (architecture.md 4). It owns time, hand inputs, the bodies and
// their controllers, the snapshot and the events, behind the same interface LocalHost and the worklet drive
// MechanicalSim through. Milestone M5 hosts the printer; the keyboard, station and diskette unit join it later.
import { SUBSTEP_HZ } from '../mechanics.js';
import { makeWpLayout } from './layout.js';
import { WP_PORT } from './ports.js';
import { Inputs } from './inputs.js';
import { PrinterMech } from './printer-mech.js';
import { PrinterCtl } from './printer-ctl.js';

/** What the printer's controller may touch: drive commands and sensor reads, nothing else. */
function printerIO(mech) {
  return Object.freeze({
    setCarrier: (s, a) => mech.setCarrier(s, a), setWheel: (k, a) => mech.setWheel(k, a),
    setIndex: (s, a) => mech.setIndex(s, a), setRibbon: (s, a) => mech.setRibbon(s, a),
    setHammer: (amps) => mech.setHammer(amps), setCam: (volts) => mech.setCam(volts),
    encoder: () => mech.encoder(), pickup: () => mech.pickup(), wheelSpeed: () => mech.wheelSpeed(), wheelHome: () => mech.wheelHome(),
    camReeds: () => mech.camReeds(), coverClosed: () => mech.coverClosed(), panelKey: (i) => mech.panelKey(i),
    powered: () => mech.powered(), ribbonLeft: () => mech.ribbonLeft(),
    paperAtSensor: () => mech.paperAtSensor(), paperPresent: () => mech.sim.env.paperPresent,
  });
}

export class WordprocSim {
  /** cold: the printer starts switched off and runs its power-on self-test when switched on (13.2 item 1). */
  constructor({ machine, geometry, glyphs, cold = false } = {}) {
    if (!machine || !geometry) throw new Error('WordprocSim needs { machine, geometry }');
    this.kind = 'wordproc';
    this.m = machine; this.g = geometry;
    this.h = 1 / SUBSTEP_HZ; this.t = 0;
    this.layout = makeWpLayout(geometry);
    this.ports = new Float64Array(WP_PORT.COUNT);
    this.acQ = new Float64Array(3 * 256); this.acN = 0;
    this.events = [];
    this.lastForce = 0;
    const P = machine.printer;
    this.env = { paperCaliperM: P.paper.thickness, ribbonCaliperM: P.ribbon.thickness, ribbonInGap: true, paperPresent: true, paperStrength: 1, paperEdgeV: -1 };
    this.inputs = new Inputs(this.h);
    this.printer = new PrinterMech(this, P, geometry.printer, glyphs);
    this.printer.registerDofs(this.inputs);
    if (cold) this.printer.power = 0;     // the rocker as the operator left it
    this.printerCtl = new PrinterCtl(P, printerIO(this.printer), (e) => this.emitEvent({ type: 'device', dev: 'printer', ...e }), { warm: !cold });
    this.printer.irq = this.printerCtl;
  }

  /** One substep: hands, then the controllers whose deadlines have come, then the bodies. */
  step() {
    const h = this.h;
    this.t += h;
    this.inputs.apply();
    const ctl = this.printerCtl;
    if (this.t >= ctl.nextT) ctl.service(this.t);
    this.printer.step(h);
  }

  /** Device commands from the software (7.6): { dev: 'printer', words: [16-bit commands] }. */
  command(msg) {
    if (msg?.dev === 'printer' && Array.isArray(msg.words)) this.printerCtl.command(msg.words, this.t);
  }

  /** Exercise the hot paths once (the worklet runs this on a scratch instance): one character from rest. */
  warmUp() { this.command({ dev: 'printer', words: [0x2000 | 24, 0x1000 | 1] }); }

  grab(dof, index, opts) { return this.inputs.grab(dof, index, opts); }
  moveGrab(id, target) { this.inputs.moveGrab(id, target); }
  release(id) { this.inputs.release(id); }

  setEnv(e) { Object.assign(this.env, e); }

  /** Update a parameter of the machine by dotted path, e.g. setParam('printer.hammer.forceConstant', 2). */
  setParam(path, value) {
    const keys = path.split('.');
    let o = this.m;
    for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; if (o === undefined) return false; }
    o[keys[keys.length - 1]] = value;
    if (keys[0] === 'printer') this.printer.derive(keys[1] === 'slug' || keys[1] === 'platen');
    return true;
  }

  carriageX() { return this.printer.carriageX(); }

  emitEvent(e) { this.events.push(e); }
  /** Queue an acoustic event for the audio thread (no allocation). */
  ac(t, a, b) { const n = this.acN; if (n < 256) { const q = this.acQ; q[n * 3] = t; q[n * 3 + 1] = a; q[n * 3 + 2] = b; this.acN = n + 1; } }
  drainEvents(out) {
    this.printerCtl.flush();
    for (const e of this.events) out.push(e);
    this.events.length = 0;
  }

  writeSnapshot(s) {
    const L = this.layout, p = this.printer, c = this.printerCtl;
    s[L.time] = this.t; s[L.lastForce] = this.lastForce;
    s[L.carriageX] = p.carriageX(); s[L.carriageV] = -p.vc;
    s[L.platenPsi] = p.psi; s[L.platenOmega] = p.psiV; s[L.shiftY] = 0;
    s[L.vibratorLift] = p.lift; s[L.ribbonPawlTravel] = p.ribbonFed(); s[L.ribbonSelector] = 0;
    s[L.paperRelease] = p.rel; s[L.bail] = p.bail;
    s[L.printerPower] = p.power; s[L.cover] = p.cover;
    s[L.wheelTheta] = p.sel.th; s[L.wheelOmega] = p.sel.w; s[L.hammerX] = p.xa; s[L.cam] = p.camTh / this.m.printer.cam.ratio;
    for (let i = 0; i < p.kx.length; i++) s[L.panelKeyX + i] = p.kx[i];
    s[L.leds] = c.leds; s[L.digits] = typeof c.err === 'number' ? c.err : 0; s[L.fifo] = c.fifo.length; s[L.printerFan] = p.fan;
  }

  exportState() {
    return { t: this.t, env: { ...this.env }, lastForce: this.lastForce, printer: this.printer.exportState(), printerCtl: this.printerCtl.exportState() };
  }

  importState(s) {
    this.t = s.t; this.lastForce = s.lastForce;
    Object.assign(this.env, s.env);
    this.printer.importState(s.printer);
    this.printerCtl.importState(s.printerCtl);
  }
}
