// Main thread: tells the audio side how fast the paper is moving, from the soft body itself.
const STEP = 7;   // sampling stride over the sheet vertices: rustle follows gross motion, not every vertex

export class PaperSoundTracker {
  constructor(sim) { this.sim = sim; this.prev = null; this.sent = -1; }

  update(dt, soft) {
    const pos = soft?.paper?.positions;
    if (!pos || dt <= 0) return;
    if (!this.prev || this.prev.length !== pos.length) { this.prev = pos.slice(); return; }
    let sum = 0, n = 0;
    for (let i = 0; i < pos.length; i += 3 * STEP) {
      const dx = pos[i] - this.prev[i], dy = pos[i + 1] - this.prev[i + 1], dz = pos[i + 2] - this.prev[i + 2];
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz); n++;
      this.prev[i] = pos[i]; this.prev[i + 1] = pos[i + 1]; this.prev[i + 2] = pos[i + 2];
    }
    const v = n ? sum / n / dt : 0;
    if (Math.abs(v - this.sent) > 0.002 || (v === 0 && this.sent !== 0)) { this.sim.setPaperSpeed?.(v); this.sent = v; }
  }
}
