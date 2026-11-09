// Inked cloth ribbon: a rope with variable free length between two spools, passing two vertical
// guide posts and the vibrator fork at the print point. Spools are DOFs here; winding either changes
// the free length, so tension, slack and sag emerge. The full 5 m of the ribbon carries a 2D ink map.
const PX_PER_M = 6000;       // ink map resolution along the ribbon and across its width (6 px/mm)
const NODES = 72;
const SPOOL_SPRING_TRAVEL = 0.012;  // m of paid-out ribbon the supply spool's brake spring can take back
const TAUT_RELEASE_SLACK = 0.006;  // m of slack at which the rope hangs freely instead of lying on its taut path

export class RibbonSim {
  constructor(machine, geo) {
    const r = machine.ribbon;
    this.m = machine;
    this.geo = geo;
    this.W = r.width;
    this.N = NODES;
    const N = NODES;
    this.xr = new Float64Array(N); this.yr = new Float64Array(N); this.zr = new Float64Array(N);
    this.xp = new Float64Array(N); this.yp = new Float64Array(N); this.zp = new Float64Array(N);
    this.vx = new Float64Array(N); this.vy = new Float64Array(N); this.vz = new Float64Array(N);
    this.w = new Float64Array(N).fill(1);
    this.positions = new Float32Array(N * 3);
    this.up = new Float32Array(N * 3);
    // Spools: lengths of ribbon wound on each, so total = 5 m and the free span is what is left.
    this.Lon = [r.length * 0.94, 0.02];        // left (supply), right (take-up)
    this.phi = [0, 0];
    this.spoolL = { angle: 0, radius: r.spoolRadiusEmpty };
    this.spoolR = { angle: 0, radius: r.spoolRadiusEmpty };
    this.tension = 0;
    this.springBack = 0;
    this.takeUpSide = 1;
    this.pawlPrev = null;
    this.fedSinceStrike = 0;
    this.spoolGrab = [null, null];
    this.grabs = new Map();
    this.nextGrab = 1;

    this.pxPerM = PX_PER_M;
    this.mapW = Math.round(r.width * PX_PER_M);
    this.mapL = Math.round(r.length * PX_PER_M);
    this.ink = new Uint8Array(this.mapW * this.mapL).fill(255);

    this.T_up = [0, -geo.strikeDown[1], -geo.strikeDown[2]];   // tangent up along the platen at the print point
    this._initPath();
    this.windows = {};
  }

  _forkCenterRest() {
    const { geo, m } = this;
    const n = geo.printNormal, w = geo.strikeDown;
    const r = m.ribbon, d = r.vibrator.restDrop;
    return [geo.printPoint[0] + n[0] * r.standoff + w[0] * d,
      geo.printPoint[1] + n[1] * r.standoff + w[1] * d,
      geo.printPoint[2] + n[2] * r.standoff + w[2] * d];
  }

  _postZ() { const f = this._forkCenterRest(), r = this.m.ribbon; return f[2] + r.guidePostRadius + 0.0005 + (r.guidePostForward ?? 0); }

  _spoolCenter(side) { const r = this.m.ribbon; return [(side === 0 ? -1 : 1) * r.spoolX, r.spoolY, r.spoolZ]; }

  spoolRadius(side) {
    const r = this.m.ribbon;
    return Math.sqrt(r.spoolRadiusEmpty * r.spoolRadiusEmpty + (this.Lon[side] * r.thickness) / Math.PI);
  }

  /** Rim point where the ribbon leaves a spool, tangent toward the guide post. */
  _spoolRim(side) {
    const r = this.m.ribbon;
    const c = this._spoolCenter(side);
    const px = (side === 0 ? -1 : 1) * r.guidePostX, pz = this._postZ();
    const R = this.spoolRadius(side);
    const dx = px - c[0], dz = pz - c[2];
    const D = Math.hypot(dx, dz) || 1;
    const base = Math.atan2(dz, dx);
    const phi = Math.acos(Math.min(1, R / D));
    // The ribbon leaves on the side away from the typist (more -z): rotate toward -z.
    const sgn = side === 0 ? -1 : 1;
    const a = base + sgn * phi;
    return [c[0] + Math.cos(a) * R, c[1], c[2] + Math.sin(a) * R];
  }

