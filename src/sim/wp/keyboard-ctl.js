// The keyboard's own microprocessor (docs/displaywriter/architecture.md 5.2, 5.4): scans the pads, makes scan bytes,
// times typematic repeats, buffers four bytes, sends them one at a time over the link, and drives the speaker for
// the click and the beep. It only reads capacitances; it never moves a key.
import { KEYS } from '../../machine/wp-keys.js';

const VISIT = 52e-6;                 // s per matrix position (96 positions: a 5 ms pass; assumed)
const MATRIX = 96;
const DOWN = 0.45, UP = 0.60;        // C / C0 thresholds
const TYPEMATIC_DELAY = 0.350, TYPEMATIC_PERIOD = 1 / 14;
const BUFFER = 4, OVERRUN = 0x7f;
const LINK_BYTE = 0.001;             // s per byte on the serial link (assumed)
const CLICK = 0.0005;                // s, the click pulse
const TONE_HZ = 1000;

export class KeyboardCtl {
  /** emit(event) receives { type: 'device', dev: 'kbd', ev: 'scan', byte, t }. */
  constructor(mech, emit) {
    this.mech = mech; this.emit = emit;
    this.makeBreak = new Uint8Array(mech.n);
    KEYS.forEach((k, i) => { if (k.mark === 'M') this.makeBreak[i] = 1; });
    this.down = new Uint8Array(mech.n);
    this.slot = Int32Array.from(KEYS, (k) => k.pos - 1);          // matrix position of each key
    this.keyAt = new Int32Array(MATRIX).fill(-1);
    this.slot.forEach((s, i) => { this.keyAt[s] = i; });
    this.nextVisit = 0; this.cursor = 0;
    this.typematic = -1; this.typematicAt = 0;
    this.buffer = []; this.linkFreeAt = 0; this.awaitAck = false;
    this.clickUntil = -1; this.toneUntil = -1;
  }

  /** Runs everything due by time t (s). Called each substep; cheap when nothing is due. */
  advance(t) {
    while (t >= this.nextVisit) {
      const i = this.keyAt[this.cursor];
      if (i >= 0) this._visit(i, this.nextVisit);
      this.cursor = (this.cursor + 1) % MATRIX;
      this.nextVisit += VISIT;
    }
    if (this.typematic >= 0 && t >= this.typematicAt) {
      this._queue(this.mech.pos[this.typematic] | 0x80);
      this.typematicAt += TYPEMATIC_PERIOD;
    }
    if (this.buffer.length && !this.awaitAck && t >= this.linkFreeAt) {
      const byte = this.buffer.shift();
      this.awaitAck = true;
      this.linkFreeAt = t + LINK_BYTE;
      this.emit({ type: 'device', dev: 'kbd', ev: 'scan', byte, t });
    }
  }

  _visit(i, t) {
    const c = this.mech.capacitance(i);
    if (!this.down[i] && c < DOWN) {
      this.down[i] = 1;
      this._queue(this.mech.pos[i]);
      if (!this.makeBreak[i]) { this.typematic = i; this.typematicAt = t + TYPEMATIC_DELAY; }
    } else if (this.down[i] && c > UP) {
      this.down[i] = 0;
      if (this.makeBreak[i]) this._queue(this.mech.pos[i] | 0x80);
      if (this.typematic === i) this.typematic = -1;
    }
  }

  _queue(byte) {
    if (this.buffer.length < BUFFER) this.buffer.push(byte);
    else this.buffer[BUFFER - 1] = OVERRUN;
  }

  /** Commands from the system: { op: 'ack' | 'click' | 'tone', ms }. */
  command(m, t) {
    if (m.op === 'ack') this.awaitAck = false;
    else if (m.op === 'click') this.clickUntil = t + CLICK;
    else if (m.op === 'tone') this.toneUntil = t + (m.ms ?? 60) / 1000;
  }

  /** The speaker drive at time t, -1..1: the click pulse, or the 1 kHz square wave while a tone is gated on. */
  speaker(t) {
    if (t < this.clickUntil) return 1;
    if (t < this.toneUntil) return (t * TONE_HZ) % 1 < 0.5 ? 1 : -1;
    return 0;
  }

  exportState() {
    return { down: [...this.down], nextVisit: this.nextVisit, cursor: this.cursor, typematic: this.typematic, typematicAt: this.typematicAt,
      buffer: [...this.buffer], linkFreeAt: this.linkFreeAt, awaitAck: this.awaitAck, clickUntil: this.clickUntil, toneUntil: this.toneUntil };
  }
  importState(s) { this.down.set(s.down); Object.assign(this, { ...s, down: this.down }); }
}
