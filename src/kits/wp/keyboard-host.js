// The keyboard's mechanism and processor on the main thread (architecture 5), until the word processor's mechanism
// host runs them on the audio thread. Finger changes are time-stamped and applied at their own mechanism time, so a
// tap shorter than a frame still moves the key the right way, however slowly frames come.
import { KeyboardMech } from '../../sim/wp/keyboard-mech.js';
import { KeyboardCtl } from '../../sim/wp/keyboard-ctl.js';

const H = 1 / 384000;
const MAX_LAG = 1;        // s of mechanism time caught up in one frame at most; a tab left in the background does not replay minutes

export class KeyboardHost {
  /** onScan(event) receives each scan byte the processor sends; the system acknowledges by return. now() is the clock. */
  constructor(onScan, now) {
    this.mech = new KeyboardMech();
    this.ctl = new KeyboardCtl(this.mech, (e) => { onScan(e); this.ctl.command({ op: 'ack' }, this.t); });
    this.now = now;
    this.t = 0;
    this.queue = [];      // { t, i, f }, in time order
  }

  press(i, force) { this.queue.push({ t: Math.max(this.now(), this.queue.at(-1)?.t ?? 0), i, f: force }); }

  advance(t) {
    if (t - this.t > MAX_LAG) {
      const start = t - MAX_LAG;
      const late = this.queue.length ? start - this.queue[0].t : 0;
      if (late > 0) for (const q of this.queue) q.t += late;   // pending presses move as a block, keeping their spacing
      this.t = start;
    }
    while (this.t < t) {
      while (this.queue.length && this.queue[0].t <= this.t) { const q = this.queue.shift(); this.mech.setForce(q.i, q.f); }
      if (!this.mech.awake.some((a) => a)) {
        // Nothing moving: jump to the next finger change, running only the processor's scans and timers.
        const next = Math.min(t, this.queue[0]?.t ?? t);
        this.ctl.advance(next); this.t = next;
        if (next === t) break;
        continue;
      }
      const end = Math.min(t, this.queue[0]?.t ?? t);
      while (this.t + H <= end + 1e-12) { this.mech.step(H); this.t += H; this.ctl.advance(this.t); }
      if (this.t + H > end && end === t) { this.t = t; break; }
      if (this.t < end) this.t = end;
    }
  }
}
