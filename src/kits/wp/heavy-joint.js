// A heavy, stiff joint for the display's tilt and swivel (architecture.md 3.6): the hand pulls the cabinet through a
// soft spring; the cabinet has mass, a static friction it must be pulled past before it moves at all, a lower sliding
// friction once it does, and viscous drag. Moving slowly it sticks and slips, and each slip is a creak of the plastic
// bearing. Pure arithmetic, tested in Node (tests/wp_controls.test.js).

/** Per unit inertia: the hand spring (1/s^2), the drag (1/s), static and sliding friction (as rad of spring stretch). */
export const JOINT = { k: 70, c: 11, stick: 0.075, slide: 0.045, stopRestitution: 0.15 };

/**
 * One axis. `limits` [min, max] rad. step(dt) advances; `hand` is where the hand pulls to (set while dragging, null when
 * let go). onCreak(strength 0..1, speed) is called at each break-away and at stick-slip slips; onStop(speed) at a stop.
 */
export class HeavyJoint {
  constructor(angle, limits, { onCreak = () => {}, onStop = () => {}, params = JOINT } = {}) {
    this.a = angle; this.v = 0; this.limits = limits; this.p = params;
    this.hand = null; this.stuck = true;
    this.onCreak = onCreak; this.onStop = onStop;
    this.slipT = 0;
  }

  /** The hand pulls by `d` rad more (a drag); the first pull starts from where the cabinet is. */
  pull(d) {
    const [lo, hi] = this.limits;
    if (this.hand === null) this.hand = this.a;
    this.hand = Math.min(hi + 0.05, Math.max(lo - 0.05, this.hand + d));
  }

  letGo() { this.hand = null; }

  step(dt) {
    const p = this.p, n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
    for (let i = 0; i < n; i++) this.sub(h, p);
  }

  sub(h, p) {
    const F = this.hand === null ? 0 : p.k * (this.hand - this.a);
    if (this.stuck) {
      if (Math.abs(F) <= p.k * p.stick) return;
      // Break-away: the stored stretch lets go at once, with a creak as loud as the pull was hard.
      this.stuck = false;
      this.onCreak(Math.min(1, Math.abs(F) / (p.k * p.stick * 2.2)), 0);
    }
    const fk = p.k * p.slide * Math.sign(this.v || F);
    const v0 = this.v;
    this.v += (F - fk - p.c * this.v) * h;
    // Friction cannot reverse the motion: where the speed would change sign it sticks again.
    if (v0 !== 0 && Math.sign(this.v) !== Math.sign(v0) && Math.abs(F) <= p.k * p.stick) { this.v = 0; this.stuck = true; return; }
    this.a += this.v * h;
    const [lo, hi] = this.limits;
    if (this.a < lo || this.a > hi) {
      this.a = Math.min(hi, Math.max(lo, this.a));
      if (Math.abs(this.v) > 0.02) this.onStop(Math.abs(this.v));
      this.v = -this.v * p.stopRestitution;
      if (Math.abs(this.v) < 0.02) { this.v = 0; this.stuck = true; }
    }
    // Sliding slowly the bearing chatters: a small creak every so often, more often the faster it goes.
    const s = Math.abs(this.v);
    if (s > 0.004) {
      this.slipT += h * (8 + 60 * Math.min(1, s / 0.6));
      if (this.slipT >= 1) { this.slipT -= 1 + Math.random() * 0.6; this.onCreak(0.25 + 0.5 * Math.min(1, s / 0.5), s); }
    }
  }
}
