// The head frame unit, the platen and the paper (docs/fax/architecture.md 3.3; plan 2): the thermal paper roll lying
// loose in its bay under the operation panel, its radius and inertia falling as it is used; the strip from the roll
// over the platen roller under the head, pressed by the head's springs; the paper sensor before the head; and the
// operation panel over the paper compartment on its hinge, held shut by its lock levers and read by the door sensor.
// The head stays on the platen with the panel open: paper is pushed through the slot by hand [S p.1-6/pdf11], so
// cover.liftsHead is false (true restores the first draft's head lifted by the panel).
//
// The strip is inextensible from the roll to the nip, so it is one DOF: `u`, the paper paid out past the head line
// since the roll was loaded (m). A point of the paper is named by its strip coordinate c: it stands u - c beyond the
// head. The platen moves the strip only through friction at the nip (friction.js); the head's glaze and the roll's
// drag hold it back. Printing is a call, strobe(dots, energy), which hands the line to the thermal model.
import { FAX_PORT, FAC } from './ports.js';
import { nipForce, drag } from './friction.js';

const SLEEP_FRAMES = 384;
const ROLL_TO_HEAD = 0.04;       // m of strip from where it leaves the roll to the head line [A]

/** The default mark rule while no thermal model is attached: a dot marks when strobed hard enough, coated side only. */
export function defaultThermal(def) {
  return {
    printLine({ dots, energy, coated }) {
      const out = new Uint8Array(dots.length);
      if (!coated) return out;
      const e = typeof energy === 'number' ? energy : 0;
      for (let i = 0; i < dots.length; i++) out[i] = dots[i] && (typeof energy === 'number' ? e : energy[i]) >= def.markEnergy ? 255 : 0;
      return out;
    },
  };
}

export class HeadMech {
  /** sim: the host; def: machine.mech.printer; cover: machine.mech.cover. warm: a part-used starter roll, cover shut. */
  constructor(sim, def, cover, { warm = true } = {}) {
    this.sim = sim; this.def = def; this.cdef = cover;
    this.roll = null;            // { length, coated } while a roll is in the bay
    this.u = 0; this.v = 0;      // payout past the head (m), and its speed
    this.lead = 0;               // strip coordinate of the paper's leading end
    this.a = 0; this.av = 0;     // the cover's angle (rad, 0 shut) and speed
    this.latched = true; this.onOpenStop = false;
    this.hand = 0; this.coverHand = 0;
    this.thermal = defaultThermal(def);
    this.lines = 0;
    this.awake = true; this.quiet = 0;
    if (warm) this.loadRoll({ length: def.roll.starterLength, used: def.roll.starterLength - def.roll.warmRemaining });
  }

  wake() { this.awake = true; this.quiet = 0; }

  /**
   * A roll dropped into the bay, its end drawn over the platen to the exit slot and the cover shut on it: `length` m of
   * paper (`used` m of it gone), coated side toward the head unless `coated` is false (in backwards: it prints nothing).
   */
  loadRoll({ length = this.def.roll.spareLength, used = 0, coated = true } = {}) {
    this.roll = { length: length - used, coated };
    this.u = 0; this.v = 0;
    this.lead = -this.def.exitAt;
    this.wake();
  }

  removeRoll() { this.roll = null; this.u = 0; this.v = 0; this.wake(); }

  // ---- state the others read ---------------------------------------------------------------------------------------
  /** Paper left on the roll (m). */
  remaining() { return this.roll ? Math.max(0, this.roll.length - this.u - ROLL_TO_HEAD) : 0; }
  /** The roll's outside radius (m): the paper's cross-section wound on the core. */
  rollRadius() {
    const R = this.def.roll;
    return Math.sqrt(R.coreRadius * R.coreRadius + (R.thickness * this.remaining()) / Math.PI);
  }
  /** Paper is under the head (its tail has not passed the head line). */
  paperUnderHead() { return !!this.roll && this.u < this.roll.length; }
  /** The paper sensor, a lever just before the head [A]: paper until the roll's tail has passed it. */
  paperSensor() { return !!this.roll && this.u < this.roll.length - 0.005; }
  coverClosed() { return this.latched; }
  headDown() { return !this.cdef.liftsHead || this.a < this.cdef.headLiftAngle; }
  /** The strip coordinate under the cutter, and whether paper spans it. */
  atCutter() { return this.u - this.def.cutterAt; }
  spansCutter() { return !!this.roll && this.atCutter() > this.lead + 1e-4 && this.atCutter() < this.roll.length; }

  /** The cutter has parted the strip at its blade: the piece beyond falls (an event the kit makes a sheet of). */
  cut() {
    const at = this.atCutter();
    const piece = { from: this.lead, to: at, length: at - this.lead };
    this.lead = at;
    this.sim.emitEvent({ type: 'device', dev: 'print', ev: 'cut', ...piece });
    return piece;
  }

