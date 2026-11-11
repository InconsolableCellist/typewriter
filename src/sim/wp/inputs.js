// Hand inputs of the word processor's mechanism host, shared by every body. A grab is a virtual spring-damper on a
// named DOF, clamped to what a hand can exert and fading out at the hand's top speed, exactly as in MechanicalSim.
// Bodies register their grabbable DOFs; a grab only ever adds a force. Fingers on the keyboard arrive with it.

const GRAB_MAX = 32;

export class Inputs {
  constructor(h) {
    this.h = h;
    this.dofs = new Map();
    this.list = [];            // active grabs
    this.nextId = 1;
    this.workExt = 0;          // work done by hands, for conservation checks
  }

  /**
   * dof = { n, pos(i), vel(i), inertia(i), apply(i, f), wake(i), k, c, maxF, hardMax, vHand }, units of the DOF
   * (m and N, or rad and N m).
   */
  register(name, dof) { this.dofs.set(name, dof); }

  grab(name, index = 0, { target, k, c, maxF } = {}) {
    const d = this.dofs.get(name);
    if (!d || index < 0 || index >= d.n || this.list.length >= GRAB_MAX) return -1;
    // Stability: the coupling stays well inside omega dt < 2 for the DOF's own inertia.
    const J = d.inertia(index), wMax = 0.25 / this.h;
    const g = {
      id: this.nextId++, d, index,
      target: Number.isFinite(target) ? target : d.pos(index),
      k: clamp(k ?? d.k, 0, J * wMax * wMax), c: clamp(c ?? d.c, 0, (0.3 * J) / this.h),
      maxF: clamp(maxF ?? d.maxF, 0, d.hardMax), vHand: d.vHand,
    };
    this.list.push(g);
    d.wake(index);
    return g.id;
  }

  moveGrab(id, target) {
    const g = this.list.find((x) => x.id === id);
    if (g && Number.isFinite(target)) { g.target = target; g.d.wake(g.index); }
  }

  release(id) { const i = this.list.findIndex((x) => x.id === id); if (i >= 0) this.list.splice(i, 1); }

  held(name, index) {
    for (const g of this.list) if (g.d === this.dofs.get(name) && g.index === index) return true;
    return false;
  }

  /** Apply every grab's force for this substep. */
  apply() {
    const h = this.h;
    for (const g of this.list) {
      const { d, index } = g;
      const x = d.pos(index), v = d.vel(index);
      let f = g.k * (g.target - x) - g.c * v;
      if (f > g.maxF) f = g.maxF; else if (f < -g.maxF) f = -g.maxF;
      const along = f > 0 ? v : -v;   // a hand cannot push faster than it can move
      if (along > g.vHand) f *= along > 2 * g.vHand ? 0 : 2 - along / g.vHand;
      this.workExt += f * v * h;
      d.wake(index);
      d.apply(index, f);
    }
  }
}

function clamp(v, lo, hi) { return !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v; }
