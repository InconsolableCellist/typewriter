// The electronics module's mechanism, as far as it moves (architecture.md 4.2; HW 1.9): its power and the one fan in
// the power supply, which draws air through the module whenever power is on. The fan is a shaded-pole motor on the AC
// line: its speed is integrated from the motor's torque against the air's drag, so it runs up after power-on and runs
// down after power-off. The power rocker, knobs, tilt and swivel join this body with the station's view.

const SLEEP_FRAMES = 384;
const sat = (x, x0) => (x > x0 ? 1 : x < -x0 ? -1 : x / x0);

/** Speed at which the shaded-pole torque, falling linearly to zero at synchronous speed, meets drag and friction. */
export function fanSteadyOmega(F) {
  // stall (1 - w / ws) = drag w^2 + coulomb
  const a = F.drag, b = F.stallTorque / F.syncOmega, c = F.coulomb - F.stallTorque;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export class StationMech {
  /** sim: the host; def: machine.station. warm: powered with the fan at its running speed (the warm start). */
  constructor(sim, def, { warm = true } = {}) {
    this.sim = sim; this.def = def;
    this.power = 1;
    this.fan = warm ? fanSteadyOmega(def.fan) : 0;
    this.awake = !warm; this.sleep = 0;
  }

  powered() { return this.power > 0; }

  /** The station's power: the fan and, through the host, both diskette motors run whenever it is on (HW 1.9, 3.5). */
  setPower(on) {
    const p = on ? 1 : 0;
    if (p !== this.power) { this.power = p; this.awake = true; this.sleep = 0; }
  }

  step(h) {
    if (!this.awake) return;
    const F = this.def.fan, w = this.fan, on = this.powered();
    const T = (on ? F.stallTorque * (1 - w / F.syncOmega) : 0) - F.drag * w * w - F.coulomb * sat(w, 1);
    this.fan = w + (T / F.inertia) * h;
    if (!on && this.fan < 0.05) this.fan = 0;
    // Asleep once the speed has stopped changing (to rounding): nothing changes the load until the power does.
    if (Math.abs(this.fan - w) < 1e-9) {
      if (++this.sleep > SLEEP_FRAMES) this.awake = false;
    } else this.sleep = 0;
  }

  exportState() { return { power: this.power, fan: this.fan, awake: this.awake, sleep: this.sleep }; }
  importState(s) { Object.assign(this, s); }
}
