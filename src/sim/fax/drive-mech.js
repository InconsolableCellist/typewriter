// The drive unit (cutter model): the one stepper, the swing (planetary) gear on its pinion and the two gear trains it
// selects, to the document rollers and to the platen (docs/fax/architecture.md 3.1). The layout is the definition's
// `drive.layout`, 'single-planetary', an ASSUMPTION until the service manual's drive unit pages are read (plan 2,
// risk 21); this file and drive-ctl.js are the only places that know it.
//
// The swing arm is dragged round with the pinion by the friction on the planet's axle, so it follows the motor until
// it lands on an end stop, where the planet meshes with that train's first gear; the train then turns with the motor
// through the tooth stiffness and its backlash. A change of direction swings the arm across, which takes real motor
// rotation (lost motion) and lands with a clack. Nothing here decides which train is driven: the arm's angle does.
import { Stepper2Phase } from '../common/stepper.js';
import { FAX_PORT, FAC } from './ports.js';
import { drag } from './friction.js';

const SLEEP_FRAMES = 384;
const sat = (x, x0) => (x > x0 ? 1 : x < -x0 ? -1 : x / x0);
const deadzone = (x, b) => (x > b ? x - b : x < -b ? x + b : 0);
export const SCAN = 0, RECORD = 1;

export class DriveMech {
  /** sim: the host; def: machine.mech.drive. The warm start leaves the planet in the scanning train (the last move). */
  constructor(sim, def) {
    this.sim = sim; this.def = def;
    if (def.layout !== 'single-planetary') throw new Error(`drive layout '${def.layout}' is not built`);
    this.motor = new Stepper2Phase(def.motor);
    this.phi = def.planet.travel; this.phiV = 0;
    this.trains = [def.scan, def.record].map((d, k) => ({ d, k, psi: 0, w: 0, mesh: k === SCAN, m0: 0, p0: 0, T: 0, To: 0 }));
    this.stopT = 0; this.onStop = 0;
    this.awake = true; this.quiet = 0;
  }

  wake() { this.awake = true; this.quiet = 0; }

  /** The controller's drive: phase state s at amplitude a (src/sim/common/stepper.js). */
  setMotor(s, a) { if (s !== this.motor.state || a !== this.motor.amp) { this.motor.command(s, a); this.wake(); } }

  /** Which train the planet is meshed with: SCAN, RECORD or -1 (swinging). For the snapshot and tests, not the firmware. */
  meshed() { return this.trains[SCAN].mesh ? SCAN : this.trains[RECORD].mesh ? RECORD : -1; }

  /** Phase one of a substep: each train's tooth torque from the present state, and every torque on it but its nip's. */
  prepare() {
    const M = this.motor, P = this.def.planet;
    for (const t of this.trains) {
      const d = t.d, end = t.k === SCAN ? P.travel : -P.travel;
      // In mesh near the stop; once in, the teeth hold until the arm has backed off a tooth's depth.
      const off = Math.abs(this.phi - end);
      if (!t.mesh && off < P.meshWindow) { t.mesh = true; t.m0 = M.th; t.p0 = t.psi; }
      else if (t.mesh && off > P.meshRelease) t.mesh = false;
      if (t.mesh) {
        const rel = ((M.th - t.m0) * d.sign) / d.ratio - (t.psi - t.p0);
        const x = deadzone(rel, d.backlash / 2);
        t.T = x !== 0 ? d.meshStiffness * x + d.meshDamping * ((M.w * d.sign) / d.ratio - t.w) : 0;
      } else t.T = 0;
      t.To = t.T - d.viscous * t.w + drag(t.w, d.bearingCoulomb, 0.01);
    }
  }

  /** Phase two: integrate, with the torque each train's roller passes to its path (nip force times radius). */
  integrate(h, nipScan, nipRecord) {
    const M = this.motor, P = this.def.planet, S = this.trains[SCAN], R = this.trains[RECORD];
    // The arm: dragged by the pinion, pushed into a loaded mesh by the teeth, caught by its stops.
    let Ta = P.drag * sat(M.w - this.phiV, P.dragSpeed) - P.viscous * this.phiV;
    if (S.mesh) Ta += (P.selfHold * Math.abs(S.T)) / S.d.ratio;
    if (R.mesh) Ta -= (P.selfHold * Math.abs(R.T)) / R.d.ratio;
    let stop = 0;
    const over = this.phi > P.travel ? this.phi - P.travel : this.phi < -P.travel ? this.phi + P.travel : 0;
    if (over !== 0) {
      stop = -P.stopStiffness * over - P.stopDamping * this.phiV;
      if (stop * over > 0) stop = 0;            // a stop pushes, never pulls
      const side = over > 0 ? 1 : -1;
      if (this.onStop !== side) { this.onStop = side; this.sim.ac(this.sim.t, FAC.PLANET_STOP, side > 0 ? 0 : 1, Math.abs(this.phiV)); }
    } else this.onStop = 0;
    this.stopT = stop;
    const load = -(S.T * S.d.sign) / S.d.ratio - (R.T * R.d.sign) / R.d.ratio - P.drag * sat(M.w - this.phiV, P.dragSpeed);
    M.integrate(h, load);
    this.phiV += (h * (Ta + stop)) / P.inertia;
    this.phi += this.phiV * h;
    S.w += (h * (S.To - nipScan)) / S.d.inertia; S.psi += S.w * h;
    R.w += (h * (R.To - nipRecord)) / R.d.inertia; R.psi += R.w * h;
    const ports = this.sim.ports;
    ports[FAX_PORT.MOTOR] += M.Te; ports[FAX_PORT.PLANET] += Math.abs(stop);
    ports[FAX_PORT.SCAN_MESH] += Math.abs(S.T); ports[FAX_PORT.RECORD_MESH] += Math.abs(R.T);
    const still = M.still() && Math.abs(this.phiV) < 1e-6 && Math.abs(S.w) < 1e-6 && Math.abs(R.w) < 1e-6;
    if (still) { if (++this.quiet > SLEEP_FRAMES) this.awake = false; } else this.quiet = 0;
  }

  exportState() {
    return { motor: this.motor.exportState(), phi: this.phi, phiV: this.phiV, onStop: this.onStop, awake: this.awake, quiet: this.quiet,
      trains: this.trains.map((t) => ({ psi: t.psi, w: t.w, mesh: t.mesh, m0: t.m0, p0: t.p0 })) };
  }

  importState(s) {
    this.motor.importState(s.motor);
    Object.assign(this, { phi: s.phi, phiV: s.phiV, onStop: s.onStop, awake: s.awake, quiet: s.quiet });
    s.trains.forEach((x, k) => Object.assign(this.trains[k], x));
  }
}
