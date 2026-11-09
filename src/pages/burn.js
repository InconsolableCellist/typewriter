// A sheet touched to the ember catches, and a front eats across it in its own (u, v) until nothing is left.
// Bookkeeping only: the shader that draws the front is in render/paper-view.js. No browser objects here, so it runs under node.

export const BURN_CATCH_M = 0.008;       // m from the ember at which a sheet catches
export const BURN_SECONDS = 5;           // s for the front to reach the farthest corner
const CHECK_INTERVAL_S = 1 / 12;         // the proximity test runs at this rate, and only while the sheet is held

/** Index of a particle of the cloth within radius of point, or -1. */
export function particleNear({ x, y, z, n }, point, radius = BURN_CATCH_M) {
  const r2 = radius * radius;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - point[0], dy = y[i] - point[1], dz = z[i] - point[2];
    if (dx * dx + dy * dy + dz * dz <= r2) return i;
  }
  return -1;
}

/** Sheet distance (m) from the point (u, v) to the farthest corner. */
export function farthestCorner(u, v, width, height) {
  return Math.hypot(Math.max(u, 1 - u) * width, Math.max(v, 1 - v) * height);
}

const REACH_MARGIN_M = 0.04;   // past the farthest corner, covering the irregular front and the char band

export class SheetBurn {
  /**
   * soft: the cloth (paperSim, sheetParked, sheetSerial). view: setBurn(u, v, radiusM).
   * ember: [x, y, z] in world metres. onDone runs when the sheet is gone.
   */
  constructor({ soft, view, ember, width = 0.216, height = 0.279, onDone }) {
    this.soft = soft; this.view = view; this.ember = ember; this.width = width; this.height = height; this.onDone = onDone;
    this.serial = soft.sheetSerial;
    this.active = false;
    this.t = 0; this.u = 0; this.v = 0; this.reach = 0; this.radius = 0;
    this.sinceCheck = 0;
  }

  ignite(u, v) {
    this.active = true;
    this.t = 0; this.u = u; this.v = v; this.radius = 0;
    this.reach = farthestCorner(u, v, this.width, this.height) + REACH_MARGIN_M;
    this.view.setBurn(u, v, 1e-4);
  }

  /** Drops any burn in progress and leaves the sheet whole. */
  cancel() {
    if (this.active || this.radius > 0) this.view.setBurn(0, 0, -1);
    this.active = false; this.radius = 0; this.t = 0;
  }

  update(dt) {
    if (this.soft.sheetSerial !== this.serial) {   // a new sheet arrived: whatever was burning has gone with the old one
      this.serial = this.soft.sheetSerial;
      this.cancel();
    }
    if (this.active) {
      this.t += dt;
      const f = Math.min(1, this.t / BURN_SECONDS);
      this.radius = this.reach * f ** 1.12;   // slow to take hold, then a steady creep
      this.view.setBurn(this.u, this.v, this.radius);
      if (f >= 1) {
        this.cancel();
        this.onDone?.();
        this.serial = this.soft.sheetSerial;
      }
      return;
    }
    this.sinceCheck += dt;
    if (this.sinceCheck < CHECK_INTERVAL_S) return;
    this.sinceCheck = 0;
    const sim = this.soft.paperSim;
    if (!sim || this.soft.sheetParked || !(sim.grabs?.size > 0)) return;
    const i = particleNear(sim, this.ember);
    if (i >= 0) this.ignite(sim.uvs[i * 2], sim.uvs[i * 2 + 1]);
  }
}
