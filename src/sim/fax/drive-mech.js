// The drive unit (cutter model): the one pulse motor, the planet (swing) gears on its pinion and the three gear trains
// it selects, to the document rollers, to the platen and to the cutter (docs/fax/architecture.md 3.1; docs/fax/
// hardware.md 4). The service manual settles the count: ONE motor, "TX/RX MOTOR", for both directions of work and the
// cutter, through planet levers A, B and C, a mode lever with its own planet, and a cam gear with a cam switch
// [S p.3-7/pdf41 fig. 5; p.4-2/pdf50; parts list p.6/pdf94]. It does not say which lever drives which train, nor how
// the cam is turned; this file and drive-ctl.js are the only places that hold our reading of it:
//
//   - the swing arm (planet levers A and B) follows the pinion by the friction spring on each planet's axle (the
//     manual's grease detail shows that spring [S fig. 5]) until it lands on a stop, where its planet meshes:
//     forward rotation drives the scanning train, reverse the recording side [A: the direction mapping];
//   - on the recording side the mode lever, positioned by the cam gear, lets either planet B into the platen's train
//     or planet C into the cutter gear [S: the parts; A: the rule];
//   - the cam gear is stepped by the mode lever's planet when the arm swings only part way toward the scanning side
//     and comes back (a "jog"); a full changeover does not touch it [A]. The cam switch is made while the cam is at
//     home, i.e. the platen selected [S: the switch exists, CNCSW/CSWI p.4-3/pdf51; A: its sense].
//
// A change of direction swings the arm across, which takes real motor rotation (lost motion) and lands with a clack.
// Nothing here decides which train is driven: the arm's angle and the cam do.
import { Stepper2Phase } from '../common/stepper.js';
import { FAX_PORT, FAC } from './ports.js';
import { drag } from './friction.js';

const SLEEP_FRAMES = 384;
const sat = (x, x0) => (x > x0 ? 1 : x < -x0 ? -1 : x / x0);
const deadzone = (x, b) => (x > b ? x - b : x < -b ? x + b : 0);
export const SCAN = 0, RECORD = 1, CUT = 2;

export class DriveMech {
  /** sim: the host; def: machine.mech.drive. The warm start leaves the planet in the scanning train (the last move). */
  constructor(sim, def) {
    this.sim = sim; this.def = def;
    if (def.layout !== 'single-planetary') throw new Error(`drive layout '${def.layout}' is not built`);
    this.motor = new Stepper2Phase(def.motor);
    this.phi = def.planet.travel; this.phiV = 0;
    this.trains = [def.scan, def.record, def.cut].map((d, k) => ({ d, k, psi: 0, w: 0, mesh: k === SCAN, m0: 0, p0: 0, T: 0, To: 0 }));
    this.cam = 0;                 // the mode cam: 0 home (platen), 1 cutter
    this.cmdDir = 1;              // the direction the motor was last stepped
    this.exc = { active: false, reachedScan: false, max: 0 };   // the arm's excursion from the recording stop
    this.stopT = 0; this.onStop = 0;
    this.awake = true; this.quiet = 0;
  }

  wake() { this.awake = true; this.quiet = 0; }

  /** The controller's drive: phase state s at amplitude a (src/sim/common/stepper.js). */
  setMotor(s, a) {
    if (s !== this.motor.state || a !== this.motor.amp) {
      if (s !== this.motor.state) this.cmdDir = Math.sign(s - this.motor.state);
      this.motor.command(s, a); this.wake();
    }
  }

  /** Which train the planet is meshed with: SCAN, RECORD, CUT or -1 (swinging). For the snapshot and tests. */
  meshed() { for (const t of this.trains) if (t.mesh) return t.k; return -1; }

  /** The cam switch: made while the mode cam is at home (the platen selected). */
  camHome() { return this.cam === 0; }

  /** The train the recording-side stop meshes with, by the mode cam. */
  recordSide() { return this.cam === 0 ? RECORD : CUT; }

  /** The mode lever: a part swing toward the scanning side and back steps the cam on (a jog). */
  watchExcursion() {
    const P = this.def.planet, M = this.def.mode, x = this.exc;
    const offRec = Math.abs(this.phi + P.travel);
    if (!x.active) {
      if (offRec > P.meshRelease) { x.active = true; x.reachedScan = false; x.max = this.phi; }
      return;
    }
    if (this.phi > x.max) x.max = this.phi;
    if (Math.abs(this.phi - P.travel) < P.meshWindow) x.reachedScan = true;
    if (offRec < P.meshWindow) {
      x.active = false;
      if (!x.reachedScan && x.max > -P.travel + M.kickAt * 2 * P.travel) {
        this.cam ^= 1;
        this.sim.ac(this.sim.t, FAC.CAM_HOME, this.cam, Math.abs(this.phiV));
      }
    }
  }

