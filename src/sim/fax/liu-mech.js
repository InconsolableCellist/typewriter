// The TEL/LIU board's moving parts (docs/fax/architecture.md 3.5; docs/fax/hardware.md 6): the line relay and the hook
// switch. The board has ONE relay, CML, the line connecting and dial pulse relay [S p.5-10/pdf61]; the handset is
// switched by analogue gates (TELMUTE), not a relay. The relay is a clapper armature: its coil's current lags its drive, its pull grows as the gap closes, a spring
// returns it, and its contact makes near the end of its travel, so pull-in and drop-out have their real delays and
// clicks. The hook switch sits on the TEL/LIU PWB, worked by the hook switch lever under the handset rest [S p.3-3,
// p.3-12]; modelled as a plunger: the handset's weight holds it down; lifted, its spring brings it up and the contact
// changes over. A finger on the plunger (a DOF) does what it did on the real one.
//
// The line loop is closed when the hook switch is off hook or the machine's line relay (CML) is made: that is what
// the exchange sees (lineLoop(); src/fax/line/ reads it through the firmware, M7).
import { FAC } from './ports.js';

const SLEEP_FRAMES = 384;
export const RELAYS = ['cml'];

export class LiuMech {
  /** sim: the host; def: machine.mech.liu. The handset starts on its cradle. */
  constructor(sim, def) {
    this.sim = sim; this.def = def;
    this.rel = RELAYS.map((name) => ({ name, d: def.relays[name], cmd: 0, i: 0, x: 0, v: 0, made: false, onStop: 0 }));
    const H = def.hook;
    this.onCradle = true;
    this.hx = H.travel; this.hv = 0; this.finger = 0; this.hookStop = 1;
    this.awake = true; this.quiet = 0;
  }

  wake() { this.awake = true; this.quiet = 0; }

  /** The controller's drive: relay `name`'s coil current (units of its rated current). */
  setRelay(name, amps) { const r = this.rel[RELAYS.indexOf(name)]; if (r && r.cmd !== amps) { r.cmd = amps; this.wake(); } }
  relayMade(name) { return this.rel[RELAYS.indexOf(name)]?.made ?? false; }
  /** The hook switch's contact: on hook (true) while the plunger is held down. */
  hookOn() { return this.hx > this.def.hook.make; }
  /** The subscriber loop: closed by the handset off hook or by the line relay. */
  lineLoop() { return !this.hookOn() || this.relayMade('cml'); }

  /** The handset lifted off its cradle, or put back on it. */
  setHandset(on) { if (on !== this.onCradle) { this.onCradle = on; this.wake(); } }

  registerDofs(inputs) {
    inputs.register('hook', {
      n: 1, pos: () => this.hx, vel: () => this.hv, inertia: () => this.def.hook.mass,
      apply: (_i, f) => { this.finger += f; }, wake: () => this.wake(), k: 400, c: 1, maxF: 4, hardMax: 10, vHand: 0.3,
    });
  }

  step(h) {
    if (!this.awake) return;
    let moving = false;
    for (let k = 0; k < this.rel.length; k++) {
      const r = this.rel[k], d = r.d;
      r.i += ((r.cmd - r.i) * h) / d.tauE;
      if (Math.abs(r.i - r.cmd) < 1e-9) r.i = r.cmd;
      const gap = d.gap0 + d.travel - r.x;
      let F = (d.force * r.i * r.i) / (gap * gap) - d.preload - d.rate * r.x;
      let stop = 0;
      if (r.x < 0) stop = -d.stopStiffness * r.x - d.stopDamping * Math.min(0, r.v);
      else if (r.x > d.travel) stop = -d.stopStiffness * (r.x - d.travel) - d.stopDamping * Math.max(0, r.v);
      F += stop;
      const side = r.x > d.travel ? 1 : r.x < 0 ? -1 : 0;
      if (side !== 0 && side !== r.onStop) this.sim.ac(this.sim.t, FAC.RELAY, k + (side < 0 ? 8 : 0), Math.abs(r.v));
      r.onStop = side;
      r.v += (h * F) / d.mass;
      r.x += r.v * h;
      r.made = r.x > d.make * d.travel;
      if (Math.abs(r.v) > 1e-7 || r.i !== r.cmd) moving = true;
    }
    // The plunger: its spring pushes it up (x falls), the handset's weight and a finger push it down.
    const H = this.def.hook;
    let F = -(H.preload + H.rate * this.hx) - H.damping * this.hv + this.finger;
    let m = H.mass;
    if (this.onCradle) { F += H.handsetMass * 9.81; m += H.handsetMass; }
    let side = 0;
    if (this.hx > H.travel) { F += -H.stopStiffness * (this.hx - H.travel) - H.stopDamping * Math.max(0, this.hv); side = 1; }
    else if (this.hx < 0) { F += -H.stopStiffness * this.hx - H.stopDamping * Math.min(0, this.hv); side = -1; }
    if (side !== 0 && side !== this.hookStop) this.sim.ac(this.sim.t, FAC.HOOK, side > 0 ? 1 : 0, Math.abs(this.hv));
    if (side !== 0) this.hookStop = side;
    else if (this.hx > 0.1 * H.travel && this.hx < 0.9 * H.travel) this.hookStop = 0;
    this.hv += (h * F) / m;
    this.hx += this.hv * h;
    this.finger = 0;
    if (Math.abs(this.hv) > 1e-6) moving = true;
    if (moving) this.quiet = 0; else if (++this.quiet > SLEEP_FRAMES) this.awake = false;
  }

  exportState() {
    return { rel: this.rel.map(({ cmd, i, x, v, made, onStop }) => ({ cmd, i, x, v, made, onStop })), onCradle: this.onCradle,
      hx: this.hx, hv: this.hv, hookStop: this.hookStop, awake: this.awake, quiet: this.quiet };
  }
  importState(s) {
    s.rel.forEach((r, k) => Object.assign(this.rel[k], r));
    Object.assign(this, { onCradle: s.onCradle, hx: s.hx, hv: s.hv, hookStop: s.hookStop, awake: s.awake, quiet: s.quiet });
  }
}
