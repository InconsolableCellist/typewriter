// The operation panel's key scan (docs/fax/architecture.md 3.7), as the Displaywriter's keyboard controller: every
// scan period it reads each key's contact, and a key that reads the same for `debounceScans` scans in a row is
// reported down or up. It only reads contacts; it never moves a key.

// A deep copy for exportState/importState (no structuredClone in the audio thread).
const clone = (v) => (v === null || typeof v !== 'object' ? v : ArrayBuffer.isView(v) ? v.slice()
  : Array.isArray(v) ? v.map(clone) : Object.fromEntries(Object.keys(v).map((k) => [k, clone(v[k])])));

export class PanelCtl {
  /** def: machine.mech.panel; io: { keyContact(i) }; emit(event) sends a device event. */
  constructor(def, io, emit, { t = 0 } = {}) {
    this.def = def; this.io = io; this.emit = emit;
    this.down = new Uint8Array(def.keys.length);
    this.count = new Uint8Array(def.keys.length);
    this.nextT = t + def.scanPeriod;
  }

  service(t) {
    const D = this.def;
    for (let i = 0; i < D.keys.length; i++) {
      const c = this.io.keyContact(i) ? 1 : 0;
      if (c === this.down[i]) { this.count[i] = 0; continue; }
      if (++this.count[i] >= D.debounceScans) {
        this.down[i] = c; this.count[i] = 0;
        this.emit({ dev: 'panel', ev: 'key', key: D.keys[i], down: !!c, t });
      }
    }
    this.nextT = t + D.scanPeriod;
  }

  exportState() { return clone({ down: this.down, count: this.count, nextT: this.nextT }); }
  importState(s) { this.down.set(s.down); this.count.set(s.count); this.nextT = s.nextT; }
}
