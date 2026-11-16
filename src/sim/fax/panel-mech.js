// The operation panel's keys (docs/fax/architecture.md 3.6; plan 2), as the Displaywriter's keyboard mechanism
// (src/sim/wp/keyboard-mech.js): each key a stem on a rubber dome. The dome's force rises, buckles and falls, then
// rises again as the carbon pill meets the board; the contact makes near the bottom. Nothing here decides that a key
// is "down": the panel controller reads the contacts.
import { FAC } from './ports.js';

export class PanelMech {
  /** sim: the host; def: machine.mech.panel. */
  constructor(sim, def) {
    this.sim = sim; this.def = def;
    this.n = def.keys.length;
    this.index = new Map(def.keys.map((k, i) => [k, i]));
    this.x = new Float64Array(this.n); this.v = new Float64Array(this.n);
    this.force = new Float64Array(this.n);      // finger force on each stem (N), held until changed
    this.hand = new Float64Array(this.n);       // grabs, this substep
    this.bottomed = new Uint8Array(this.n);
    this.awakeKeys = new Uint8Array(this.n);
    this.awake = false;
  }

  wake(i = -1) { this.awake = true; if (i >= 0) this.awakeKeys[i] = 1; else this.awakeKeys.fill(1); }

  /** A finger's force on key `key` (name or index), N, until changed; 0 lifts the finger. */
  setFinger(key, f) {
    const i = typeof key === 'number' ? key : this.index.get(key);
    if (i === undefined || i < 0 || i >= this.n) return;
    this.force[i] = f; this.wake(i);
  }

  /** The contact under key i: what the controller's matrix scan reads. */
  contact(i) { return this.x[i] > this.def.make; }

  registerDofs(inputs) {
    inputs.register('key', {
      n: this.n, pos: (i) => this.x[i], vel: (i) => this.v[i], inertia: () => this.def.mass,
      apply: (i, f) => { this.hand[i] += f; }, wake: (i) => this.wake(i), k: 600, c: 0.5, maxF: 4, hardMax: 8, vHand: 0.3,
    });
  }

  /** The dome's force at stem travel x, piecewise linear through the definition's table. */
  dome(x) {
    const t = this.def.dome;
    if (x <= t[0][0]) return t[0][1];
    for (let k = 1; k < t.length; k++) {
      if (x <= t[k][0]) { const [x0, f0] = t[k - 1], [x1, f1] = t[k]; return f0 + ((f1 - f0) * (x - x0)) / (x1 - x0); }
    }
    return t[t.length - 1][1];
  }

  step(h) {
    if (!this.awake) return;
    const D = this.def, { x, v } = this;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (!this.awakeKeys[i]) continue;
      let F = this.force[i] + this.hand[i] - this.dome(x[i]) - D.damping * v[i];
      this.hand[i] = 0;
      const pen = x[i] - D.travel;
      if (pen > 0) F -= D.bottomStiffness * pen + D.bottomDamping * Math.max(0, v[i]);
      v[i] += (h * F) / D.mass;
      x[i] += v[i] * h;
      if (pen <= 0 && x[i] > D.travel) { if (!this.bottomed[i]) this.sim.ac(this.sim.t, FAC.KEY, i, v[i]); this.bottomed[i] = 1; }
      if (x[i] < D.travel * 0.5) this.bottomed[i] = 0;
      if (x[i] < 0) { x[i] = 0; if (v[i] < 0) v[i] = 0; }            // the dome holds it up on the panel's underside
      if (this.force[i] === 0 && x[i] === 0 && v[i] === 0) this.awakeKeys[i] = 0; else any = true;
    }
    this.awake = any;
  }

  exportState() { return { x: [...this.x], v: [...this.v], force: [...this.force], bottomed: [...this.bottomed] }; }
  importState(s) { this.x.set(s.x); this.v.set(s.v); this.force.set(s.force); this.bottomed.set(s.bottomed); this.wake(); }
}