  /**
   * The head prints one dot line where the paper is now (architecture.md 4.1): dots a Uint8Array of `def.dots`, 0 or 1;
   * energy the strobe energy per dot in J, a number or a Float32Array per dot. The thermal model (attachThermal) turns
   * it into darkness; with the head lifted or no paper under it nothing marks.
   */
  strobe(dots, energy) {
    if (!this.headDown() || !this.paperUnderHead()) return;
    const darkness = this.thermal.printLine({ dots, energy, coated: this.roll.coated, coord: this.u, t: this.sim.t, speed: this.v });
    this.lines++;
    this.sim.emitEvent({ type: 'device', dev: 'print', ev: 'line', coord: this.u, darkness });
  }

  // ---- hands -------------------------------------------------------------------------------------------------------
  stripMass() {
    const R = this.def.roll, rem = this.remaining(), r = this.rollRadius(), rc = R.coreRadius;
    const mp = R.grammage * R.width * rem;
    const J = 0.5 * mp * (r * r + rc * rc) + R.coreMass * rc * rc;
    return J / (r * r) + R.grammage * R.width * (ROLL_TO_HEAD + 0.05);
  }

  registerDofs(inputs) {
    inputs.register('strip', {
      n: 1, pos: () => this.u, vel: () => this.v, inertia: () => (this.roll ? this.stripMass() : 0.01),
      apply: (_i, f) => { this.hand += f; }, wake: () => this.wake(), k: 200, c: 2, maxF: 3, hardMax: 8, vHand: 0.5,
    });
    inputs.register('cover', {
      n: 1, pos: () => this.a, vel: () => this.av, inertia: () => this.cdef.inertia,
      apply: (_i, f) => { this.coverHand += f; }, wake: () => this.wake(), k: 3, c: 0.05, maxF: 1.5, hardMax: 3, vHand: 4,
    });
  }

  /** One substep against the recording train (t: { d, w, To }). Returns the torque the strip puts on the platen. */
  step(h, t) {
    const D = this.def, C = this.cdef;
    // The cover: gravity shuts it, the latch holds it shut until a hand lifts it past the latch's pull.
    let T = this.coverHand - C.gravityTorque * Math.cos(this.a) + drag(this.av, C.coulomb, 0.05) - C.viscous * this.av;
    if (this.latched) {
      if (T > C.latchTorque) this.latched = false; else { T = 0; this.av = 0; }
    }
    if (!this.latched) {
      if (this.a < 0) T += -C.stopStiffness * this.a - C.stopDamping * Math.min(0, this.av);
      if (this.a > C.open) T += -C.stopStiffness * (this.a - C.open) - C.stopDamping * Math.max(0, this.av);
      this.av += (h * T) / C.inertia;
      this.a += this.av * h;
      if (this.a > C.open && !this.onOpenStop) { this.onOpenStop = true; this.sim.ac(this.sim.t, FAC.COVER, 1, Math.abs(this.av)); }
      else if (this.a < C.open) this.onOpenStop = false;
      if (this.a <= C.latchAngle && this.av <= 0) {           // shut onto its latch
        this.sim.ac(this.sim.t, FAC.COVER, 0, Math.abs(this.av));
        this.latched = true; this.a = 0; this.av = 0;
        this.sim.emitEvent({ type: 'device', dev: 'cover', ev: 'closed' });
      }
    }
    this.coverHand = 0;
    // The strip.
    let nip = 0;
    const v0 = this.v;
    if (this.roll) {
      const m = this.stripMass(), r = this.rollRadius();
      const down = this.headDown() && this.paperUnderHead();
      const N = down ? D.headForce : 0;
      let Fo = this.hand + drag(this.v, D.roll.drag / r, D.roll.slipSpeed) + drag(this.v, D.headMu * N, D.roll.slipSpeed);
      if (!this.paperUnderHead()) Fo = this.hand + drag(this.v, 0.05, D.roll.slipSpeed);
      const F = down ? nipForce(h, t.d.inertia, t.w, t.To, D.platenRadius, m, this.v, Fo, D.platenMu * N) : 0;
      nip = F * D.platenRadius;
      this.v += (h * (Fo + F)) / m;
      this.u += this.v * h;
      if (this.u < 0 && this.v < 0) { this.u = 0; this.v = 0; }     // the roll does not wind itself back up
      this.sim.ports[FAX_PORT.PAPER_SPEED] += this.v;
    }
    this.hand = 0;
    const moving = Math.abs(this.v) > 1e-6 || Math.abs(v0) > 1e-6 || (!this.latched && this.av !== 0) || (!this.latched && this.a > 0 && this.a < C.open);
    if (moving) this.quiet = 0; else if (++this.quiet > SLEEP_FRAMES) this.awake = false;
    return nip;
  }

  exportState() {
    return { roll: this.roll ? { ...this.roll } : null, u: this.u, v: this.v, lead: this.lead, a: this.a, av: this.av, latched: this.latched,
      onOpenStop: this.onOpenStop, lines: this.lines, awake: this.awake, quiet: this.quiet };
  }

  importState(s) { Object.assign(this, { ...s, roll: s.roll ? { ...s.roll } : null }); }
}