  /** Phase one of a substep: each train's tooth torque from the present state, and every torque on it but its load's. */
  prepare() {
    const M = this.motor, P = this.def.planet;
    this.watchExcursion();
    const rec = this.recordSide();
    for (const t of this.trains) {
      const d = t.d, end = t.k === SCAN ? P.travel : -P.travel;
      // In mesh near the stop (on the recording side only the train the mode lever lets in); once in, the teeth hold
      // until the arm has backed off a tooth's depth.
      const off = Math.abs(this.phi - end);
      const eligible = t.k === SCAN || t.k === rec;
      if (!t.mesh && eligible && off < P.meshWindow) { t.mesh = true; t.m0 = M.th; t.p0 = t.psi; }
      else if (t.mesh && off > P.meshRelease) t.mesh = false;
      if (t.mesh) {
        const rel = ((M.th - t.m0) * d.sign) / d.ratio - (t.psi - t.p0);
        const x = deadzone(rel, d.backlash / 2);
        t.T = x !== 0 ? d.meshStiffness * x + d.meshDamping * ((M.w * d.sign) / d.ratio - t.w) : 0;
      } else t.T = 0;
      t.To = t.T - d.viscous * t.w + drag(t.w, d.bearingCoulomb, 0.01);
    }
  }

  /** Phase two: integrate, with the torque each train's load passes back (a roller's nip force times its radius). */
  integrate(h, nipScan, nipRecord, nipCut = 0) {
    const M = this.motor, P = this.def.planet, S = this.trains[SCAN], R = this.trains[RECORD], C = this.trains[CUT];
    // The arm: dragged by the pinion, pushed into a loaded mesh by the teeth while the motor is stepped toward that
    // side or held (so its ring at the end of a move does not unmesh it), but not while it is stepped the other way:
    // then only the drag acts and the planet walks out. Caught by its stops.
    let Ta = P.drag * sat(M.w - this.phiV, P.dragSpeed) - P.viscous * this.phiV;
    const hold = (t, side) => (t.mesh && this.cmdDir * side >= 0 ? (P.selfHold * Math.abs(t.T)) / t.d.ratio : 0);
    Ta += hold(S, 1) - hold(R, -1) - hold(C, -1);
    let stop = 0;
    const over = this.phi > P.travel ? this.phi - P.travel : this.phi < -P.travel ? this.phi + P.travel : 0;
    if (over !== 0) {
      stop = -P.stopStiffness * over - P.stopDamping * this.phiV;
      if (stop * over > 0) stop = 0;            // a stop pushes, never pulls
      const side = over > 0 ? 1 : -1;
      if (this.onStop !== side) { this.onStop = side; this.sim.ac(this.sim.t, FAC.PLANET_STOP, side > 0 ? 0 : 1, Math.abs(this.phiV)); }
    } else this.onStop = 0;
    this.stopT = stop;
    let load = -P.drag * sat(M.w - this.phiV, P.dragSpeed);
    for (const t of this.trains) load -= (t.T * t.d.sign) / t.d.ratio;
    M.integrate(h, load);
    this.phiV += (h * (Ta + stop)) / P.inertia;
    this.phi += this.phiV * h;
    S.w += (h * (S.To - nipScan)) / S.d.inertia; S.psi += S.w * h;
    R.w += (h * (R.To - nipRecord)) / R.d.inertia; R.psi += R.w * h;
    C.w += (h * (C.To - nipCut)) / C.d.inertia; C.psi += C.w * h;
    const ports = this.sim.ports;
    ports[FAX_PORT.MOTOR] += M.Te; ports[FAX_PORT.PLANET] += Math.abs(stop);
    ports[FAX_PORT.SCAN_MESH] += Math.abs(S.T); ports[FAX_PORT.RECORD_MESH] += Math.abs(R.T); ports[FAX_PORT.CUT_MESH] += Math.abs(C.T);
    const still = M.still() && Math.abs(this.phiV) < 1e-6 && this.trains.every((t) => Math.abs(t.w) < 1e-6);
    if (still) { if (++this.quiet > SLEEP_FRAMES) this.awake = false; } else this.quiet = 0;
  }

  exportState() {
    return { motor: this.motor.exportState(), phi: this.phi, phiV: this.phiV, onStop: this.onStop, awake: this.awake, quiet: this.quiet,
      cam: this.cam, cmdDir: this.cmdDir, exc: { ...this.exc },
      trains: this.trains.map((t) => ({ psi: t.psi, w: t.w, mesh: t.mesh, m0: t.m0, p0: t.p0 })) };
  }

  importState(s) {
    this.motor.importState(s.motor);
    Object.assign(this, { phi: s.phi, phiV: s.phiV, onStop: s.onStop, awake: s.awake, quiet: s.quiet, cam: s.cam ?? 0, cmdDir: s.cmdDir ?? 1 });
    if (s.exc) this.exc = { ...s.exc };
    s.trains.forEach((x, k) => { if (this.trains[k]) Object.assign(this.trains[k], x); });
  }
}
