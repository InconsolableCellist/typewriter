// The table the machine stands on, as one lateral mass on a spring. The carrier's momentum changes are the only input:
// whatever the carrier gains or loses, the table takes up with the opposite sign. Sampling them at the frame rate is
// exact, because a change of momentum over a frame does not depend on how sharp the stop inside it was.
export class DeskSway {
  /** @param p {mass kg, frequencyHz, dampingRatio}; carrierMass in kg */
  constructor(p, carrierMass) {
    this.massRatio = carrierMass / p.mass;
    this.omega = 2 * Math.PI * p.frequencyHz;
    this.zeta = p.dampingRatio;
    this.x = 0; this.v = 0; this.dv = 0; this.accel = 0;
    this.carrierV = null;
  }

  /** @param carrierV the carrier's world velocity along the platen, m/s */
  update(dt, carrierV) {
    if (!(dt > 0)) return;
    const prev = this.carrierV ?? carrierV;
    this.carrierV = carrierV;
    const v0 = this.v;
    this.v -= this.massRatio * (carrierV - prev);
    const N = 6, h = dt / N, w = this.omega, c = 2 * this.zeta * w;
    for (let i = 0; i < N; i++) { this.v += (-w * w * this.x - c * this.v) * h; this.x += this.v * h; }
    this.dv = this.v - v0;
    this.accel = this.dv / dt;
  }
}
