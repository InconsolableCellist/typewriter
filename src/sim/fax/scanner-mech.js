// The scanner frame's document path (docs/fax/architecture.md 3.2; plan 2): the document table holding up to five
// sheets face down, the separation roller on its one-way clutch against the separation pad, the document sensor in
// the table and the registration sensor after the nip, the feed roller pressing the sheet on the contact image
// sensor's glass. Each sheet is a rigid lamina moving along the path (its position is its leading edge, in m from the
// separation nip); its skew and side offset are as it was laid, carried for the scanner. Rollers move it only through
// friction at their nips (friction.js), so a sheet held back by a hand slips, and one pulled runs ahead.
import { FAC } from './ports.js';
import { nipForce, drag } from './friction.js';

const SLEEP_FRAMES = 384;

export class ScannerMech {
  /** sim: the host; def: machine.mech.feeder. */
  constructor(sim, def) {
    this.sim = sim; this.def = def;
    this.tray = [];             // sheets waiting on the table, the bottom one (fed first) first
    this.moving = [];           // sheets in the path, the one furthest along first
    this.nOut = 0;
    this.hand = 0;              // hand force on the first moving sheet this substep (N)
    this.awake = false; this.quiet = 0;
  }

  wake() { this.awake = true; this.quiet = 0; }

  /** Lay sheets on the table: [{ id, length, width, skew, offset, faceDown }] (m, rad). Returns how many it took. */
  load(sheets) {
    const D = this.def, room = D.capacity - this.tray.length;
    const took = sheets.slice(0, Math.max(0, room)).map((s, i) => ({
      id: s.id ?? `doc${this.nOut + this.tray.length + i}`, length: s.length ?? D.sheet.length, width: s.width ?? D.sheet.width,
      skew: s.skew ?? 0, offset: s.offset ?? 0, faceDown: s.faceDown !== false, grammage: s.grammage ?? D.sheet.grammage,
    }));
    this.tray.push(...took);
    this.wake();
    return took.length;
  }

  /** Take the waiting sheets off the table (not those already in the path). */
  unload() { const n = this.tray.length; this.tray.length = 0; this.wake(); return n; }

  // ---- sensors -----------------------------------------------------------------------------------------------------
  covers(sh, at) { return sh.s >= at && sh.s - sh.length < at; }
  /** The document sensor's lever in the table: a sheet lies over it. */
  docSensor() { return this.tray.length > 0 || this.moving.some((sh) => this.covers(sh, this.def.path.docSensor)); }
  /** The registration sensor after the separation nip. */
  regSensor() { return this.moving.some((sh) => this.covers(sh, this.def.path.regSensor)); }

  /**
   * Where the contact image sensor's line falls on the document now (the scanner's input, architecture.md 4.2): the
   * sheet under it and the distance from that sheet's leading edge (m), as it was laid (skew, offset, face down), and
   * its lift off the glass (0: the feed roller presses it flat). Null when no sheet is over the line.
   */
  scanLine() {
    const at = this.def.path.readLine;
    for (const sh of this.moving) {
      if (this.covers(sh, at)) return { id: sh.id, y: sh.s - at, length: sh.length, width: sh.width, skew: sh.skew, offset: sh.offset, faceDown: sh.faceDown, lift: 0, speed: sh.v };
    }
    return null;
  }

  // ---- hands -------------------------------------------------------------------------------------------------------
  /** The first sheet in the path, or the bottom one on the table brought to the nip, for a hand to take. */
  first() {
    if (!this.moving.length && this.tray.length) this.enter();
    return this.moving[0] ?? null;
  }

  enter() {
    const sh = this.tray.shift();
    sh.s = this.def.path.separation; sh.v = 0; sh.m = sh.grammage * sh.width * sh.length; sh.picked = false;
    this.moving.push(sh);
  }

  registerDofs(inputs) {
    inputs.register('document', {
      n: 1, pos: () => this.first()?.s ?? 0, vel: () => this.moving[0]?.v ?? 0, inertia: () => this.first()?.m ?? 0.005,
      apply: (_i, f) => { this.hand += f; }, wake: () => this.wake(), k: 200, c: 2, maxF: 3, hardMax: 8, vHand: 0.5,
    });
  }

  /**
   * One substep against the scanning train (drive-mech.js; t: { d, w, To }). Returns the torque the sheets put on the
   * train's rollers, which the drive integrates.
   */
  step(h, t) {
    const D = this.def, P = D.path;
    // The next sheet on the table meets the separation roller once the one before has left the nip.
    if (this.tray.length && !this.moving.some((sh) => sh.s - sh.length < P.separation)) this.enter();
    let To = t.To, nip = 0, moving = false;
    for (let i = 0; i < this.moving.length; i++) {
      const sh = this.moving[i];
      let Fo = i === 0 ? this.hand : 0, R = 0, Fmax = 0, oneWay = false;
      const atFeed = this.covers(sh, P.feed), atSep = sh.s - sh.length < P.separation;
      if (atFeed) { R = D.feedRadius; Fmax = D.rollerMu * D.feedForce; Fo += drag(sh.v, D.glassMu * D.feedForce, D.slipSpeed); }
      // The separation roller's surface speed is separationSpeed of the feed roller's: its effective radius on the shaft.
      else if (atSep) { R = D.feedRadius * D.separationSpeed; Fmax = D.rollerMu * D.separationForce; oneWay = true; }
      if (atSep) Fo += drag(sh.v, D.padMu * D.padForce, D.slipSpeed);
      if (!atFeed && !atSep) Fo += drag(sh.v, 0.02, D.slipSpeed);    // loose on the exit guide
      const F = R > 0 ? nipForce(h, t.d.inertia, t.w, To, R, sh.m, sh.v, Fo, Fmax, oneWay) : 0;
      To -= F * R; nip += F * R;
      const v0 = sh.v;
      sh.v += (h * (Fo + F)) / sh.m;
      sh.s += sh.v * h;
      if (!sh.picked && sh.s > P.separation + 0.002) { sh.picked = true; this.sim.ac(this.sim.t, FAC.PICK, 0, sh.v); }
      if (Math.abs(sh.v) > 1e-6 || Math.abs(v0) > 1e-6) moving = true;
    }
    this.hand = 0;
    // A sheet whose trailing edge has passed the feed roller has left the machine.
    while (this.moving.length && this.moving[0].s - this.moving[0].length >= P.feed) {
      const sh = this.moving.shift();
      this.nOut++;
      this.sim.ac(this.sim.t, FAC.SHEET_OUT, 0, sh.v);
      this.sim.emitEvent({ type: 'device', dev: 'feeder', ev: 'out', id: sh.id });
    }
    if (moving) this.quiet = 0; else if (++this.quiet > SLEEP_FRAMES) this.awake = false;
    return nip;
  }

  exportState() {
    return { tray: this.tray.map((s) => ({ ...s })), moving: this.moving.map((s) => ({ ...s })), nOut: this.nOut, awake: this.awake, quiet: this.quiet };
  }

  importState(s) {
    this.tray = s.tray.map((x) => ({ ...x })); this.moving = s.moving.map((x) => ({ ...x }));
    this.nOut = s.nOut; this.awake = s.awake; this.quiet = s.quiet;
  }
}
