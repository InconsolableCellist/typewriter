// XPBD sheet of paper on a typewriter paper path. Material coordinates (u across the width, v down
// the page) index a regular grid; v = 0 is the page top, which is also the edge that leads into the
// machine, so j = 0 is the leading row. Everything collides with the platen, pan, table and desk, and
// frictional grip at the feed rolls and bail emerges from a stick/slip force balance on the sheet.
//
// Paper is effectively rigid in plane and nearly massless; a few XPBD iterations can neither carry the
// force of a tug through 70 rows of 2 mg particles nor measure it, so the in-plane force balance is
// solved once per substep on the sheet treated as a rigid lamina (3 DOF: axial, circumferential, skew)
// on Coulomb patches, and the rigid motion is imposed on the particles under the patches. The rest of
// the sheet follows through the XPBD constraints, with no coupling back into the lamina solve except
// the hand force, which is measured from how far the hand's target overshoots what the inextensible
// sheet can reach (long range attachment).
import { bodyTop, MACHINE_BODY } from './proxies.js';

const PI2 = Math.PI * 2;
function wrap(a) { return a > Math.PI ? a - PI2 : a < -Math.PI ? a + PI2 : a; }

export const PAPER_DEFAULT_GRID = { nx: 30, ny: 70 };
const HAND_K = 2200, HAND_MAXF = 14;    // N/m, N: a fingertip's grip on a sheet
const CARRIAGE_END = 0.042;              // m the platen's axle and knobs reach past the rubber on each side
const BEND_CONTACT_FACTOR = 30;          // bending contact pressure on the platen relative to the sheet's weight
const LOOSE_SHEET_LOAD = 0.25;           // N per roll position with the nip open: the sheet's own contact on platen and pan
const HAND_VMAX = 1.5;                    // m/s, grab target chase speed
const APRON_END = 0.25;                   // rad past the print point where the fixed apron ends
const APRON_BLEND = 0.3;                  // rad over which gripped rows ease from the apron to their own height
const BAIL_PRESS_STEP = 0.0015;           // m per substep: how fast a closing bail can press a standing sheet down
const TABLE_LAYER_GAP = 0.0012;           // m, typed part of the sheet lying over the part still to be fed
const TABLE_OVERHANG = 0.07;             // m, stiff paper standing past the top of the table stays in line with it instead of folding behind
const TABLE_CROSS_REACH = 0.008;         // m, how far behind the table a fold can be and still be drawn over its top edge
const AIR_DAMP = 10;                     // 1/s, air on a sheet: terminal speed about 1 m/s, as paper falls
const GRIP_RADIUS = 0.018;               // m, the patch of paper pinched between finger and thumb
const SLIP_OVERSHOOT = 0.022;            // m the hand must be held back by before the grip starts to slip
const SLIP_TIME = 0.14;                  // s of being held back before the fingers come off
const BAND_RELAX = 0.15;      // fraction of a band row's offset from the rigid fit removed per substep
const SHEAR_EVERY = 4;

