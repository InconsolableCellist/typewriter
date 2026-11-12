// The keyboard's 84 capacitive key modules (docs/displaywriter/architecture.md 5.1). Each key is a stem and a fly
// plate in one conservative system: the stem's return spring, a flat spring on the stem that toggles the plate, and
// the plate's own snap. Make (plate leaves its pad), break (plate returns), the hysteresis between them and the
// tactile drop in the stem force all come out of the integration; nothing here decides that a key is "down".
import { KEYS } from '../../machine/wp-keys.js';

const P = {
  travel: 0.0032,       // m, stem travel to the felt
  xc: 0.0015,           // m, stem position where the toggle spring is neutral
  Y: 0.0005,            // m, plate lift
  Kt: 240,              // N/m, toggle spring
  A: 240,               // N/m, plate snap
  F0: 0.30,             // N, return spring preload
  k: 103,               // N/m, return spring rate
  ms: 0.0025,           // kg, cap and stem
  mp: 0.00015,          // kg, fly plate
  c: 0.05,              // N s/m, stem damping
  cp: 0.004,            // N s/m, plate damping (air)
  feltK: 9e4,           // N/m, bottom felt
  feltC: 16,            // N s/m
  C0: 1,                // pad capacitance seated, normalised
  y0: 0.0001,           // m, the capacitance falls as the plate lifts: C = C0 / (1 + y / y0)
};
const FORCE_CLASS = { 64: 1.36, 65: 1.18 };            // space bar, ENTER; wide keys 1.18; the rest 1.0
const LOCK = 37, SHIFTS = [50, 62];

export class KeyboardMech {
  constructor() {
    this.n = KEYS.length;
    this.pos = Int32Array.from(KEYS, (k) => k.pos);
    this.index = new Map(KEYS.map((k, i) => [k.pos, i]));
    this.scale = Float64Array.from(KEYS, (k) => FORCE_CLASS[k.pos] ?? (k.w >= 1.5 ? 1.18 : 1));
    this.x = new Float64Array(this.n); this.v = new Float64Array(this.n);
    this.y = new Float64Array(this.n); this.vy = new Float64Array(this.n);
    this.force = new Float64Array(this.n);     // finger force on each stem, N, set by the host each substep
    this.awake = new Uint8Array(this.n);
    this.lockLatched = false;
    this.P = P;
  }

  /** Wakes a key whose input changed. */
  wake(i) { this.awake[i] = 1; }

  /** Applies a finger force (N, down positive) to key index i until changed. */
  setForce(i, f) { if (this.force[i] !== f) { this.force[i] = f; this.awake[i] = 1; } }

  /** The pad capacitance of key i, normalised to C0: what the scanner reads. */
  capacitance(i) { return P.C0 / (1 + this.y[i] / P.y0); }

  step(h) {
    const { x, v, y, vy, force } = this;
    const lockI = this.index.get(LOCK);
    // LOCK has no return spring: a detent holds it down, and either SHIFT going down releases it (HW 2.2).
    if (this.lockLatched && SHIFTS.some((p) => this.x[this.index.get(p)] > P.xc)) { this.lockLatched = false; this.awake[lockI] = 1; }
    for (let i = 0; i < this.n; i++) {
      if (!this.awake[i]) continue;
      const s = this.scale[i];
      let spring = (P.F0 + P.k * x[i]) * s;
      if (i === lockI) {
        if (x[i] > P.travel * 0.85) this.lockLatched = true;
        if (this.lockLatched) spring = Math.max(0, (x[i] - P.travel * 0.8) * P.k * 4);   // held in the detent
        else spring = 0.12 + P.k * 0.4 * x[i];
      }
      let f = force[i] - spring + P.Kt * (y[i] - P.Y / 2) - P.c * v[i];
      const pen = x[i] - P.travel;
      if (pen > 0) f -= P.feltK * pen + P.feltC * Math.max(0, v[i]);
      v[i] += (f / P.ms) * h;
      x[i] += v[i] * h;
      if (x[i] < 0) { x[i] = 0; if (v[i] < 0) v[i] = 0; }          // the top stop
      // The plate: driven by the toggle spring through the stem, snapping between pad and lift stop.
      const fp = P.Kt * (x[i] - P.xc) + P.A * (y[i] - P.Y / 2) - P.cp * vy[i];
      const seated = y[i] <= 0 && fp <= 0, lifted = y[i] >= P.Y && fp >= 0;
      if (seated || lifted) { vy[i] = 0; y[i] = seated ? 0 : P.Y; }
      else { vy[i] += (fp / P.mp) * h; y[i] += vy[i] * h; if (y[i] < 0) { y[i] = 0; vy[i] = 0; } if (y[i] > P.Y) { y[i] = P.Y; vy[i] = 0; } }
      // Asleep at rest: no finger, stem on its stop or held in the LOCK detent, plate on a stop.
      const restingStem = (x[i] === 0 || (i === lockI && this.lockLatched && Math.abs(v[i]) < 1e-6)) && v[i] === 0;
      if (force[i] === 0 && restingStem && vy[i] === 0) this.awake[i] = 0;
    }
  }

  exportState() { return { x: [...this.x], v: [...this.v], y: [...this.y], vy: [...this.vy], lockLatched: this.lockLatched }; }
  importState(s) {
    this.x.set(s.x); this.v.set(s.v); this.y.set(s.y); this.vy.set(s.vy); this.lockLatched = s.lockLatched;
    this.awake.fill(1);
  }
}
