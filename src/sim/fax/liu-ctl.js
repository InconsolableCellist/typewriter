// The line interface's firmware (docs/fax/architecture.md 3.7): it switches the relays' coils and watches the hook
// switch, reporting the handset lifted or put down once the contact has been steady for the debounce time. It never
// writes a mechanical state: its only outputs are the relays' coil currents.

// A deep copy for exportState/importState (no structuredClone in the audio thread).
const clone = (v) => (v === null || typeof v !== 'object' ? v : ArrayBuffer.isView(v) ? v.slice()
  : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])])));

const INF = Infinity;

export class LiuCtl {
  /** def: machine.mech.liu; io: { setRelay(name, amps), hookOn() }; emit(event) sends a device event. */
  constructor(def, io, emit, { t = 0 } = {}) {
    this.def = def; this.io = io; this.emit = emit;
    this.coils = Object.fromEntries(Object.keys(def.relays).map((n) => [n, 0]));
    for (const n of Object.keys(this.coils)) io.setRelay(n, 0);
    this.offHook = !io.hookOn(); this.since = -INF;
    this.pollT = t + def.pollPeriod;
    this.nextT = this.pollT;
  }

  /** { op: 'relay', name: 'cml' | 'tel', on }. */
  command(m) {
    if (m.op === 'relay' && m.name in this.coils) { this.coils[m.name] = m.on ? 1 : 0; this.io.setRelay(m.name, this.coils[m.name]); }
  }

  service(t) {
    if (t >= this.pollT) {
      const off = !this.io.hookOn();
      if (off === this.offHook) this.since = -INF;
      else if (this.since === -INF) this.since = t;
      else if (t - this.since >= this.def.debounce) { this.offHook = off; this.since = -INF; this.emit({ dev: 'liu', ev: 'hook', offHook: off, t }); }
      this.pollT = t + this.def.pollPeriod;
    }
    this.nextT = this.pollT;
  }

  exportState() { return clone({ coils: this.coils, offHook: this.offHook, since: this.since, pollT: this.pollT, nextT: this.nextT }); }
  importState(s) { Object.assign(this, clone(s)); for (const [n, a] of Object.entries(this.coils)) this.io.setRelay(n, a); }
}
