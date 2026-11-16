// The automatic cutter (docs/fax/architecture.md 3.3; plan 2). ASSUMED design, isolated here: a guillotine blade on
// an eccentric cam, one cam turn a cut, turned through a self-locking worm by its own small DC motor, with a home
// switch on the cam. The motor's current follows its voltage less its back EMF; shorted at 0 V it brakes itself. The
// blade meets the paper on its down stroke and shears it, which loads the cam; when it passes through, the strip
// divides there (a rule: the cut itself is not modelled, plan 2). The worm does not back-drive, so the cam stays put
// unpowered.
import { FAX_PORT, FAC } from './ports.js';
import { drag } from './friction.js';

const SLEEP_FRAMES = 384;
const TWO_PI = 2 * Math.PI;

export class CutterMech {
  /** sim: the host; def: machine.mech.cutter; head: the strip it cuts (head-mech.js). */
  constructor(sim, def, head) {
    this.sim = sim; this.def = def; this.head = head;
    this.th = 0; this.w = 0;      // motor angle and speed; the cam turns th / ratio
    this.volts = 0; this.closed = false; this.i = 0;
    this.wasHome = true; this.cutDone = false;
    this.awake = false; this.quiet = 0;
  }

  wake() { this.awake = true; this.quiet = 0; }

  /** The controller's drive: the bridge's voltage, and whether it closes the circuit at 0 V (a dynamic brake). */
  setDrive(volts, closed = true) { if (volts !== this.volts || closed !== this.closed) { this.volts = volts; this.closed = closed; this.wake(); } }

  cam() { const c = (this.th / this.def.ratio) % TWO_PI; return c < 0 ? c + TWO_PI : c; }
  /** Blade travel: 0 up at home, 1 through the paper path at half a turn. */
  blade() { return 0.5 * (1 - Math.cos(this.cam())); }
  /** The home switch on the cam. */
  home() {
    const [a, b] = this.def.homeWindow;
    let c = this.cam();
    if (c > Math.PI) c -= TWO_PI;
    return c >= a && c <= b;
  }

  step(h) {
    if (!this.awake) return;
    const D = this.def, M = D.motor;
    const powered = this.volts !== 0 || this.closed;
    this.i = powered ? (this.volts - M.ke * this.w) / M.resistance : 0;
    // The blade's load on its down stroke, through the worm (which loses efficiency driving forward).
    const b = this.blade(), down = Math.sin(this.cam()) > 0;
    const shearing = down && b >= D.cutWindow[0] && b < D.cutWindow[1] && this.head.spansCutter();
    const Tcut = shearing ? D.cutTorque : 0;
    const J = M.inertia + D.camInertia / (D.ratio * D.ratio);
    const Tload = (Tcut + D.camFriction) / (D.ratio * D.efficiency);
    let T = M.kt * this.i - M.viscous * this.w + drag(this.w, M.coulomb, 1);
    // A load only resists: it can stop the motor, never turn it back (the worm locks).
    T += this.w > 0 ? -Tload : this.w < 0 ? Tload : -Math.sign(T) * Math.min(Math.abs(T), Tload);
    this.w += (h * T) / J;
    if (this.w < 0 && !powered) this.w = 0;      // self-locking: unpowered, nothing turns it back
    this.th += this.w * h;
    const cam = this.w / D.ratio;
    if (down && b >= D.cutWindow[1] && !this.cutDone) {
      this.cutDone = true;
      if (this.head.spansCutter()) { this.head.cut(); this.sim.ac(this.sim.t, FAC.CUT, 0, cam); }
    }
    if (!down) this.cutDone = false;
    const home = this.home();
    if (home && !this.wasHome) this.sim.ac(this.sim.t, FAC.CAM_HOME, 0, cam);
    this.wasHome = home;
    const ports = this.sim.ports;
    ports[FAX_PORT.CUTTER_CURRENT] += this.i; ports[FAX_PORT.CUTTER_SPEED] += this.w; ports[FAX_PORT.BLADE] += Tcut;
    if (Math.abs(this.w) < 1e-6 && this.volts === 0) { if (++this.quiet > SLEEP_FRAMES) { this.awake = false; this.w = 0; this.i = 0; } } else this.quiet = 0;
  }

  exportState() {
    return { th: this.th, w: this.w, volts: this.volts, closed: this.closed, i: this.i, wasHome: this.wasHome, cutDone: this.cutDone, awake: this.awake, quiet: this.quiet };
  }
  importState(s) { Object.assign(this, s); }
}
