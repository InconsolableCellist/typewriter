// The two stepper motor models of the word processor's printer and diskette drives (architecture.md 6.3). Each
// integrates a rotor angle and, per phase, a current with a first-order lag (a chopper drive), so torque falls off
// with step rate and a motor asked for too much loses step. A controller only sets phase commands and current
// amplitudes; the rotor moves because of the torque. The caller applies the load (screw, belt, wheel) as a torque
// each substep and integrates any coupled body itself. Currents are in units of the rated current.

const sat = (w, w0) => (w > w0 ? 1 : w < -w0 ? -1 : w / w0);

/**
 * Permanent-magnet (hybrid) stepper, two phases, full step with both phases on.
 *   T = -K (iA sin(N th') - iB cos(N th')) - Td sin(4 N th) - b th' - Tc sgn(th'),   N = steps/rev / 4
 * with th' offset by an eighth of an electrical period so that phase state s rests at th = s * step.
 */
export class Stepper2Phase {
  constructor(p) { this.setParams(p); this.th = 0; this.w = 0; this.iA = 0; this.iB = 0; this.state = 0; this.amp = 0; this.Te = 0; }

  setParams(p) {
    this.N = p.stepsPerRev / 4;
    this.step = (2 * Math.PI) / p.stepsPerRev;
    this.KI = p.holdingTorque / Math.SQRT2;       // two phases at rated current give the holding torque
    this.Td = p.detentTorque ?? 0;
    this.J = p.rotorInertia; this.b = p.viscous ?? 0; this.Tc = p.coulomb ?? 0;
    this.tauE = p.tauE;
  }

  /** Phase state s (the sequence (+,+) (-,+) (-,-) (+,-) repeating) at amplitude a; a = 0 switches the drive off. */
  command(s, a) { this.state = s; this.amp = a; }
  cmdA() { const k = this.state & 3; return (k === 0 || k === 3 ? 1 : -1) * this.amp; }
  cmdB() { const k = this.state & 3; return (k < 2 ? 1 : -1) * this.amp; }

  /** Electromagnetic and detent torque at the present angle and currents (N m). */
  torque() {
    const x = this.N * this.th + Math.PI / 4;
    return -this.KI * (this.iA * Math.sin(x) - this.iB * Math.cos(x)) - this.Td * Math.sin(4 * this.N * this.th);
  }

  /** Advance currents and rotor by h under an external load torque. */
  integrate(h, load) {
    const k = h / this.tauE;
    this.iA += (this.cmdA() - this.iA) * k;
    this.iB += (this.cmdB() - this.iB) * k;
    const Te = this.torque();
    this.Te = Te;               // kept for the sound: its reaction on the stator rings what the motor is bolted to
    const T = Te + load - this.b * this.w - this.Tc * sat(this.w, 0.05);
    this.w += (T / this.J) * h;
    this.th += this.w * h;
  }

  /** Currents settled and the rotor at rest: nothing changes until the next command. */
  still() {
    return Math.abs(this.w) < 1e-4 && Math.abs(this.iA - this.cmdA()) < 1e-6 && Math.abs(this.iB - this.cmdB()) < 1e-6;
  }

  exportState() { return { th: this.th, w: this.w, iA: this.iA, iB: this.iB, state: this.state, amp: this.amp }; }
  importState(s) { Object.assign(this, s); }
}

/**
 * Variable-reluctance stepper, three phases, single phase on. Nr rotor teeth give 3 Nr steps per revolution.
 *   T = sum over k of -(1/2) L1 Nr ik^2 sin(Nr th - 2 pi k / 3) - b th' - Tc sgn(th')
 * Phase k energised alone rests at th = k * step (mod three steps).
 */
export class StepperVR3 {
  constructor(p) { this.setParams(p); this.th = 0; this.w = 0; this.i = new Float64Array(3); this.phase = 0; this.amp = 0; this.Te = 0; }

  setParams(p) {
    this.Nr = p.rotorTeeth;
    this.step = (2 * Math.PI) / (3 * p.rotorTeeth);
    this.Tpk = p.peakTorque;                      // (1/2) L1 Nr I^2 at rated current
    this.J = p.inertia; this.b = p.viscous ?? 0; this.Tc = p.coulomb ?? 0;
    this.tauE = p.tauE;
  }

  /** Energise phase k (0..2) alone at amplitude a; a = 0 switches every phase off. */
  command(k, a) { this.phase = k; this.amp = a; }

  torque() {
    let T = 0;
    const x = this.Nr * this.th;
    for (let k = 0; k < 3; k++) {
      const ik = this.i[k];
      if (ik !== 0) T -= this.Tpk * ik * ik * Math.sin(x - (2 * Math.PI * k) / 3);
    }
    return T;
  }

  /** Advance currents and rotor by h under an external load torque. */
  integrate(h, load) {
    const r = h / this.tauE;
    for (let k = 0; k < 3; k++) {
      const target = k === this.phase ? this.amp : 0;
      let ik = this.i[k] + (target - this.i[k]) * r;
      if (target === 0 && ik < 1e-9) ik = 0;
      this.i[k] = ik;
    }
    const Te = this.torque();
    this.Te = Te;               // kept for the sound: its reaction on the stator rings what the motor is bolted to
    const T = Te + load - this.b * this.w - this.Tc * sat(this.w, 0.05);
    this.w += (T / this.J) * h;
    this.th += this.w * h;
  }

  still() {
    if (Math.abs(this.w) > 1e-4) return false;
    for (let k = 0; k < 3; k++) if (Math.abs(this.i[k] - (k === this.phase ? this.amp : 0)) > 1e-6) return false;
    return true;
  }

  exportState() { return { th: this.th, w: this.w, i: Array.from(this.i), phase: this.phase, amp: this.amp }; }
  importState(s) { this.th = s.th; this.w = s.w; this.i.set(s.i); this.phase = s.phase; this.amp = s.amp; }
}