  _initPath() {
    const { N } = this;
    const r = this.m.ribbon;
    const a = this._spoolRim(0), b = this._spoolRim(1);
    const f = this._forkCenterRest();
    const pz = this._postZ();
    const pL = [-r.guidePostX, f[1], pz - r.guidePostRadius - 0.0002];
    const pR = [r.guidePostX, f[1], pz - r.guidePostRadius - 0.0002];
    const wp = [a, pL, f, pR, b];
    const seg = [];
    let total = 0;
    for (let i = 0; i < wp.length - 1; i++) { const d = dist3(wp[i], wp[i + 1]); seg.push(d); total += d; }
    this.pathWay = wp;
    for (let i = 0; i < N; i++) {
      const s = (i / (N - 1)) * total;
      let acc = 0, k = 0;
      while (k < seg.length - 1 && acc + seg[k] < s) { acc += seg[k]; k++; }
      const f2 = seg[k] > 0 ? (s - acc) / seg[k] : 0;
      this.xr[i] = wp[k][0] + (wp[k + 1][0] - wp[k][0]) * f2;
      this.yr[i] = wp[k][1] + (wp[k + 1][1] - wp[k][1]) * f2;
      this.zr[i] = wp[k][2] + (wp[k + 1][2] - wp[k][2]) * f2;
    }
    // Threaded and taut: free length slightly short of the path, tension just under the supply brake.
    this.Lon[0] = r.length - total - this.Lon[1];
    const path = this._pathLength({ fork: f });
    const Tinit = 0.7 * r.spoolBrakeTorque / this.spoolRadius(0);
    this.Lf = path / (1 + Tinit / r.axialStiffness);
    this.Lon[0] = r.length - this.Lf - this.Lon[1];
    this.xp.set(this.xr); this.yp.set(this.yr); this.zp.set(this.zr);
    this.sync();
  }

  /** Material coordinate (m along the ribbon) of node i. */
  sAt(i) { return this.Lon[0] + (i / (this.N - 1)) * this.Lf; }

