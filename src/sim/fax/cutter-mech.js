// The automatic cutter (docs/fax/architecture.md 3.3; docs/fax/hardware.md 4.4). The service manual shows NO cutter
// motor: the cutter is driven from the one pulse motor through planet lever C, the cutter gear (with its spring) and
// the cutter plate, a crank disc whose pin works the cutter arm (FO-70 only) that closes the cutter unit's blade; a
// cutter switch on the drive unit (CNCUT, signal CUTI) tells the firmware the crank is at home [S p.3-7/pdf41 fig. 5,
// p.3-9/pdf43 fig. 7, p.4-3/pdf51, parts lists p.2 and p.6/pdf89, pdf94]. So this body has no motor of its own: it is
// the load on the drive's cutter train (drive-mech.js CUT). The crank turns with the train; the blade follows the
// crank (0 open at home, 1 through the paper path at half a turn) and shears on its closing stroke, which loads the
// train; when it passes through, the strip divides there (a rule: the cut itself is not modelled, plan 2).
import { FAX_PORT, FAC } from './ports.js';
import { drag } from './friction.js';

const TWO_PI = 2 * Math.PI;

export class CutterMech {
  /** sim: the host; def: machine.mech.cutter; head: the strip it cuts (head-mech.js); train: the drive's cutter train. */
  constructor(sim, def, head, train) {
    this.sim = sim; this.def = def; this.head = head; this.train = train;
    this.wasHome = true; this.cutDone = false; this.Tcut = 0;
  }

  /** The crank's angle (rad, 0 home), from the cutter train. */
  cam() { const c = this.train.psi % TWO_PI; return c < 0 ? c + TWO_PI : c; }
  /** Crank speed (rad/s). */
  get w() { return this.train.w; }
  /** Blade travel: 0 open at home, 1 through the paper path at half a turn. */
  blade() { return 0.5 * (1 - Math.cos(this.cam())); }
  /** The cutter switch: made over the crank's home arc. */
  home() {
    const [a, b] = this.def.homeWindow;
    let c = this.cam();
    if (c > Math.PI) c -= TWO_PI;
    return c >= a && c <= b;
  }

  /** The torque the cutter puts back on its train this substep: the blade shearing, the arm and guide's friction. */
  load() {
    const D = this.def, b = this.blade(), down = Math.sin(this.cam()) > 0;
    const shearing = down && b >= D.cutWindow[0] && b < D.cutWindow[1] && this.head.spansCutter();
    this.Tcut = shearing ? D.cutTorque : 0;
    return -drag(this.train.w, this.Tcut + D.camFriction, 0.05);
  }

  /** After the drive has moved the train: the cut, the switch, the ports. */
  after() {
    const D = this.def, w = this.train.w, down = Math.sin(this.cam()) > 0, b = this.blade();
    if (down && b >= D.cutWindow[1] && !this.cutDone) {
      this.cutDone = true;
      if (this.head.spansCutter()) { this.head.cut(); this.sim.ac(this.sim.t, FAC.CUT, 0, w); }
    }
    if (!down) this.cutDone = false;
    const home = this.home();
    if (home !== this.wasHome) this.sim.ac(this.sim.t, FAC.CUTTER_SWITCH, home ? 1 : 0, w);
    this.wasHome = home;
    const ports = this.sim.ports;
    ports[FAX_PORT.CUTTER_SPEED] += w; ports[FAX_PORT.BLADE] += this.Tcut;
  }

  exportState() { return { wasHome: this.wasHome, cutDone: this.cutDone }; }
  importState(s) { Object.assign(this, { wasHome: s.wasHome, cutDone: s.cutDone }); }
}