export class PaperSim {
  constructor(machine, opts = {}) {
    const p = machine.paper;
    this.m = machine;
    this.nx = opts.nx ?? PAPER_DEFAULT_GRID.nx;
    this.ny = opts.ny ?? PAPER_DEFAULT_GRID.ny;
    const n = (this.n = this.nx * this.ny);
    this.du = p.width / (this.nx - 1);
    this.dv = p.height / (this.ny - 1);
    this.t = p.thickness;
    this.massTotal = p.grammage * p.width * p.height;
    this.mass = this.massTotal / n;
    this.w0 = 1 / this.mass;
    this.r = machine.platen.radius;
    this.pl = machine.platen.length;
    this.c0 = machine.platen.center;
    this.beta0 = machine.printPoint.beta;
    this.gap = p.panClearance;
    this.mu = p.friction;

    // Particle state, world space, structure of arrays for speed.
    const A = () => new Float64Array(n);
    this.x = A(); this.y = A(); this.z = A();
    this.xp = A(); this.yp = A(); this.zp = A();
    this.vx = A(); this.vy = A(); this.vz = A();
    this.w = new Float64Array(n);
    this.fix = new Uint8Array(n);        // 0 free, 1 kinematic under a patch, 2 grabbed
    this.uMat = A(); this.vMat = A();

    this.positions = new Float32Array(n * 3);
    this.uvs = new Float32Array(n * 2);
    const idx = [];
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = i + j * this.nx;
        this.uMat[k] = i * this.du;
        this.vMat[k] = j * this.dv;
        this.uvs[k * 2] = i / (this.nx - 1);
        this.uvs[k * 2 + 1] = j / (this.ny - 1);   // v = 0 at page top; ink texture row 0 is page top
        if (i < this.nx - 1 && j < this.ny - 1) idx.push(k, k + this.nx, k + 1, k + 1, k + this.nx, k + this.nx + 1);
      }
    }
    this.indices = new Uint32Array(idx);

    this._buildConstraints();
    this._buildContactParams();

    // Engagement scratch space: particles currently under a nip or bail patch.
    this.eIdx = new Int32Array(n);
    this.eTheta = new Float64Array(n);
    this.eRho = new Float64Array(n);
    this.eXt = new Float64Array(n);
    this.ePatch = new Uint8Array(n);
    this.eKind = new Uint8Array(n);
    this.nE = 0;
    this.anchorX = new Float64Array(16); this.anchorY = new Float64Array(16); this.anchorZ = new Float64Array(16);
    this.anchorU = new Float64Array(16); this.anchorV = new Float64Array(16);
    this.nAnchor = 0;

    this.grabs = new Map();
    this.nextGrab = 1;
    this._slipOff = [];
    this.handSlips = 0;
    this.asleep = false;
    this.restFrames = 0;
    this.substepCount = 0;
    this.velFilter = opts.velFilter ?? 0;
    this.engaged = false;

    this.lastFrame = null;
    this.spawn(opts.pose);
  }

  // ---- constraint topology
  _buildConstraints() {
    const { nx, ny, du, dv } = this;
    const uA = [], uB = [], vA = [], vB = [], sA = [], sB = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) { uA.push(i + j * nx); uB.push(i + 1 + j * nx); }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx; i++) { vA.push(i + j * nx); vB.push(i + (j + 1) * nx); }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      if ((i + j) % 2 === 0) { sA.push(i + j * nx); sB.push(i + 1 + (j + 1) * nx); }
      else { sA.push(i + 1 + j * nx); sB.push(i + (j + 1) * nx); }
    }
    this.uA = Int32Array.from(uA); this.uB = Int32Array.from(uB);
    this.vA = Int32Array.from(vA); this.vB = Int32Array.from(vB);
    this.sA = Int32Array.from(sA); this.sB = Int32Array.from(sB);
    this.sRest = Math.hypot(du, dv);
    // Bending is solved implicitly along each row and column (ADI). Kirchhoff bending of an isometric sheet is
    // quadratic in the positions (second differences), so one pentadiagonal solve per line is exact for the
    // discretised energy, is unconditionally stable at the true stiffness, and carries the long wavelengths that
    // local constraints cannot.
    const L = Math.max(nx, ny);
    this.bD = new Float64Array(L); this.bL1 = new Float64Array(L); this.bL2 = new Float64Array(L);
    this.bX = new Float64Array(L); this.bY = new Float64Array(L); this.bZ = new Float64Array(L);
    this.bPin = new Uint8Array(L);
  }

  _buildContactParams() {
    const p = this.m.paper, r = this.r;
    const pats = [];
    const halfArcRoll = 1.5 * this.dv;
    for (const a of p.feedRollAngle) {
      for (const xc of p.feedRollX) {
        pats.push({ kind: 'roll', theta: a, xc, halfW: p.feedRollWidth / 2, halfArc: halfArcRoll, lip: true, tol: this.gap + 0.0005, force: p.feedRollForce });
      }
    }
    const bx = p.bailRollerX ?? p.feedRollX;
    for (const xc of bx) {
      pats.push({ kind: 'bail', theta: p.bailAngle, xc, halfW: p.bailRollerWidth / 2, halfArc: Math.max(0.0035, 0.8 * this.dv), lip: false, tol: 0.0012, force: p.bailForce });
    }
    this.patches = pats;
    for (const q of pats) {
      q.N = q.force; q.cov = 0; q.sumX = 0; q.sumS = 0; q.count = 0; q.maxTh = -Infinity; q.slip = 0; q.fx = 0; q.fs = 0;
      q.engagedN = 0; q.anchor = -1; q.sumMatU = 0; q.sumMatV = 0; q.wedge = false; q.sumWX = 0; q.sumWY = 0; q.sumWZ = 0;
    }
    this.maxTol = Math.max(...pats.map((q) => q.tol));

    // Channel between platen and pan, and the tilted table leading into it.
    this.panTh0 = p.panArc[0]; this.panTh1 = p.panArc[1];
    this.rPanInner = r + this.gap;              // inner face
    this.rPanOuter = r + this.gap + p.panThickness;
    const tipTheta = p.panArc[0];
    const tipBeta = this.beta0 + tipTheta;
    this.tipBeta = tipBeta;
    // Table lies on the platen side of the plane tangent to the circle of radius r + gap/2 at the
    // pan entry, running up and away from the entry; the sheet rests on its platen-facing surface.
    const rt = r + this.gap / 2;
    this.tableTip = [rt * Math.sin(tipBeta), rt * Math.cos(tipBeta)];        // (y, z) relative to axis
    this.tableN = [-Math.sin(tipBeta), -Math.cos(tipBeta)];                  // toward the platen
    // Up-slope direction along the table, away from the entry (direction of decreasing feed).
    this.tableS = [-Math.cos(tipBeta), Math.sin(tipBeta)];
    this.tableL = p.tableLength;
    this.tableHalfW = p.tableWidth / 2;
  }

  /** Reset the sheet into a flat pose. pose: {center:[x,y,z], up?, yaw?, onTable?} or undefined for the desk. */
  spawn(pose) {
    const { nx, ny, n, x, y, z, xp, yp, zp, vx, vy, vz, du, dv, m } = this;
    const W = m.paper.width, H = m.paper.height;
    const P = pose ?? { desk: true };
    let c, ux, vv, along;
    if (P.onTable) {
      // Lay the sheet on the table with its leading (j = 0) edge at distance P.onTable.offset up-slope of the tip.
      const a = P.onTable.offset ?? 0.002;
      const tip = this.tableTip, ts = this.tableS, tn = this.tableN;
      const liftN = this.t * 0.7;
      // World positions built directly here; carriage frame at spawn is the current one.
      const f = this.lastFrame ?? this._homeFrame();
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = i + j * nx;
          const sU = i * du - W / 2 + (P.onTable.lateral ?? 0);
          const sV = a + j * dv;
          x[k] = f.cx + sU;
          y[k] = f.cy + tip[0] + ts[0] * sV + tn[0] * liftN;
          z[k] = f.cz + tip[1] + ts[1] * sV + tn[1] * liftN;
        }
      }
    } else {
      c = P.center ?? [0.34, this.t * 2, 0.08];
      const yaw = P.yaw ?? 0;
      // Lying flat with the leading edge toward -z (toward the back of the machine).
      ux = [Math.cos(yaw), 0, -Math.sin(yaw)];
      vv = [Math.sin(yaw), 0, Math.cos(yaw)];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const k = i + j * nx;
          const sU = i * du - W / 2;
          const sV = j * dv - H / 2;
          x[k] = c[0] + ux[0] * sU + vv[0] * sV;
          y[k] = c[1] + ux[1] * sU + vv[1] * sV;
          z[k] = c[2] + ux[2] * sU + vv[2] * sV;
        }
      }
    }
    xp.set(x); yp.set(y); zp.set(z);
    vx.fill(0); vy.fill(0); vz.fill(0);
    this.w.fill(this.w0);
    this.fix.fill(0);
    this.grabs.clear();
    this.asleep = false;
    this.restFrames = 0;
    this.nE = 0;
    this.engaged = false;
    this.ejected = false;
    this.lastGrippedRow = -1;
    this.bandFit = null;
    for (const q of this.patches) { q.count = 0; q.cov = 0; q.fx = 0; q.fs = 0; q.slip = 0; q.wedge = false; }
    this.syncPositions();
  }

  _homeFrame() {
    const c = this.c0;
    return { cx: c[0], cy: c[1], cz: c[2], psi: 0, omega: 0, dcx: 0, dcy: 0, nipFactor: 1, bailFactor: 1 };
  }

  // ---- step
  /** One fixed substep. f = {cx, cy, cz (platen axis point), psi, omega, dcx, dcy, nipFactor, bailFactor}. */
  substep(h, f) {
    this.lastFrame = f;
    this.lastH = h;
    this.substepCount++;
    const anyGrab = this.grabs.size > 0;
    const gripChanged = f.nipFactor !== this.lastNip || f.bailFactor !== this.lastBail;
    this.lastNip = f.nipFactor; this.lastBail = f.bailFactor;
    if (gripChanged && this.asleep) { this.asleep = false; this.restFrames = 0; }
    const frameMoving = f.omega !== 0 || f.dcx !== 0 || f.dcy !== 0;
    if (this.asleep && !anyGrab && !frameMoving) return;
    if (this.asleep && frameMoving && !anyGrab) {
      // Carriage/platen moved; rigidly carry a gripped sheet, wake if it is not gripped.
      if (this.engaged && f.omega === 0) { this._translateAll(f.dcx, f.dcy, 0); return; }
      this.asleep = false; this.restFrames = 0;
    } else if (this.asleep) {
      this.asleep = false;
    }
    const { x, y, z, xp, yp, zp, vx, vy, vz, w, fix, n } = this;
    const damp = Math.exp(-AIR_DAMP * h);
    const g = 9.81;

    // Carriage translation: a gripped sheet rides rigidly with the carriage.
    if (this.engaged && (f.dcx !== 0 || f.dcy !== 0)) this._translateAll(f.dcx, f.dcy, 0);

    // 1. Patch engagement and rigid lamina stick/slip.
    this._detectEngagement(f);
    // Held particles follow the hand only; integrating their velocity as well doubles the hand's speed.
    for (const g of this.grabs.values()) for (let c = 0; c < g.ids.length; c++) { if (fix[g.ids[c]] === 0) fix[g.ids[c]] = 2; }
    this._applyGrabPull(h, f);
    this._solveLamina(h, f);

    // 2. Predict free particles.
    for (let i = 0; i < n; i++) {
      xp[i] = x[i]; yp[i] = y[i]; zp[i] = z[i];
      if (fix[i] === 1) continue;
      if (fix[i] === 2) continue;
      vx[i] *= damp; vy[i] = vy[i] * damp - g * h; vz[i] *= damp;
      x[i] += vx[i] * h; y[i] += vy[i] * h; z[i] += vz[i] * h;
    }
    // 3. Kinematic: engaged particles (positions already set by lamina step), grabs.
    this._applyEngagedKinematics();
    this._applyGrabPositions(h);

    // 4. Bending, then inextensibility as Gauss-Seidel sweeps alternating direction.
    this._solveBending(h * h);
    const fwd = (this.substepCount & 1) === 1;
    this._sweepPairs(this.vA, this.vB, this.dv, true);
    this._sweepPairs(this.uA, this.uB, this.du, true);
    this._sweepPairs(this.vA, this.vB, this.dv, false);
    if ((this.substepCount % SHEAR_EVERY) === 0) this._sweepPairs(this.sA, this.sB, this.sRest, true);

    if ((this.substepCount & 1) === 1 || this.grabs.size > 0) this._applyLongRange();
    let violent = Math.abs(f.omega) * this.r > 0.5;
    for (const g of this.grabs.values()) {
      const i = g.ids[0];
      if (Math.abs(g.tx - x[i]) + Math.abs(g.ty - y[i]) + Math.abs(g.tz - z[i]) > 0.02) violent = true;
    }
    if ((this.substepCount & 1) === 0 || violent) this._limitStrain(fwd, violent ? 1.25 : 1.4);

    // 5. Collision + friction.
    this._collide(h, f);
    this._checkEjected(f);

    // 6. Velocity update and sleep.
    let ke = 0;
    const ih = 1 / h;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - xp[i], dy = y[i] - yp[i], dz = z[i] - zp[i];
      if (fix[i] === 1) { vx[i] = dx * ih; vy[i] = dy * ih; vz[i] = dz * ih; continue; }
      let vxx = dx * ih, vyy = dy * ih, vzz = dz * ih;
      const sp = vxx * vxx + vyy * vyy + vzz * vzz;
      if (sp > 16) { const s = 4 / Math.sqrt(sp); vxx *= s; vyy *= s; vzz *= s; }
      vx[i] = vxx; vy[i] = vyy; vz[i] = vzz;
      ke += sp;
    }
    // Sleep is judged on filtered velocities: the raw ones carry solver projection noise on one substep in two.
    if (this.velFilter > 0 && (this.substepCount & 1) === 0) { ke = this._filterVelocities(); this._updateSleep(ke, anyGrab, f); }
    else if (this.velFilter <= 0) this._updateSleep(ke, anyGrab, f);
  }

  /** The tail has been fed up to the bail with nobody holding the sheet: nothing more can be typed on this page. */
  _checkEjected(f) {
    if (this.ejected || !this.onEjected || this.grabs.size > 0 || f.nipFactor <= 0 || this.lastGrippedRow < this.ny - 5) return;
    const k = Math.floor(this.nx / 2) + (this.ny - 1) * this.nx;
    const dy = this.y[k] - f.cy, dz = this.z[k] - f.cz;
    const th = wrap(Math.atan2(dy, dz) - this.beta0);          // the rear of the platen wraps round to large positive angles
    if (Math.hypot(dy, dz) > this.r + 0.01 || th < this.m.paper.bailAngle - 0.05 || th > 2) return;
    this.ejected = true;
    this.onEjected();
  }

  /** Damp zigzag solver noise: blend each free particle's velocity toward the mean of its row/column neighbours. */
  _filterVelocities() {
    const { n, nx, ny, vx, vy, vz, fix, velFilter: b } = this;
    const fx = this.fx ??= new Float64Array(n), fy = this.fy ??= new Float64Array(n), fz = this.fz ??= new Float64Array(n);
    let ke = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = i + j * nx;
        let sx = 0, sy = 0, sz = 0, c = 0;
        if (i > 0) { const o = k - 1; sx += vx[o]; sy += vy[o]; sz += vz[o]; c++; }
        if (i < nx - 1) { const o = k + 1; sx += vx[o]; sy += vy[o]; sz += vz[o]; c++; }
        if (j > 0) { const o = k - nx; sx += vx[o]; sy += vy[o]; sz += vz[o]; c++; }
        if (j < ny - 1) { const o = k + nx; sx += vx[o]; sy += vy[o]; sz += vz[o]; c++; }
        const ic = 1 / c;
        fx[k] = vx[k] + b * (sx * ic - vx[k]);
        fy[k] = vy[k] + b * (sy * ic - vy[k]);
        fz[k] = vz[k] + b * (sz * ic - vz[k]);
      }
    }
    for (let k = 0; k < n; k++) {
      if (fix[k] !== 0) continue;
      vx[k] = fx[k]; vy[k] = fy[k]; vz[k] = fz[k];
      ke += fx[k] * fx[k] + fy[k] * fy[k] + fz[k] * fz[k];
    }
    return ke;
  }

  _translateAll(dx, dy, dz) {
    const { x, y, z, xp, yp, zp, n } = this;
    for (let i = 0; i < n; i++) { x[i] += dx; y[i] += dy; z[i] += dz; xp[i] += dx; yp[i] += dy; zp[i] += dz; }
  }

  _updateSleep(ke, anyGrab, f) {
    const avg = ke / this.n;
    const quiet = avg < 1.5e-4 && !anyGrab && f.omega === 0 && (this.engaged || (f.dcx === 0 && f.dcy === 0));
    this.restFrames = quiet ? this.restFrames + 1 : 0;
    if (this.restFrames > 120) {
      this.asleep = true;
      this.vx.fill(0); this.vy.fill(0); this.vz.fill(0);
    }
  }

  // ---- engagement
  _detectEngagement(f) {
    const { n, x, y, z, r, pl, patches, beta0, maxTol } = this;
    const rMax = r + maxTol, rMax2 = rMax * rMax, rMin2 = (r - 0.002) * (r - 0.002);
    const cx = f.cx, cy = f.cy, cz = f.cz;
    const halfL = pl / 2 + 0.002;
    for (let p = 0; p < patches.length; p++) {
      const q = patches[p];
      // With the rolls lifted the sheet still lies wrapped on the platen, held by its own curl and the pan.
      q.N = q.kind === 'bail' ? f.bailFactor * q.force : Math.max(f.nipFactor * q.force, LOOSE_SHEET_LOAD);
      q.count = 0; q.cov = 0; q.sumX = 0; q.sumS = 0; q.maxTh = -1e9; q.sumMatU = 0; q.sumMatV = 0;
      q.minRow = 1 << 30; q.maxRow = -1;
      q.sumWX = 0; q.sumWY = 0; q.sumWZ = 0;
    }
    let nE = 0;
    const E = this.eIdx, Th = this.eTheta, Rh = this.eRho, Xt = this.eXt, Ep = this.ePatch;
    const bandTh0 = this.panTh0, bandTh1 = this.m.paper.bailAngle + 0.08;   // the sheet leaves the platen just past the bail
    const bandMax = r + this.gap + 0.0007, bandMax2 = bandMax * bandMax;
    const tip = this.tableTip, tn = this.tableN, ts = this.tableS, tL = this.tableL, tHW = this.tableHalfW;
    const sTip = r * this.panTh0;
    for (let i = 0; i < n; i++) {
      this.fix[i] = 0;
      const dy = y[i] - cy, dz = z[i] - cz;
      const xt = x[i] - cx;
      const r2 = dy * dy + dz * dz;
      let hitPatch = 255, s = 0, h = 0, kind = -1;
      if (r2 < bandMax2 && r2 > rMin2 && xt < halfL && xt > -halfL) {
        const rho = Math.sqrt(r2);
        const beta = Math.atan2(dy, dz);
        const theta = wrap(beta - beta0);
        if (theta >= bandTh0 && theta <= bandTh1) {
        s = r * theta; h = rho - r; kind = 0;
        for (let p = 0; p < patches.length; p++) {
          const q = patches[p];
          if (q.N <= 0) continue;
          const dth = theta - q.theta;
          if (dth * r > q.halfArc || -dth * r > q.halfArc) continue;
          // A stiff leading edge is stopped across its whole width by the rolls, so ahead of the roll
          // centreline contact counts for the roll on its side.
          if (Math.abs(xt - q.xc) > q.halfW && !(q.lip && dth < 0 && (xt < 0) === (q.xc < 0))) continue;
          if (rho - r > q.tol) continue;
          hitPatch = p;
          break;
        }
        }
      }
      if (kind < 0 && Math.abs(xt) < tHW) {
        const ty = dy - tip[0], tz = dz - tip[1];
        const g = ty * tn[0] + tz * tn[1];
        if (g > -0.0004 && g < 0.0022) {
          const a = ty * ts[0] + tz * ts[1];
          if (a > -0.0012 && a < tL + 0.003) { s = sTip - a; h = g; kind = 1; }
        }
      }
      if (kind < 0) continue;
      E[nE] = i; Th[nE] = s; Rh[nE] = h; Xt[nE] = xt; Ep[nE] = hitPatch; this.eKind[nE] = kind; nE++;
    }
    nE = this._rejectForeignLayers(nE, f);
    for (let e = 0; e < nE; e++) {
      const p = Ep[e];
      if (p === 255) continue;
      const q = patches[p], i = E[e];
      q.count++; q.sumX += Xt[e]; q.sumS += Th[e]; q.sumMatU += this.uMat[i]; q.sumMatV += this.vMat[i];
      q.sumWX += x[i]; q.sumWY += y[i]; q.sumWZ += z[i];
      const dth = Th[e] / r - q.theta;
      if (dth > q.maxTh) q.maxTh = dth;
      const row = (i / this.nx) | 0;
      if (row < q.minRow) q.minRow = row;
      if (row > q.maxRow) q.maxRow = row;
    }
    this.engaged = patches.some((q) => q.count > 0);
    if (!this.engaged) { nE = 0; this.bandFit = null; }
    // Keep only the band rows contiguous with the patch-gripped rows: paper folded back over itself
    // onto the table must not be frozen into the rigid lamina.
    if (nE > 0) {
      const { nx, ny, eKind } = this;
      const rowCount = this.rowCount ??= new Int32Array(ny);
      const rowPatch = this.rowPatch ??= new Uint8Array(ny);
      rowCount.fill(0); rowPatch.fill(0);
      for (let e = 0; e < nE; e++) {
        const j = (E[e] / nx) | 0;
        rowCount[j]++;
        if (Ep[e] !== 255) rowPatch[j] = 1;
      }
      let j0 = -1, j1 = -1;
      for (let j = 0; j < ny; j++) if (rowPatch[j]) { if (j0 < 0) j0 = j; j1 = j; }
      const thresh = Math.max(2, Math.ceil(0.3 * nx));
      if (j0 >= 0) {
        while (j0 > 0 && rowCount[j0 - 1] >= thresh) j0--;
        while (j1 < ny - 1 && rowCount[j1 + 1] >= thresh) j1++;
        let m = 0;
        for (let e = 0; e < nE; e++) {
          const j = (E[e] / nx) | 0;
          if (j < j0 || j > j1) continue;
          E[m] = E[e]; Th[m] = Th[e]; Rh[m] = Rh[e]; Xt[m] = Xt[e]; Ep[m] = Ep[e]; eKind[m] = eKind[e]; m++;
        }
        nE = m;
      } else nE = 0;
    }
    this.nE = nE;
    const inBand = this.inBand ??= new Uint8Array(n);
    inBand.fill(0);
    for (let e = 0; e < nE; e++) inBand[E[e]] = 1;
    let na = 0;
    for (const q of patches) {
      if (q.count > 0) {
        this.anchorX[na] = q.sumWX / q.count; this.anchorY[na] = q.sumWY / q.count; this.anchorZ[na] = q.sumWZ / q.count;
        this.anchorU[na] = q.sumMatU / q.count; this.anchorV[na] = q.sumMatV / q.count;
        na++;
      }
    }
    this.nAnchor = na;
  }

  /**
   * Keep only band candidates whose position agrees with their material coordinates. Without self-collision
   * a loose flap (a tail fallen over the platen, a buckled fold) can pass through the contact band; freezing
   * it into the rigid lamina stretches the sheet between layers and hides the true layer from the printer.
   */
  _rejectForeignLayers(nE, f) {
    if (nE === 0) return 0;
    const { eIdx: E, eTheta: Th, eXt: Xt, ePatch: Ep, eRho: Rh, eKind, uMat, vMat } = this;
    const tol = 6 * this.dv;
    let map = this.bandFit;
    if (!map) {
      map = this._fitBand(nE, true, null, 0);
      if (!map) return 0;
      map = this._fitBand(nE, true, map, 3 * tol) ?? map;
    }
    const C = Math.cos(map.angle), S = Math.sin(map.angle);
    let m = 0;
    for (let e = 0; e < nE; e++) {
      const i = E[e], mu = uMat[i], mv = -vMat[i];
      if (Math.abs(map.tx + C * mu - S * mv - Xt[e]) > tol || Math.abs(map.ty + S * mu + C * mv - Th[e]) > tol) continue;
      if (m !== e) { E[m] = i; Th[m] = Th[e]; Rh[m] = Rh[e]; Xt[m] = Xt[e]; Ep[m] = Ep[e]; eKind[m] = eKind[e]; }
      m++;
    }
    // Follow the sheet: the next substep tests against this substep's accepted layer.
    this.bandFit = m >= 8 ? this._fitBand(m, false, null, 0) ?? map : null;
    return m;
  }

  /** Rigid (u, -v) -> (x, s) fit over the candidates; patchOnly restricts it to patch rows, and prior + limit reject outliers. */
  _fitBand(nE, patchOnly, prior, limit) {
    const { eIdx: E, eTheta: Th, eXt: Xt, ePatch: Ep, uMat, vMat } = this;
    let C = 1, S = 0;
    if (prior) { C = Math.cos(prior.angle); S = Math.sin(prior.angle); }
    let mu = 0, mv = 0, mx = 0, ms = 0, c = 0;
    const use = (e) => {
      if (patchOnly && Ep[e] === 255) return false;
      if (!prior) return true;
      const i = E[e], a = uMat[i], b = -vMat[i];
      return Math.abs(prior.tx + C * a - S * b - Xt[e]) <= limit && Math.abs(prior.ty + S * a + C * b - Th[e]) <= limit;
    };
    for (let e = 0; e < nE; e++) { if (!use(e)) continue; const i = E[e]; mu += uMat[i]; mv -= vMat[i]; mx += Xt[e]; ms += Th[e]; c++; }
    if (c < 4) return null;
    mu /= c; mv /= c; mx /= c; ms /= c;
    let h00 = 0, h01 = 0, h10 = 0, h11 = 0;
    for (let e = 0; e < nE; e++) {
      if (!use(e)) continue;
      const i = E[e];
      const a = uMat[i] - mu, b = -vMat[i] - mv, xr = Xt[e] - mx, d = Th[e] - ms;
      h00 += a * xr; h01 += a * d; h10 += b * xr; h11 += b * d;
    }
    const angle = Math.atan2(h01 - h10, h00 + h11);
    const Ca = Math.cos(angle), Sa = Math.sin(angle);
    return { angle, tx: mx - (Ca * mu - Sa * mv), ty: ms - (Sa * mu + Ca * mv) };
  }

  // ---- hand force, overshoot past what the inextensible sheet allows
  _applyGrabPull(h, f) {
    if (this.grabs.size === 0 || this.nE === 0) { for (const g of this.grabs.values()) { g.overX = g.overY = g.overZ = 0; g.fMag = 0; } return; }
    const { x, y, z, anchorX, anchorY, anchorZ, anchorU, anchorV, nAnchor, uMat, vMat } = this;
    for (const g of this.grabs.values()) {
      let ox = 0, oy = 0, oz = 0, cnt = 0;
      for (let c = 0; c < g.ids.length; c++) {
        const i = g.ids[c];
        const tx = g.tx + g.ox[c], ty = g.ty + g.oy[c], tz = g.tz + g.oz[c];
        let dx = tx - x[i], dy = ty - y[i], dz = tz - z[i];
        let over = false;
        // Is this particle held taut by an anchor? Check reach to the target.
        for (let a = 0; a < nAnchor; a++) {
          const ax = anchorX[a], ay = anchorY[a], az = anchorZ[a];
          const reach = Math.hypot(uMat[i] - anchorU[a], vMat[i] - anchorV[a]) * 1.0005 + 1e-5;
          const rx = tx - ax, ry = ty - ay, rz = tz - az;
          if (Math.hypot(rx, ry, rz) > reach) {
            const curDx = x[i] - ax, curDy = y[i] - ay, curDz = z[i] - az;
            const dist = Math.hypot(curDx, curDy, curDz);
            if (dist >= reach - 0.0012) over = true;
          }
        }
        if (this._isEngagedParticle(i)) over = true;
        else {
          const near = this._nearestBandRow(i);
          if (near >= 0) {
            const col = i % this.nx, row = (i - col) / this.nx, a = col + near * this.nx;
            const reach = Math.abs(row - near) * this.dv * 1.002;
            if (Math.hypot(tx - x[a], ty - y[a], tz - z[a]) > reach && Math.hypot(x[i] - x[a], y[i] - y[a], z[i] - z[a]) >= reach - 0.0012) over = true;
          }
        }
        if (over) { ox += dx; oy += dy; oz += dz; cnt++; }
      }
      if (cnt > 0) { g.overX = ox / cnt; g.overY = oy / cnt; g.overZ = oz / cnt; }
      else { g.overX = g.overY = g.overZ = 0; }
      // Held back by the nip beyond what the fingers can hold: the grip creeps off the sheet and then lets go.
      const i0 = g.ids[0];
      const lag = Math.hypot(g.tx - x[i0], g.ty - y[i0], g.tz - z[i0]);
      g.slipT = cnt > 0 && lag > SLIP_OVERSHOOT ? g.slipT + h : Math.max(0, g.slipT - 2 * h);
      if (g.slipT > SLIP_TIME) { this._slipOff.push(g); }
    }
    if (this._slipOff.length) {
      for (const g of this._slipOff) { for (const [k, v] of this.grabs) if (v === g) this.grabs.delete(k); this.handSlips++; }
      this._slipOff.length = 0;
    }
  }

  _isEngagedParticle(i) { return this.inBand[i] === 1; }

  /** Closest gripped row in particle i's column, or -1. */
  _nearestBandRow(i) {
    const { nx, ny, inBand } = this;
    const col = i % nx, row = (i - col) / nx;
    for (let d = 0; d < ny; d++) {
      if (row - d >= 0 && inBand[col + (row - d) * nx]) return row - d;
      if (row + d < ny && inBand[col + (row + d) * nx]) return row + d;
    }
    return -1;
  }

  // ---- rigid lamina: stick/slip force balance over patches, driven by the hand and platen
  _solveLamina(h, f) {
    if (this.nE === 0) return;
    const { patches, r, massTotal: M, m, uMat, vMat, x, y, z } = this;
    const W = m.paper.width, H = m.paper.height;
    const I = (M * (W * W + H * H)) / 12;
    const nipClosed = f.nipFactor > 0;
    const vsurf = f.omega * r;
    const mu = this.mu;
    const wedgeFrac = m.paper.nipWedgeFraction;

    let totC = 0, xc = 0, sc = 0;
    for (const q of patches) { if (q.count > 0) { xc += q.sumX / q.count; sc += q.sumS / q.count; totC++; } }
    xc /= totC; sc /= totC;
    this.laminaXc = xc; this.laminaSc = sc;

    // Fit material -> surface rigid transform of the engaged set for skew and hand lever arm.
    const fit = this._fitLamina();
    this.fit = fit;

    let vX = 0, vS = 0, om = 0;
    const nP = patches.length;
    const dx = new Float64Array(nP), ds = new Float64Array(nP), pX = new Float64Array(nP), pS = new Float64Array(nP), lim = new Float64Array(nP), kInv = new Float64Array(nP);
    const wedgeFlag = new Uint8Array(nP);
    let anyActive = false;
    for (let p = 0; p < nP; p++) {
      const q = patches[p];
      q.fx = 0; q.fs = 0; q.slip = 0;
      if (q.count === 0) continue;
      anyActive = true;
      dx[p] = q.sumX / q.count - xc; ds[p] = q.sumS / q.count - sc;
      const k = 1 / M + (dx[p] * dx[p] + ds[p] * ds[p]) / I;
      kInv[p] = 1 / k;
      let Neff = q.N;
      if (q.lip) {
        const past = q.maxTh * r;                  // how far the leading material has passed the roll centreline
        const engageFrac = Math.max(0, Math.min(1, past / (0.8 * q.halfArc)));
        // A wedge is the sheet's forward edge arriving at the roll. A trailing edge leaving the roll also has
        // nothing past the centreline, but the rest of the sheet is ahead of it, so it must not block.
        const forwardEdge = Math.cos(fit.angle) > 0 ? q.minRow <= 5 : q.maxRow >= this.ny - 6;
        q.wedge = nipClosed && q.maxTh <= 0 && forwardEdge;
        wedgeFlag[p] = q.wedge ? 1 : 0;
        Neff = q.wedge ? q.N * wedgeFrac : q.N * (wedgeFrac + (1 - wedgeFrac) * engageFrac);
      } else { q.wedge = false; }
      q.engagedN = Neff;
      lim[p] = mu * Neff * h;
    }
    if (!anyActive) return;

    // Hand rows (soft, force capped), one per grab, applied at the grab's lamina point.
    const hands = [];
    for (const g of this.grabs.values()) {
      const c = g.ids[0];
      const eu = this._edgeDir(c, true), ev = this._edgeDir(c, false);
      const over = [g.overX, g.overY, g.overZ];
      const oU = over[0] * eu[0] + over[1] * eu[1] + over[2] * eu[2];
      const oV = over[0] * ev[0] + over[1] * ev[1] + over[2] * ev[2];
      // material axis directions in the surface frame from the fit
      const C = Math.cos(fit.angle), S = Math.sin(fit.angle);
      // material (+u, -v) maps to (x, s) by rotation; +v material is -(mapped m2 axis)
      const dX = C * oU - S * -oV;
      const dS = S * oU + C * -oV;
      const mu_ = uMat[c], mv_ = -vMat[c];
      const pxS = fit.tx + C * mu_ - S * mv_;
      const psS = fit.ty + S * mu_ + C * mv_;
      hands.push({ c, dX, dS, drX: pxS - xc, drS: psS - sc, pX: 0, pS: 0, g });
    }
    const handGamma = 1 / (HAND_K * h * h);
    const handLim = HAND_MAXF * h;

    for (let iter = 0; iter < 24; iter++) {
      for (const hd of hands) {
        const k = 1 / M + (hd.drX * hd.drX + hd.drS * hd.drS) / I;
        const relX = vX - om * hd.drS;
        const relS = vS + om * hd.drX;
        const bx = hd.dX / h, bs = hd.dS / h;
        let jx = (bx - relX - handGamma * hd.pX) / (k + handGamma);
        let js = (bs - relS - handGamma * hd.pS) / (k + handGamma);
        let npx = hd.pX + jx, nps = hd.pS + js;
        const mag = Math.hypot(npx, nps);
        if (mag > handLim) { npx *= handLim / mag; nps *= handLim / mag; }
        jx = npx - hd.pX; js = nps - hd.pS;
        hd.pX = npx; hd.pS = nps;
        vX += jx / M; vS += js / M; om += (hd.drX * js - hd.drS * jx) / I;
      }
      for (let p = 0; p < nP; p++) {
        const q = patches[p];
        if (q.count === 0) continue;
        const relX = vX - om * ds[p];
        const relS = vS + om * dx[p] - (nipClosed ? vsurf : 0);
        const k = kInv[p];
        let jx = -relX * k, js = -relS * k;
        let npx = pX[p] + jx, nps = pS[p] + js;
        if (wedgeFlag[p]) {
          // Edge at the wedge: forward slip is blocked by the closed nip, drag is limited.
          if (nps > lim[p]) nps = lim[p];
          const limX = lim[p];
          if (npx > limX) npx = limX; else if (npx < -limX) npx = -limX;
        } else {
          const mag = Math.hypot(npx, nps);
          if (mag > lim[p]) { const s = lim[p] / mag; npx *= s; nps *= s; }
        }
        jx = npx - pX[p]; js = nps - pS[p];
        pX[p] = npx; pS[p] = nps;
        vX += jx / M; vS += js / M; om += (dx[p] * js - ds[p] * jx) / I;
      }
    }
    // Hand reaction on patches for telemetry and slip flags.
    for (let p = 0; p < nP; p++) {
      const q = patches[p];
      if (q.count === 0) continue;
      const relX = vX - om * ds[p];
      const relS = vS + om * dx[p] - (nipClosed ? vsurf : 0);
      q.slip = Math.hypot(relX, relS);
      q.fx = pX[p] / h; q.fs = pS[p] / h;
    }
    for (const hd of hands) { hd.g.fMag = Math.hypot(hd.pX, hd.pS) / h; }
    // Clamp lamina velocity so a violent pull cannot tunnel the mesh.
    const sp = Math.hypot(vX, vS);
    const vmax = this.m.paper.maxSheetSpeed;
    if (sp > vmax) { const s = vmax / sp; vX *= s; vS *= s; om *= s; }
    const omax = (2 * vmax) / W;
    if (om > omax) om = omax; else if (om < -omax) om = -omax;
    this.laminaV = [vX, vS, om];
  }

  _edgeDir(c, alongU) {
    const { nx, ny, x, y, z } = this;
    const i = c % nx, j = (c - i) / nx;
    let a, b;
    if (alongU) { a = i > 0 ? c - 1 : c; b = i < nx - 1 ? c + 1 : c; }
    else { a = j > 0 ? c - nx : c; b = j < ny - 1 ? c + nx : c; }
    const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
    const L = Math.hypot(dx, dy, dz) || 1;
    return [dx / L, dy / L, dz / L];
  }

  /** Best rigid map of engaged material coords (u, -v) -> surface (x, s). */
  _fitLamina() {
    const { nE, eIdx, eXt, eTheta, uMat, vMat, r } = this;
    let mu = 0, mv = 0, mx = 0, ms = 0;
    for (let e = 0; e < nE; e++) { const i = eIdx[e]; mu += uMat[i]; mv += -vMat[i]; mx += eXt[e]; ms += eTheta[e]; }
    mu /= nE; mv /= nE; mx /= nE; ms /= nE;
    let h00 = 0, h01 = 0, h10 = 0, h11 = 0;
    for (let e = 0; e < nE; e++) {
      const i = eIdx[e];
      const a = uMat[i] - mu, b = -vMat[i] - mv, c = eXt[e] - mx, d = eTheta[e] - ms;
      h00 += a * c; h01 += a * d; h10 += b * c; h11 += b * d;
    }
    const angle = Math.atan2(h01 - h10, h00 + h11);
    const C = Math.cos(angle), S = Math.sin(angle);
    return { angle, tx: mx - (C * mu - S * mv), ty: ms - (S * mu + C * mv), n: nE };
  }

  // ---- impose lamina motion on engaged particles
  _applyEngagedKinematics() {
    const { nE, eIdx, eTheta, eRho, eXt, ePatch, eKind, r, x, y, z, fix, beta0, tableTip: tip, tableN: tn, tableS: ts, t: thick, gap } = this;
    if (nE === 0 || !this.laminaV) return;
    const [vX, vS, om] = this.laminaV;
    const f = this.lastFrame, h = this.lastH;
    const xc = this.laminaXc, sc = this.laminaSc;
    const rCont = r + thick / 2;
    const sTip = r * this.panTh0, rt = r + gap / 2;
    const { uMat, vMat, fit } = this;
    const fitC = Math.cos(fit.angle), fitS = Math.sin(fit.angle);
    const relax = this.patches.some((q) => q.count > 0 && q.wedge) ? 0 : BAND_RELAX;
    for (let e = 0; e < nE; e++) {
      const i = eIdx[e];
      const s = eTheta[e], ht = eRho[e], onPatch = ePatch[e] !== 255;
      const dx = eXt[e] - xc, ds = s - sc;
      const dX = (vX - om * ds) * h, dS = (vS + om * dx) * h;
      // The band is one rigid lamina: pull each row's stored error back onto the map so strain cannot collect here.
      const mu = uMat[i], mv = -vMat[i];
      const xt = eXt[e] + dX + relax * (fit.tx + fitC * mu - fitS * mv - eXt[e]);
      const newS = s + dS + relax * (fit.ty + fitS * mu + fitC * mv - s);
      if (newS < sTip) {
        // On the table plane: height measured from the plane.
        const a = sTip - newS;
        const g = eKind[e] === 1 ? ht : Math.max(thick / 2, ht - gap / 2);
        x[i] = f.cx + xt;
        y[i] = f.cy + tip[0] + ts[0] * a + tn[0] * g;
        z[i] = f.cz + tip[1] + ts[1] * a + tn[1] * g;
      } else {
        const theta = newS / r;
        let hh = eKind[e] === 1 ? Math.max(thick / 2 + gap / 2, ht + gap / 2) : ht;
        // The apron holds gripped rows down as it does loose ones, or a bulge above the line stands out into the lifted ribbon.
        if (eKind[e] !== 1 && theta > this.m.paper.feedRollAngle[1] && theta < APRON_END + APRON_BLEND) {
          const flat = thick / 2 + this.m.paper.bailGuideGap;
          hh = Math.min(hh, flat + Math.max(0, hh - flat) * Math.max(0, (theta - APRON_END) / APRON_BLEND));
        }
        let rho = r + Math.max(hh, thick / 2);
        if (onPatch) rho += (rCont - rho) * 0.35;
        const b = theta + beta0;
        x[i] = f.cx + xt;
        y[i] = f.cy + rho * Math.sin(b);
        z[i] = f.cz + rho * Math.cos(b);
      }
      fix[i] = 1;
      this.w[i] = 0;
    }
    this.laminaV = null;
  }

  // ---- grab kinematics: chase target, limited by anchors reach
  _applyGrabPositions(h) {
    if (this.grabs.size === 0) { this._restoreWeights(); return; }
    const { x, y, z, w, fix, uMat, vMat, nAnchor, anchorX, anchorY, anchorZ, anchorU, anchorV } = this;
    this._restoreWeights();
    const maxStep = HAND_VMAX * h;
    for (const g of this.grabs.values()) {
      for (let c = 0; c < g.ids.length; c++) {
        const i = g.ids[c];
        if (fix[i] === 1) continue;       // the patch owns this particle
        const tx = g.tx + g.ox[c], ty = g.ty + g.oy[c], tz = g.tz + g.oz[c];
        let dx = tx - x[i], dy = ty - y[i], dz = tz - z[i];
        const d = Math.hypot(dx, dy, dz);
        if (d > maxStep) { const s = maxStep / d; dx *= s; dy *= s; dz *= s; }
        let px = x[i] + dx, py = y[i] + dy, pz = z[i] + dz;
        // Long range attachments: never beyond the inextensible reach from an engaged patch.
        for (let a = 0; a < nAnchor; a++) {
          const ax = anchorX[a], ay = anchorY[a], az = anchorZ[a];
          const reach = Math.hypot(uMat[i] - anchorU[a], vMat[i] - anchorV[a]) * 1.0005 + 1e-5;
          const rx = px - ax, ry = py - ay, rz = pz - az;
          const dd = Math.hypot(rx, ry, rz);
          if (dd > reach) { const s = reach / dd; px = ax + rx * s; py = ay + ry * s; pz = az + rz * s; }
        }
        // The nearest gripped row of this column is an anchor too, and usually the tighter one.
        const near = this.nE > 0 ? this._nearestBandRow(i) : -1;
        if (near >= 0) {
          const col = i % this.nx, row = (i - col) / this.nx, a = col + near * this.nx;
          const reach = Math.abs(row - near) * this.dv * 1.002;
          const rx = px - x[a], ry = py - y[a], rz = pz - z[a];
          const dd = Math.hypot(rx, ry, rz);
          if (dd > reach) { const s = reach / dd; px = x[a] + rx * s; py = y[a] + ry * s; pz = z[a] + rz * s; }
        }
        x[i] = px; y[i] = py; z[i] = pz;
        fix[i] = 2;
        w[i] = 0;
      }
    }
  }

  _restoreWeights() {
    const { fix, w, n, w0 } = this;
    for (let i = 0; i < n; i++) w[i] = fix[i] === 0 ? w0 : 0;
  }

  /** Violent motion outruns the fixed sweep budget. Spend extra sweeps only while an edge is badly stretched. */
  _limitStrain(fwd, limit) {
    const { x, y, z, uA, uB, vA, vB, du, dv, w } = this;
    const worst = (A, B, rest) => {
      let m = 0;
      for (let k = 0; k < A.length; k++) {
        const a = A[k], b = B[k];
        if (w[a] + w[b] === 0) continue;
        const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
        const d2 = (dx * dx + dy * dy + dz * dz) / (rest * rest);
        if (d2 > m) m = d2;
      }
      return m;
    };
    const lim2 = limit * limit;
    for (let pass = 0; pass < 6; pass++) {
      if (worst(vA, vB, dv) < lim2 && worst(uA, uB, du) < lim2) return;
      this._sweepPairs(vA, vB, dv, pass % 2 === 0 ? fwd : !fwd);
      this._sweepPairs(uA, uB, du, pass % 2 === 0 ? fwd : !fwd);
    }
  }

  // ---- constraint sweeps
  _sweepPairs(A, B, rest, forward) {
    const { x, y, z, w } = this;
    const m = A.length;
    const start = forward ? 0 : m - 1;
    const end = forward ? m : -1;
    const step = forward ? 1 : -1;
    for (let k = start; k !== end; k += step) {
      const a = A[k], b = B[k];
      const wa = w[a], wb = w[b];
      const ws = wa + wb;
      if (ws === 0) continue;
      const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1e-14) continue;
      const d = Math.sqrt(d2);
      const c = (d - rest) / (d * ws);
      const px = dx * c, py = dy * c, pz = dz * c;
      x[a] += wa * px; y[a] += wa * py; z[a] += wa * pz;
      x[b] -= wb * px; y[b] -= wb * py; z[b] -= wb * pz;
    }
  }

  /** One implicit bending step on all rows and columns. Must run every substep: a delayed correction feeds back through the velocity. */
  _solveBending(hh) {
    const { nx, ny, du, dv, m, w } = this;
    const D = m.paper.bendingStiffness, rho = m.paper.grammage;
    const aV = (hh * D) / (rho * dv * dv * dv * dv), aU = (hh * D) / (rho * du * du * du * du);
    // Fixed order: alternating it per substep leaves a period-two oscillation at a kink.
    for (let i = 0; i < nx; i++) this._bendLine(i, nx, ny, aV, w);
    for (let j = 0; j < ny; j++) this._bendLine(j * nx, 1, nx, aU, w);
  }

  /** Solve (I + a B) p = p* for one line of L nodes, where B is the free-ended second-difference squared; pinned nodes stay put. */
  _bendLine(start, stride, L, a, w) {
    const { x, y, z, bD: D, bL1: l1, bL2: l2, bX: bx, bY: by, bZ: bz, bPin: pin } = this;
    const PEN = 1e8;
    let any = false;
    for (let i = 0; i < L; i++) {
      const k = start + i * stride;
      pin[i] = w[k] === 0 ? 1 : 0;
      if (!pin[i]) any = true;
      bx[i] = x[k]; by[i] = y[k]; bz[i] = z[k];
      if (pin[i]) { bx[i] *= PEN; by[i] *= PEN; bz[i] *= PEN; }
    }
    if (!any) return;
    // LDL^T of the pentadiagonal, forward substitution as it goes.
    const last = L - 1;
    for (let i = 0; i < L; i++) {
      const bd = i === 0 || i === last ? 1 : i === 1 || i === last - 1 ? 5 : 6;
      let d = 1 + a * bd + (pin[i] ? PEN : 0);
      const lp = i >= 1 ? l1[i - 1] : 0, lpp = i >= 2 ? l2[i - 2] : 0;
      const Dp = i >= 1 ? D[i - 1] : 0, Dpp = i >= 2 ? D[i - 2] : 0;
      d -= lp * lp * Dp + lpp * lpp * Dpp;
      D[i] = d;
      if (i < last) {
        const e = a * (i === 0 || i === last - 1 ? -2 : -4);
        l1[i] = (e - (i >= 1 ? lp * l2[i - 1] * Dp : 0)) / d;
      }
      if (i < L - 2) l2[i] = a / d;
      if (i >= 1) { bx[i] -= lp * bx[i - 1]; by[i] -= lp * by[i - 1]; bz[i] -= lp * bz[i - 1]; }
      if (i >= 2) { bx[i] -= lpp * bx[i - 2]; by[i] -= lpp * by[i - 2]; bz[i] -= lpp * bz[i - 2]; }
    }
    for (let i = last; i >= 0; i--) {
      bx[i] /= D[i]; by[i] /= D[i]; bz[i] /= D[i];
      if (i < last) { bx[i] -= l1[i] * bx[i + 1]; by[i] -= l1[i] * by[i + 1]; bz[i] -= l1[i] * bz[i + 1]; }
      if (i < last - 1) { bx[i] -= l2[i] * bx[i + 2]; by[i] -= l2[i] * by[i + 2]; bz[i] -= l2[i] * bz[i + 2]; }
      if (!pin[i]) { const k = start + i * stride; x[k] = bx[i]; y[k] = by[i]; z[k] = bz[i]; }
    }
  }

  // ---- long range attachments: rows can never be further from an anchored row than their rest distance
  _applyLongRange() {
    const { nx, ny, x, y, z, w, fix, dv, uMat, vMat, grabs } = this;
    // Hand reach first, then the band: what the nip holds must win over what the hand asks for.
    for (const g of grabs.values()) {
      const a = g.ids[0];
      for (let k = 0; k < this.n; k++) {
        if (w[k] === 0) continue;
        const reach = Math.hypot(uMat[k] - uMat[a], vMat[k] - vMat[a]) * 1.002 + 1e-4;
        const dx = x[k] - x[a], dy = y[k] - y[a], dz = z[k] - z[a];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > reach * reach) { const s = reach / Math.sqrt(d2); x[k] = x[a] + dx * s; y[k] = y[a] + dy * s; z[k] = z[a] + dz * s; }
      }
    }
    if (this.nE > 0) {
      for (let i = 0; i < nx; i++) {
        let jMin = -1, jMax = -1;
        for (let j = 0; j < ny; j++) { if (fix[i + j * nx] === 1) { if (jMin < 0) jMin = j; jMax = j; } }
        if (jMin < 0) {
          // No gripped row in this column (only the far side's rolls hold the sheet): tie it to the nearest column that has one.
          let ref = -1;
          for (let d = 1; d < nx && ref < 0; d++) for (const c of [i - d, i + d]) {
            if (c < 0 || c >= nx) continue;
            for (let j = 0; j < ny && ref < 0; j++) if (fix[c + j * nx] === 1) ref = c + j * nx;
            if (ref >= 0) break;
          }
          if (ref < 0) continue;
          for (let j = 0; j < ny; j++) {
            const k = i + j * nx;
            if (w[k] === 0) continue;
            const reach = Math.hypot(uMat[k] - uMat[ref], vMat[k] - vMat[ref]) * 1.002;
            const dx = x[k] - x[ref], dy = y[k] - y[ref], dz = z[k] - z[ref];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > reach * reach) { const s = reach / Math.sqrt(d2); x[k] = x[ref] + dx * s; y[k] = y[ref] + dy * s; z[k] = z[ref] + dz * s; }
          }
          continue;
        }
        const aMin = i + jMin * nx, aMax = i + jMax * nx;
        for (let j = 0; j < jMin; j++) {
          const k = i + j * nx;
          if (w[k] === 0) continue;
          const reach = (jMin - j) * dv * 1.002;
          const dx = x[k] - x[aMin], dy = y[k] - y[aMin], dz = z[k] - z[aMin];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > reach * reach) { const s = reach / Math.sqrt(d2); x[k] = x[aMin] + dx * s; y[k] = y[aMin] + dy * s; z[k] = z[aMin] + dz * s; }
        }
        for (let j = jMax + 1; j < ny; j++) {
          const k = i + j * nx;
          if (w[k] === 0) continue;
          const reach = (j - jMax) * dv * 1.002;
          const dx = x[k] - x[aMax], dy = y[k] - y[aMax], dz = z[k] - z[aMax];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > reach * reach) { const s = reach / Math.sqrt(d2); x[k] = x[aMax] + dx * s; y[k] = y[aMax] + dy * s; z[k] = z[aMax] + dz * s; }
        }
      }
    }
  }

  // ---- contacts
  _collide(h, f) {
    const { n, x, y, z, xp, yp, zp, fix, t, r, pl, tableTip, tableN, tableS, tableL, tableHalfW, rPanInner, rPanOuter, panTh0, panTh1, beta0, mu } = this;
    const p = this.m.paper;
    const halfT = t * 0.5;
    const rC = r + halfT;
    const rC2 = rC * rC;
    const cx = f.cx, cy = f.cy, cz = f.cz;
    const halfL = pl / 2;
    const dcx = f.dcx, dcy = f.dcy;
    const omega = f.omega, h_ = h;
    const halfPan = pl / 2 + 0.018;
    const bailActive = f.bailFactor > 0;
    const bailAngle = p.bailAngle, bailGuideFrom = p.feedRollAngle[1], bailRodR = p.bailRodRadius;
    const rBailBar = r + p.bailRollerRadius + 0.00018, bailSin = Math.sin(bailAngle + beta0), bailCos = Math.cos(bailAngle + beta0);
    const bailPatches = this.bailPatches ??= this.patches.filter((q) => q.kind === 'bail');
    let contacts = 0;
    const gravCap = 2 * 9.81 * h * h;
    const lipOn = f.nipFactor > 0 && !this.engaged;
    const rearRoll = this.patches[0];
    const lipTheta = rearRoll.theta - (0.25 * rearRoll.halfArc) / r;
    const panR = rPanInner + 0.0006, panOuterBig = rPanOuter + 0.004;
    const MB = MACHINE_BODY, MB_TOP_MAX = 0.1456 + halfT + 0.01;
    const nxRow = this.nx;
    // Rows ahead of the rollers have been typed on and lie on top of the part still waiting on the table.
    let firstGripped = -1, lastGripped = -1;
    for (let i = 0; i < n; i++) if (fix[i] === 1) { firstGripped = (i / nxRow) | 0; break; }
    for (let i = n - 1; i >= 0; i--) if (fix[i] === 1) { lastGripped = (i / nxRow) | 0; break; }
    if (lastGripped >= 0) this.lastGrippedRow = lastGripped;

    for (let i = 0; i < n; i++) {
      const isFixedPatch = fix[i] === 1;
      if (isFixedPatch) continue;
      const grabbed = fix[i] === 2;
      let px = x[i], py = y[i], pz = z[i];
      let dn = 0, nx = 0, ny = 0, nz = 0, msu = 0, svx = 0, svy = 0, svz = 0, contact = false;

      // Desk
      if (py < halfT) { dn = halfT - py; py = halfT; ny = 1; msu = p.deskFriction; contact = true; }

      // Machine body: the sheet rests on it and cannot get inside.
      if (px > -MB.halfWidth && px < MB.halfWidth && pz > MB.zMin && pz < MB.zMax && py < MB_TOP_MAX) {
        const top = bodyTop(px, pz) + halfT;
        if (py < top) {
          const fromX = xp[i], fromZ = zp[i];
          const inPrev = fromX > -MB.halfWidth && fromX < MB.halfWidth && fromZ > MB.zMin && fromZ < MB.zMax;
          if (!inPrev && yp[i] < top) {
            // Came in through a side: back out the way it came, against the outer wall.
            if (fromX <= -MB.halfWidth) px = -MB.halfWidth - halfT;
            else if (fromX >= MB.halfWidth) px = MB.halfWidth + halfT;
            else if (fromZ <= MB.zMin) pz = MB.zMin - halfT;
            else pz = MB.zMax + halfT;
          } else {
            const corr = top - py;
            if (corr > dn) { dn = corr; ny = 1; nz = 0; nx = 0; msu = p.deskFriction; contact = true; svx = 0; svy = 0; svz = 0; }
            py = top;
          }
        }
      }

      // Table: the plane moves with the carriage. Rests on the side facing the platen.
      const dy = py - cy, dz = pz - cz, dxx = px - cx;
      const tPy = py - (cy + tableTip[0]), tPz = pz - (cz + tableTip[1]);
      if (tPy * tPy + tPz * tPz < 0.08 && Math.abs(dxx) < tableHalfW + 0.01) {
        const gd = tPy * tableN[0] + tPz * tableN[1];
        const a = tPy * tableS[0] + tPz * tableS[1];
        if (a > -0.001 && a < tableL + TABLE_OVERHANG && Math.abs(dxx) < tableHalfW) {
          const prevTy = yp[i] - (cy + tableTip[0]) , prevTz = zp[i] - (cz + tableTip[1]);
          const gprev = prevTy * tableN[0] + prevTz * tableN[1];
          const row = (i / nxRow) | 0;
          const rest = halfT + (firstGripped > 0 && row < firstGripped ? TABLE_LAYER_GAP : 0);
          // A draped tail is drawn back over the top edge as the sheet feeds, never through the table: the fold stays with the row ahead of it.
          const k0 = i - nxRow;
          const overTheTop = gprev < 0 && gd > -TABLE_CROSS_REACH && this.engaged && k0 >= 0 && ((y[k0] - (cy + tableTip[0])) * tableN[0] + (z[k0] - (cz + tableTip[1])) * tableN[1]) >= 0;
          if ((gprev >= 0 || overTheTop) && gd < rest) {
            const corr = rest - gd;
            if (corr > dn) { dn = corr; ny = tableN[0]; nz = tableN[1]; nx = 0; msu = p.tableFriction; contact = true; svx = dcx / h_; svy = dcy / h_; svz = 0; }
            py += corr * tableN[0]; pz += corr * tableN[1];
          } else if (gprev < 0 && gd > -halfT) {
            // Hanging behind the table: the back face blocks it too.
            const corr = gd + halfT;
            py -= corr * tableN[0]; pz -= corr * tableN[1];
          }
        }
      }

      // Platen cylinder + pan channel
      const d2 = dy * dy + dz * dz;
      if (dxx > -halfL - 0.03 && dxx < halfL + 0.03 && d2 < 0.0049) {
        const rho = Math.sqrt(d2) || 1e-9;
        const inside = dxx >= -halfL && dxx <= halfL;
        let nyC = dy / rho, nzC = dz / rho;
        if (inside && rho < rC) {
          // Ejected deep inside the roller: leave by the side the particle came from, not the nearest side,
          // otherwise neighbouring rows cross the axis and the sheet is split across the platen.
          const py0 = yp[i] - cy, pz0 = zp[i] - cz, rp = Math.sqrt(py0 * py0 + pz0 * pz0) || 1e-9;
          const dot = (py0 * nyC + pz0 * nzC) / rp;
          if (dot < 0.6) { nyC = py0 / rp; nzC = pz0 / rp; }
        }
        if (rho < rC && Math.abs(dxx) < halfL + CARRIAGE_END) {
          const corr = rC - rho;
          if (corr > dn) { dn = corr; ny = nyC; nz = nzC; nx = 0; msu = mu; contact = true;
            const tanY = nzC, tanZ = -nyC;
            const vs = omega * rC;
            svx = dcx / h_; svy = dcy / h_ + vs * tanY; svz = vs * tanZ;
          }
          py = cy + nyC * rC; pz = cz + nzC * rC;
        } else if (rho < panOuterBig && Math.abs(dxx) <= halfPan) {
          // Pan: a thin shell between panTh0..panTh1. Particles stay on the side they came from.
          const beta = Math.atan2(dy, dz);
          const theta = wrap(beta - beta0);
          if (theta >= panTh0 && theta <= panTh1) {
            const dpy = yp[i] - cy, dpz = zp[i] - cz;
            const rhoPrev = Math.sqrt(dpy * dpy + dpz * dpz);
            if (rhoPrev < panR) {
              // A closed nip stops the whole leading edge until a roll patch takes hold of it.
              if (lipOn && theta > lipTheta && theta < lipTheta + 0.5) {
                const b = lipTheta + beta0, rk = Math.max(rho, rC);
                py = cy + rk * Math.sin(b); pz = cz + rk * Math.cos(b);
              }
              // In the channel: stay inside the pan's inner face.
              if (rho > rPanInner) {
                const corr = rho - rPanInner;
                if (corr > dn) { dn = corr; ny = -nyC; nz = -nzC; nx = 0; msu = p.panFriction; contact = true; svx = dcx / h_; svy = dcy / h_; svz = 0; }
                py = cy + nyC * rPanInner; pz = cz + nzC * rPanInner;
              }
            } else if (rho < rPanOuter) {
              const corr = rPanOuter - rho;
              if (corr > dn) { dn = corr; ny = nyC; nz = nzC; nx = 0; msu = p.panFriction; contact = true; svx = dcx / h_; svy = dcy / h_; svz = 0; }
              py = cy + nyC * rPanOuter; pz = cz + nzC * rPanOuter;
            }
          }
        }

        // Bail: presses the sheet to the platen when closed.
        if (inside) {
          // The apron is fixed to the carriage: from the front roll to just above the print line the sheet stays on the platen,
          // with the bail open too, so it cannot stand out into the ribbon.
          const th0 = wrap(Math.atan2(dy, dz) - beta0);
          if (th0 > bailGuideFrom && th0 <= APRON_END && rho < r + 0.016) {
            const rMax = rC + p.bailGuideGap;
            if (rho > rMax) { const rNew = Math.max(rMax, rho - BAIL_PRESS_STEP); py = cy + nyC * rNew; pz = cz + nzC * rNew; }
          }
        }
        if (bailActive && inside) {
          const th = wrap(Math.atan2(dy, dz) - beta0);
          if (th > APRON_END && th < bailAngle + 0.03 && rho < (th < bailAngle - 0.1 ? r + 0.016 : rBailBar + bailRodR)) {
            // Apron and bail: from the front roll the sheet is led along the platen, narrowing to the roller line.
            const rMax = rC + p.bailGuideGap * Math.min(1, Math.max(0, (bailAngle - th) / 0.3));
            if (rho > rMax) {
              const rNew = Math.max(rMax, rho - BAIL_PRESS_STEP);
              py = cy + nyC * rNew; pz = cz + nzC * rNew;
            }
          }
          // The bar itself: a sheet lying over it stays over it.
          const by = py - (cy + rBailBar * bailSin), bz = pz - (cz + rBailBar * bailCos), bd = Math.hypot(by, bz);
          const bMin = bailRodR + halfT;
          if (bd < bMin && bd > 1e-9) { py += (by / bd) * (bMin - bd); pz += (bz / bd) * (bMin - bd); }
        }
      }

      if (contact && !grabbed && dn > 0) {
        // Coulomb position-level friction against the moving surface.
        const dsx = px - xp[i] - svx * h_, dsy = py - yp[i] - svy * h_, dsz = pz - zp[i] - svz * h_;
        const dotN = dsx * nx + dsy * ny + dsz * nz;
        const tx = dsx - dotN * nx, ty = dsy - dotN * ny, tz = dsz - dotN * nz;
        const lt = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (lt > 1e-12) {
          // The normal correction of a nearly massless sheet is mostly solver projection, not load.
          // Cap the load to what gravity can press into a contact; the nips carry the real clamp forces.
          // A sheet bent to the platen also presses on it with its bending stiffness, about D / R^3 per unit area.
          const dnLoad = Math.min(dn, gravCap * (msu === p.deskFriction || msu === p.tableFriction ? 1 : BEND_CONTACT_FACTOR));
          const scale = Math.min((msu * dnLoad) / lt, 1);
          px -= tx * scale; py -= ty * scale; pz -= tz * scale;
        }
        contacts++;
      }
      x[i] = px; y[i] = py; z[i] = pz;
    }
    return contacts;
  }

  // ---- interaction API (world space)
  grab(point, radius = 0.015) {
    const { n, x, y, z, nx, uMat, vMat, dv } = this;
    let best = -1, bd = radius * radius;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - point[0], dy = y[i] - point[1], dz = z[i] - point[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best < 0) return -1;
    const ids = [best], ox = [0], oy = [0], oz = [0];
    const pu = uMat[best], pv = vMat[best];
    const ring = GRIP_RADIUS;
    for (let i = 0; i < n; i++) {
      if (i === best) continue;
      const d = Math.hypot(uMat[i] - pu, vMat[i] - pv);
      if (d < ring) { ids.push(i); ox.push(x[i] - x[best]); oy.push(y[i] - y[best]); oz.push(z[i] - z[best]); }
    }
    const id = this.nextGrab++;
    this.grabs.set(id, { ids: Int32Array.from(ids), ox: Float64Array.from(ox), oy: Float64Array.from(oy), oz: Float64Array.from(oz), tx: x[best], ty: y[best], tz: z[best], overX: 0, overY: 0, overZ: 0, fMag: 0, slipT: 0 });
    this.asleep = false;
    return id;
  }

  move(id, point) {
    const g = this.grabs.get(id);
    if (!g) return;
    g.tx = point[0]; g.ty = point[1]; g.tz = point[2];
    this.asleep = false;
  }

  release(id) { if (this.grabs.delete(id)) this.asleep = false; }

  syncPositions() {
    const { n, x, y, z, positions } = this;
    for (let i = 0; i < n; i++) { positions[i * 3] = x[i]; positions[i * 3 + 1] = y[i]; positions[i * 3 + 2] = z[i]; }
  }

  // ---- geometric queries
  /** Skew (radians) of the sheet in the platen surface frame, from particles on the platen. */
  skewAngle(f) {
    // While gripped, the rigid fit of the contact band is the skew glyphs actually follow; a fit over
    // whatever lies near the cylinder picks up loose rows and disagreed with the print line by 1-3 degrees.
    if (this.engaged && this.nE >= 8) { const fit = this._fitLamina(); return { angle: fit.angle, n: fit.n, mx: 0, ms: 0 }; }
    const { n, x, y, z, r, uMat, vMat, beta0 } = this;
    const rMax = r + 0.0015;
    let mu = 0, mv = 0, mx = 0, ms = 0, cnt = 0;
    const list = [];
    for (let i = 0; i < n; i++) {
      const dy = y[i] - f.cy, dz = z[i] - f.cz;
      const rho = Math.hypot(dy, dz);
      if (rho > rMax || rho < r - 0.001) continue;
      const beta = Math.atan2(dy, dz);
      const th = wrap(beta - beta0);
      if (th > 1.2 || th < -2.6) continue;
      const xt = x[i] - f.cx;
      list.push(uMat[i], -vMat[i], xt, r * th);
      mu += uMat[i]; mv += -vMat[i]; mx += xt; ms += r * th; cnt++;
    }
    if (cnt < 8) return null;
    mu /= cnt; mv /= cnt; mx /= cnt; ms /= cnt;
    let h00 = 0, h01 = 0, h10 = 0, h11 = 0;
    for (let k = 0; k < list.length; k += 4) {
      const a = list[k] - mu, b = list[k + 1] - mv, c = list[k + 2] - mx, d = list[k + 3] - ms;
      h00 += a * c; h01 += a * d; h10 += b * c; h11 += b * d;
    }
    return { angle: Math.atan2(h01 - h10, h00 + h11), n: cnt, mx: mx, ms: ms };
  }

  /** Sum over patches of the current normal force on the sheet. */
  gripSummary() {
    return this.patches.map((q) => ({ kind: q.kind, theta: q.theta, xc: q.xc, count: q.count, N: q.N, slip: q.slip, fx: q.fx, fs: q.fs, wedge: q.wedge }));
  }
}