  // ---- substep
  substep(h, F) {
    const { N, xr: x, yr: y, zr: z, xp, yp, zp, vx, vy, vz, w, m } = this;
    const r = m.ribbon;
    // Pawl advances the take-up spool: ratchet action, only forward travel of the pawl winds it.
    if (this.pawlPrev === null) this.pawlPrev = F.pawlTravel;
    const dp = F.pawlTravel - this.pawlPrev;
    this.pawlPrev = F.pawlTravel;
    if (dp > 0) { this._wind(this.takeUpSide, dp * r.pawlFeedScale); this.fedSinceStrike += dp * r.pawlFeedScale; }

    for (let s = 0; s < 2; s++) {
      const gr = this.spoolGrab[s];
      if (!gr) continue;
      const R = this.spoolRadius(s);
      const dphi = Math.max(-0.05, Math.min(0.05, (gr.target - this.phi[s]) * 0.18));
      if (dphi !== 0) this._wind(s, dphi * R);
    }
    // Supply spool pays out against its brake when tension exceeds the brake.
    this._updateTension();
    const pay = 1 - this.takeUpSide;
    if (!this.spoolGrab[pay]) {
      const Tbrake = r.spoolBrakeTorque / this.spoolRadius(pay);
      if (this.tension > Tbrake) {
        // Pay out only down to the brake tension: a stiff tape overshoots to slack if the rate is applied unclamped.
        const toBrake = (this.pathLen + this._handDetour()) / (1 + Tbrake / r.axialStiffness) - this.Lf;
        const dl = Math.min((this.tension - Tbrake) * h / r.spoolDrag, toBrake, this.Lon[pay] - 0.001);
        if (dl > 0) {
          this.Lon[pay] -= dl; this.Lf += dl; this.phi[pay] -= dl / this.spoolRadius(pay);
          this.springBack = Math.min(SPOOL_SPRING_TRAVEL, this.springBack + dl);
        }
      } else if (this.springBack > 0 && this.Lf > this.pathLen) {
        // The brake's spring takes back the few millimetres the vibrator and shift borrowed, so a keystroke
        // leaves no slack. A hand drawing out more than this travel leaves real slack when it lets go.
        const dl = Math.min((this.Lf - this.pathLen) * 0.03, this.springBack);
        this.Lon[pay] += dl; this.Lf -= dl; this.phi[pay] += dl / this.spoolRadius(pay);
        this.springBack -= dl;
      }
    }
    if (this.Lf < 0.02) this.Lf = 0.02;

    const damp = Math.exp(-6 * h);
    const g = 9.81;
    const segRest = this.Lf / (N - 1);

    for (let i = 0; i < N; i++) {
      xp[i] = x[i]; yp[i] = y[i]; zp[i] = z[i];
      vy[i] = (vy[i] - g * h) * damp; vx[i] *= damp; vz[i] *= damp;
      x[i] += vx[i] * h; y[i] += vy[i] * h; z[i] += vz[i] * h;
    }

    // Endpoints ride the spool rims.
    const rimL = this._spoolRim(0), rimR = this._spoolRim(1);
    x[0] = rimL[0]; y[0] = rimL[1]; z[0] = rimL[2];
    x[N - 1] = rimR[0]; y[N - 1] = rimR[1]; z[N - 1] = rimR[2];
    w[0] = 0; w[N - 1] = 0;

    // Hand grabs drive their nodes.
    for (let i = 1; i < N - 1; i++) w[i] = 1;
    for (const gg of this.grabs.values()) {
      const i = gg.i;
      x[i] = gg.tx; y[i] = gg.ty; z[i] = gg.tz; w[i] = 0;
    }

    const iters = 8;
    const fork = F.fork; const T_up = this.T_up; const nrm = this.geo.printNormal;
    const postR = r.guidePostRadius + 0.0006, postZ = this._postZ();   // the margin keeps the rope's chords outside the drawn post
    const posts = [-r.guidePostX, r.guidePostX];
    for (let it = 0; it < iters; it++) {
      const fwd = it % 2 === 0;
      for (let k = 0; k < N - 1; k++) {
        const a = fwd ? k : N - 2 - k, b = a + 1;
        const wa = w[a], wb = w[b], ws = wa + wb;
        if (ws === 0) continue;
        const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-9) continue;
        const c = (d - segRest) / (d * ws);
        x[a] += wa * c * dx; y[a] += wa * c * dy; z[a] += wa * c * dz;
        x[b] -= wb * c * dx; y[b] -= wb * c * dy; z[b] -= wb * c * dz;
      }
      // Vibrator fork: shallow tines. A ribbon with several mm of slack does not stay seated in them and
      // hangs free; a taut ribbon within reach is carried by the fork.
      const catchC = r.forkCatch;
      const seatedOff = this.Lf - (this.pathLen ?? 0) > catchC.maxSlack;
      for (let i = 1; i < N - 1; i++) {
        if (w[i] === 0 || seatedOff) continue;
        if (Math.abs(x[i] - fork[0]) > catchC.halfWidth) continue;
        const d0 = y[i] - fork[1], d1 = z[i] - fork[2];
        const du = d0 * T_up[1] + d1 * T_up[2];
        if (du < -catchC.below || du > catchC.above) continue;
        const dn = d0 * nrm[1] + d1 * nrm[2];
        y[i] -= T_up[1] * du + nrm[1] * dn;
        z[i] -= T_up[2] * du + nrm[2] * dn;
      }
      // Guide posts (vertical cylinders).
      for (const px of posts) {
        for (let i = 1; i < N - 1; i++) {
          if (w[i] === 0) continue;
          const dx = x[i] - px, dz = z[i] - postZ;
          const d2 = dx * dx + dz * dz;
          if (d2 < postR * postR) {
            const d = Math.sqrt(d2) || 1e-6;
            x[i] = px + (dx / d) * postR; z[i] = postZ + (dz / d) * postR;
          }
        }
      }
    }

    this._settleTaut();

    // Update velocity.
    let sum = 0;
    for (let i = 0; i < N; i++) {
      vx[i] = (x[i] - xp[i]) / h; vy[i] = (y[i] - yp[i]) / h; vz[i] = (z[i] - zp[i]) / h;
      if (i > 0) sum += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1]);
    }
    this.polyLen = sum;
    this.pathLen = this._pathLength(F);
    this.segRest = segRest;
    this.fork = fork;
  }

  /**
   * A string under tension lies on its shortest path. The node chain cannot converge to that in a fixed iteration
   * budget and otherwise sits centimetres off it, so nodes are drawn to the taut path while there is little slack.
   */
  _settleTaut() {
    const wp = this.waypoints;
    if (!wp || !this.pathLen) return;
    const slack = this.Lf - this.pathLen;
    const taut = Math.max(0, Math.min(1, 1 - slack / TAUT_RELEASE_SLACK));
    if (taut === 0 || this._handDetour() > 0.0005) return;
    const { N, xr: x, yr: y, zr: z, w } = this;
    const gain = 0.25 * taut;
    let k = 0, acc = 0, segLen = dist3(wp[0], wp[1]);
    for (let i = 1; i < N - 1; i++) {
      const s = (i / (N - 1)) * this.pathLen;
      while (k < wp.length - 2 && s > acc + segLen) { acc += segLen; k++; segLen = dist3(wp[k], wp[k + 1]); }
      if (w[i] === 0) continue;
      const f = segLen > 0 ? (s - acc) / segLen : 0;
      x[i] += (wp[k][0] + (wp[k + 1][0] - wp[k][0]) * f - x[i]) * gain;
      y[i] += (wp[k][1] + (wp[k + 1][1] - wp[k][1]) * f - y[i]) * gain;
      z[i] += (wp[k][2] + (wp[k + 1][2] - wp[k][2]) * f - z[i]) * gain;
    }
  }

  _pathLength(F) {
    const rimL = this._spoolRim(0), rimR = this._spoolRim(1);
    const r = this.m.ribbon;
    const pz = this._postZ() - r.guidePostRadius - 0.0002;
    const f = F.fork;
    const pL = [-r.guidePostX, f[1], pz], pR = [r.guidePostX, f[1], pz];
    this.waypoints = [rimL, pL, f, pR, rimR];
    return dist3(rimL, pL) + dist3(pL, f) + dist3(f, pR) + dist3(pR, rimR);
  }

  _updateTension() {
    if (!this.pathLen || !this.Lf) return;
    // The taut span is the shortest path through the guide posts and fork. Solver stretch in the
    // node chain is not tension. A hand adds only the detour it forces, so simply holding the
    // ribbon where it already lies changes nothing.
    const strain = (this.pathLen + this._handDetour()) / this.Lf - 1;
    this.tension = strain > 0 ? strain * this.m.ribbon.axialStiffness : 0;
  }

  _handDetour() {
    let extra = 0;
    const wp = this.waypoints;
    if (!wp || !this.pathLen) return 0;
    for (const g of this.grabs.values()) {
      if (g.side !== undefined) continue;
      const H = [g.tx, g.ty, g.tz];
      let best = Infinity;
      for (let k = 0; k < wp.length - 1; k++) {
        const d = dist3(wp[k], H) + dist3(H, wp[k + 1]) - dist3(wp[k], wp[k + 1]);
        if (d < best) best = d;
      }
      if (g.detour0 === undefined) g.detour0 = best;   // where the rope already lay when it was picked up
      if (best > g.detour0) extra += best - g.detour0;
    }
    return extra;
  }

  /** Wind ribbon onto a spool. dl > 0 takes ribbon out of the free span. */
  /**
   * Unlimited typing only: keystrokes overlap, the rocker never completes a cycle and the pawl stops feeding, so every
   * letter would draw on the same worn patch of ribbon. Make up whatever the pawl did not feed for this letter.
   */
  feedForStrike() {
    const short = this.m.ribbon.feedPerKey - this.fedSinceStrike;
    if (short > 0) this._wind(this.takeUpSide, short);
    this.fedSinceStrike = 0;
  }

  _wind(side, dl) {
    if (dl > 0) dl = Math.min(dl, Math.max(0, this.Lf - 0.02));
    else dl = Math.max(dl, -Math.max(0, this.Lon[side] - 0.001));
    if (dl === 0) return;
    this.Lon[side] += dl;
    this.Lf -= dl;
    this.phi[side] += dl / this.spoolRadius(side);
  }

  sync() {
    const { N, xr: x, yr: y, zr: z, positions: P, up: U } = this;
    const T_up = this.T_up;
    for (let i = 0; i < N; i++) {
      P[i * 3] = x[i]; P[i * 3 + 1] = y[i]; P[i * 3 + 2] = z[i];
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      let tx = x[b] - x[a], ty = y[b] - y[a], tz = z[b] - z[a];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // Width direction: the platen tangent at the fork, vertical again by the guide posts and out to the spools.
      const bx = Math.max(0, 1 - Math.abs(this.xr[i]) / this.m.ribbon.guidePostX), blend = bx * bx * (3 - 2 * bx);
      let ux = 0, uy = 1 - blend + blend * T_up[1], uz = blend * T_up[2];
      const dot = ux * tx + uy * ty + uz * tz;
      ux -= dot * tx; uy -= dot * ty; uz -= dot * tz;
      const ul = Math.hypot(ux, uy, uz) || 1;
      U[i * 3] = ux / ul; U[i * 3 + 1] = uy / ul; U[i * 3 + 2] = uz / ul;
    }
    const rL = this.spoolRadius(0), rR = this.spoolRadius(1);
    this.spoolL.angle = this.phi[0]; this.spoolL.radius = rL;
    this.spoolR.angle = this.phi[1]; this.spoolR.radius = rR;
  }

  /** Back to a taut, freshly threaded ribbon. Ink wear is kept unless fresh is set. */
  reset({ fresh = false } = {}) {
    const r = this.m.ribbon;
    this.Lon = [r.length * 0.94, 0.02];
    this.phi = [0, 0];
    this.tension = 0;
    this.springBack = 0;
    this.pawlPrev = null;
    this.fedSinceStrike = 0;
    this.spoolGrab = [null, null];
    this.grabs.clear();
    this.vx.fill(0); this.vy.fill(0); this.vz.fill(0);
    this.polyLen = undefined; this.pathLen = undefined; this.waypoints = undefined; this.fork = undefined;
    if (fresh) this.ink.fill(255);
    this._initPath();
    this.windowDirty = true;
  }

  // ---- interaction
  grab(point) {
    const { N, xr: x, yr: y, zr: z } = this;
    let best = -1, bd = 0.02 * 0.02;
    for (let i = 1; i < N - 1; i++) {
      const dx = x[i] - point[0], dy = y[i] - point[1], dz = z[i] - point[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best < 0) return -1;
    const id = this.nextGrab++;
    this.grabs.set(id, { i: best, tx: x[best], ty: y[best], tz: z[best] });
    return id;
  }

  grabSpool(side) {
    const s = side === 'L' || side === 0 ? 0 : 1;
    const id = this.nextGrab++;
    const gr = { side: s, target: this.phi[s] };
    this.grabs.set(id, gr);
    this.spoolGrab[s] = gr;
    return id;
  }

  move(id, v) {
    const g = this.grabs.get(id);
    if (!g) return;
    if (g.side !== undefined) g.target = v;
    else { g.tx = v[0]; g.ty = v[1]; g.tz = v[2]; }
  }

  release(id) {
    const g = this.grabs.get(id);
    if (!g) return;
    if (g.side !== undefined) this.spoolGrab[g.side] = null;
    this.grabs.delete(id);
  }

  // ---- print-time queries
  /** Rope state at world x near the print point: {s, up (offset of centreline along T_up from `o`), caught, n} */
  queryAt(worldX, o) {
    const { N, xr: x, yr: y, zr: z, T_up } = this;
    const nrm = this.geo.printNormal;
    let bestI = -1, bestD = 1e9;
    for (let i = 1; i < N; i++) {
      const lo = Math.min(x[i - 1], x[i]) - 1e-5, hi = Math.max(x[i - 1], x[i]) + 1e-5;
      if (worldX < lo || worldX > hi) continue;
      const mid = Math.abs((y[i] - o[1]) * nrm[1] + (z[i] - o[2]) * nrm[2]);
      if (mid < bestD) { bestD = mid; bestI = i; }
    }
    if (bestI < 0) return null;
    const i = bestI;
    const dx = x[i] - x[i - 1];
    const f = Math.abs(dx) > 1e-9 ? (worldX - x[i - 1]) / dx : 0.5;
    const yy = y[i - 1] + (y[i] - y[i - 1]) * f, zz = z[i - 1] + (z[i] - z[i - 1]) * f;
    const up = (yy - o[1]) * T_up[1] + (zz - o[2]) * T_up[2];
    const nOff = (yy - o[1]) * nrm[1] + (zz - o[2]) * nrm[2];
    const s = this.Lon[0] + ((i - 1 + f) / (N - 1)) * this.Lf;
    return { s, up, nOff, i };
  }

  inkAt(sM, wM) {
    const wPx = (wM + this.W / 2) * PX_PER_M, sPx = sM * PX_PER_M;
    return this._sample(sPx, wPx) * (this.m.ribbon.ink ?? 1);
  }

  _sample(sPx, wPx) {
    const { mapW, mapL, ink } = this;
    if (wPx < 0 || wPx >= mapW - 1 || sPx < 0 || sPx >= mapL - 1) return 0;
    const si = Math.floor(sPx), wi = Math.floor(wPx);
    const fs = sPx - si, fw = wPx - wi;
    const a = ink[si * mapW + wi], b = ink[si * mapW + wi + 1], c = ink[(si + 1) * mapW + wi], d = ink[(si + 1) * mapW + wi + 1];
    return (a * (1 - fs) * (1 - fw) + b * (1 - fs) * fw + c * fs * (1 - fw) + d * fs * fw) / 255;
  }

  deplete(sM, wM, amount) {
    const { mapW, mapL, ink } = this;
    const wPx = (wM + this.W / 2) * PX_PER_M, sPx = sM * PX_PER_M;
    if (wPx < 0 || wPx >= mapW || sPx < 0 || sPx >= mapL) return;
    const k = Math.floor(sPx) * mapW + Math.floor(wPx);
    const v = ink[k] - amount * 255;
    ink[k] = v < 0 ? 0 : v;
  }

  /** Cloth weave pattern at a point on the ribbon (s along, w across), in 0..1. */
  weave(s, w) {
    const P = this.m.ribbon.weaveThreadPitch;
    const a = Math.sin((2 * Math.PI * s) / P), b = Math.sin((2 * Math.PI * w) / P);
    return 0.86 + 0.14 * a * b + 0.06 * Math.sin((2 * Math.PI * s) / (3.1 * P)) * Math.cos((2 * Math.PI * w) / (2.7 * P));
  }

  /** Mean ink remaining in a small window centred at (s, w). */
  meanInk(s, w, halfSM, halfWM) {
    let t = 0, c = 0;
    for (let a = -halfSM; a <= halfSM; a += 0.00025) for (let b = -halfWM; b <= halfWM; b += 0.00025) { t += this.inkAt(s + a, w + b); c++; }
    return c ? t / c : 0;
  }
}

function dist3(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
