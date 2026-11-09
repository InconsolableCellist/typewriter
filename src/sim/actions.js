// Print actions. MechanicalSim dispatches on machine.action.type so upstrike, typewheel or golfball
// machines can be added without touching the common mechanism (keys, escapement, carriage, platen).
// Action interface:
//   keyForce(k, x, v)  -> reaction force on printing key k from the action linkage (N)
//   step(h)            -> integrate the action DOFs and contacts for one substep
//   setEnv()           -> recompute contact gap after env changes
//   grabForce(i, f)    -> add grab generalised force to DOF i of the action (bar i torque, N m)
//   position(i), velocity(i), wake(i)
//   energy(), snapshot(state, L), exportState(), importState(s)
import { PORT, AC } from './ports.js';
import { FACE_TABLE_N } from './faces.js';

const S_LUT_N = 2048;
const TRACE_LEN = 256;
const TRACE_DECIM = 4; // substeps per trace sample
const PHANTOM_MAX = 64;
// Measured impact speed of an ordinary held stroke (finger N, m/s): what an instant strike is given in unlimited typing.
const V_OF_F = [[20, 0.35], [22, 1.23], [25, 1.93], [28, 2.41], [32, 2.93], [36, 3.33], [40, 3.66], [50, 4.31]];
function lerpTable(t, x) {
  for (let i = 1; i < t.length; i++) {
    if (x <= t[i][0]) return t[i - 1][1] + ((x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])) * (t[i][1] - t[i - 1][1]);
  }
  return t[t.length - 1][1];
}
const GRAVITY = 9.81;
const BEARING_Z = 2.5e-4;   // rad, bristle deflection at which the bearing slips
const GUIDE_KT = 8e4;       // N/m, tangential stiffness of a slug pressed against the guide jaw
const OMEGA_MAX = 260;      // rad/s, hard rate limit (about 24 m/s at the slug): nothing real gets there
const LATV_MAX = 40;        // m/s
const LAT_MAX = 0.02;       // m, a bent bar in the basket cannot go further than this

export class TypebarAction {
  constructor(sim) {
    this.sim = sim;
    const { m: machine, g: geo } = sim;
    this.m = machine;
    this.geo = geo;
    const n = geo.nPrint;
    this.n = n;
    this.theta = new Float64Array(n);
    this.omega = new Float64Array(n);
    this.lat = new Float64Array(n);
    this.latV = new Float64Array(n);
    this.tau = new Float64Array(n);
    this.latF = new Float64Array(n);
    this.sleepCount = new Int32Array(n);
    this.awake = new Uint8Array(n);
    this.activeList = new Int32Array(n);
    this.nActive = 0;
    // per-bar constants
    this.J = new Float64Array(n);
    this.thetaTravel = new Float64Array(n);
    this.thetaContact = new Float64Array(n);
    this.lever = new Float64Array(n);
    this.offLat = new Float64Array(n);
    this.gravTab = new Float64Array(n * 65);
    this.gravPot = new Float64Array(n * 65);
    // geometry for bar-bar contact: pivot, strike direction, perp, axis
    this.pivot = new Float64Array(n * 3);
    this.sDir = new Float64Array(n * 3);
    this.pDir = new Float64Array(n * 3);
    this.axis = new Float64Array(n * 3);
    // slug contact bookkeeping
    this.inContact = new Uint8Array(n);
    this.caseIdx = new Uint8Array(n);
    this.tBegin = new Float64Array(n);
    this.vIn = new Float64Array(n);
    this.peakF = new Float64Array(n);
    this.padOn = new Uint8Array(this.peakF.length);
    this.maxD = new Float64Array(n);
    this.traceN = new Int32Array(n);
    this.traceC = new Int32Array(n);
    this.traceF = new Float32Array(n * TRACE_LEN);
    this.traceD = new Float32Array(n * TRACE_LEN);
    // bar-bar contact pool: a bar is a shank capsule plus a slug capsule, so each pair of bars has up to
    // four segment pairs (shank/shank, slug/slug, slug/shank both ways), each with a tangential bristle.
    this.contactSlot = new Int32Array(n * n * 4);  // segment pair -> slot + 1
    this.poolMax = 32;
    this.poolUsed = new Uint8Array(this.poolMax);
    this.poolZ = new Float64Array(this.poolMax * 3);
    this.phantomF = new Float32Array(PHANTOM_MAX * TRACE_LEN);
    this.phantomLen = new Int32Array(PHANTOM_MAX); this.phantomPos = new Int32Array(PHANTOM_MAX); this.nPhantom = 0;
    this.segBox = new Float64Array(n * 12);        // per active bar: min/max x,y,z of shank, then slug
    this.segs = new Float64Array(n * 18);          // per active bar: shank a, b, slug a, b, dv, dir
    this.inRange = new Uint8Array(n);
    this.pairEnergy = 0;
    this.S = new Float64Array(S_LUT_N + 2);
    this.dS = new Float64Array(S_LUT_N + 2);
    this.barOffset = new Float64Array(n);
    this.bearingZ = new Float64Array(n);     // Dahl bristle of the pivot bearing (rad)
    this.guideZ = new Float64Array(n);       // Dahl bristle of the slug against the type guide jaws (m)
    this.setupConstants();
  }

  setupConstants() {
    const { m, geo: g, n } = this;
    const tb = m.typebars, link = m.linkage;
    this.Lbar = tb.length;
    this.T0 = tb.returnSpringTorque; this.Tr = tb.returnSpringRate;
    this.Tc = tb.bearingCoulomb; this.Cv = tb.bearingViscous;
    this.kPad = tb.restPadStiffness; this.cPad = tb.restPadDamping;
    // Bar flexure as lateral DOF: slug mass plus a third of the shank.
    this.latMass = tb.slugMass + tb.barMass / 3;
    // Sideways the bar is a thin steel cantilever (3EI/L^3 with the bar's thin dimension), far softer than
    // in its own plane: this is why a slug can be shouldered past its neighbour and stay wedged there.
    const I = tb.barWidth * tb.barThickness ** 3 / 12;
    this.kLat = tb.lateralStiffness ?? (3 * m.slug.steelE * I) / tb.length ** 3;
    const wLat = Math.sqrt(this.kLat / this.latMass);
    this.cLat = (2 * this.latMass * wLat) / (2 * (tb.lateralQ ?? 18));
    const guide = tb.typeGuide;
    this.kGuide = guide.stiffness;
    this.guideMu = guide.friction;
    // Half clearance of the slug in the guide jaws
    this.guideClear = Math.max(0, (guide.width - m.slug.faceWidth) / 2);
    this.guideTaper = guide.taper ?? 0.12;    // m/rad flare of the guide mouth
    this.guideThroatOffset = guide.engageBefore;
    this.rBar = tb.barThickness / 2;     // lateral half-thickness of the bar shank
    this.rSlug = (m.slug.bodyWidth ?? m.slug.faceWidth) / 2;   // the slug body is as wide as the type face
    this.slugDepth = m.slug.bodyDepth ?? 0.0042;                 // slug body, radial
    // The slug is bevelled towards both ends, so across the motion it is a lens rather than a circle: a nose
    // that meets a neighbour off-centre is pushed sideways instead of stopping dead. slugNose is the ratio of
    // the bevel's length to the half width.
    this.slugNose = m.slug.noseRatio ?? 1.6;
    this.slugHalf = Math.max(0.0005, m.slug.faceHeight / 2 - this.rSlug * this.slugNose);
    this.kBarBar = tb.barContactStiffness ?? 5e5;
    this.cBarBar = tb.barContactDamping ?? 30;
    this.barFriction = tb.barFriction ?? 0.22;
    this.kBarBristle = 1.2e5;
    this.pairRangeTheta = tb.pairRangeTheta ?? 1.7;   // only bars this close to the platen can clash
    // A sideways load on the bar loads its pivot and segment slot: the bearing's Coulomb limit grows with
    // the lateral bending force. This is what holds a wedged pair up against the return springs.
    this.pivotBind = tb.pivotBindArm ?? 1.2e-2;
    this.alpha = m.platen.huntCrossleyAlpha;
    this.linkMaxFrac = link.maxReachFraction ?? 0.93;
    const coupled = link.coupledFraction;
    this.thetaCoupled = coupled;
    const T = link.keyTravel;
    this.keyTravel = T;
    // Coupled bar angle at full key travel = coupledFraction * thetaTravel (per bar).
    const a = link.accelShape, b = link.shapeLinear ?? 0.2;
    for (let i = 0; i <= S_LUT_N + 1; i++) {
      const u = Math.min(1, i / S_LUT_N);
      this.S[i] = b * u + (1 - b) * Math.pow(u, a);
      this.dS[i] = b + (1 - b) * a * Math.pow(Math.max(u, 1e-6), a - 1);
    }
    // Referred to the key at the mean leverage so the units in the machine file keep their meaning.
    const meanTheta = coupled * g.bars[0].thetaTravel;
    const Lref = meanTheta / T;
    this.Klink = link.linkStiffness / (Lref * Lref);
    this.Clink = link.linkDamping / (Lref * Lref);
    this.Cbuffer = link.reboundBuffer ?? 2.5e-3;            // N m s/rad, leather buffer met by a rebounding bar
    this.linkLostMotion = link.reboundLostMotion ?? 0.09; // rad of bar travel the buffer can absorb
    this.reboundLatch = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const bar = g.bars[i];
      this.J[i] = bar.inertia;
      this.thetaTravel[i] = bar.thetaTravel;
      this.lever[i] = bar.leverage;
      this.barOffset[i] = bar.offsetX;
      this.offLat[i] = bar.offsetX;
      for (let c = 0; c < 3; c++) {
        this.pivot[i * 3 + c] = bar.pivot[c];
        this.sDir[i * 3 + c] = bar.strikeDir[c];
        this.axis[i * 3 + c] = bar.axis[c];
      }
      // perp = axis x strikeDir so dir(a) = strikeDir*cos(a) + perp*sin(a), a = thetaTravel - theta.
      const ax = bar.axis, sd = bar.strikeDir;
      this.pDir[i * 3] = ax[1] * sd[2] - ax[2] * sd[1];
      this.pDir[i * 3 + 1] = ax[2] * sd[0] - ax[0] * sd[2];
      this.pDir[i * 3 + 2] = ax[0] * sd[1] - ax[1] * sd[0];
      // Gravity: centre of mass of the bar plus slug, torque and potential tabulated over theta.
      const mL = (tb.barMass * tb.length / 2 + tb.slugMass * tb.length) * GRAVITY;
      for (let j = 0; j <= 64; j++) {
        const th = (j / 64) * bar.thetaTravel * 1.2;
        const a2 = bar.thetaTravel - th;
        // Height of the centre of mass = mL * dir_y(a), dir_y(a) = s_y cos a + p_y sin a, a = thetaTravel
        // - theta, so torque = -d(mL dir_y)/dtheta = mL (-s_y sin a + p_y cos a).
        this.gravTab[i * 65 + j] = mL * (-bar.strikeDir[1] * Math.sin(a2) + this.pDir[i * 3 + 1] * Math.cos(a2));
      }
      for (let j = 1, pot = 0; j <= 64; j++) {
        pot += 0.5 * (this.gravTab[i * 65 + j - 1] + this.gravTab[i * 65 + j]) * (bar.thetaTravel * 1.2 / 64);
        this.gravPot[i * 65 + j] = pot;
      }
    }
    this.updateContactGap();
  }

  updateContactGap() {
    const { sim, n } = this;
    const gap = sim.stackCaliper();
    for (let i = 0; i < n; i++) this.thetaContact[i] = this.thetaTravel[i] - gap / this.Lbar;
  }

  setEnv() { this.updateContactGap(); }

  wake(i) {
    if (!this.awake[i]) {
      this.awake[i] = 1;
      this.activeList[this.nActive++] = i;
    }
    this.sleepCount[i] = 0;
  }

  position(i) { return this.theta[i]; }
  velocity(i) { return this.omega[i]; }

  /** Force reaction on key k from the one-way link. The link can only pull. */
  keyForce(k, x, v) {
    const T = this.keyTravel;
    const lever = this.lever[k];
    let u = x / T;
    if (u <= 0) u = 0;
    if (u > 1) u = 1;
    const idx = u * S_LUT_N;
    const i0 = idx | 0;
    const f = idx - i0;
    const s = this.S[i0] + (this.S[i0 + 1] - this.S[i0]) * f;
    const ds = this.dS[i0] + (this.dS[i0 + 1] - this.dS[i0]) * f;
    const thetaC = this.thetaCoupled * this.thetaTravel[k];
    let L = lever * thetaC * ds / T;                    // dtheta/dx
    let thetaLink = lever * thetaC * s;
    // The link runs out of reach before the slug can touch the platen, whatever the leverage tolerance:
    // the last part of the arc is always free flight, and a held key cannot drive the bar to the platen.
    const cap = this.linkMaxFrac * this.thetaTravel[k];
    if (thetaLink > cap) { thetaLink = cap; L = 0; }
    const phi = thetaLink - this.theta[k];
    if (phi <= 0 || u < 0.85) this.reboundLatch[k] = 0;
    if (phi > 0) {
      // A bar coming back off the platen onto a held key lands on the leather buffer of the link hook, not on the
      // wire: it is stopped in the buffer's lost motion, so it cannot lift the key and be thrown again by the finger.
      if (!this.reboundLatch[k] && u >= 0.9 && this.omega[k] < -3 && phi < 0.02) this.reboundLatch[k] = 1;
      let tau;
      if (this.reboundLatch[k]) {
        const rate = L * v - this.omega[k];
        tau = this.Cbuffer * rate;
        if (phi > this.linkLostMotion) tau += this.Klink * (phi - this.linkLostMotion) + this.Clink * rate;
      } else {
        tau = this.Klink * phi + this.Clink * (L * v - this.omega[k]);
      }
      if (tau < 0) tau = 0;
      this.tau[k] += tau;
      if (!this.awake[k]) this.wake(k);
      return -tau * L;
    }
    return 0;
  }

  grabForce(i, f) { this.tau[i] += f; if (!this.awake[i]) this.wake(i); }

  step(h) {
    const sim = this.sim, ports = sim.ports;
    const list = this.activeList;
    let nA = this.nActive;
    if (nA === 0) return;
    const theta = this.theta, omega = this.omega, lat = this.lat, latV = this.latV, tau = this.tau, latF = this.latF;
    const J = this.J, T0 = this.T0, Tr = this.Tr, Tc = this.Tc, Cv = this.Cv;
    const kPad = this.kPad, cPad = this.cPad;
    const kG = this.kGuide, clear = this.guideClear, taper = this.guideTaper, muG = this.guideMu;
    const Lb = this.Lbar;
    const faces = sim.faces, kf = faces.kf, dd = faces.dd, TN = FACE_TABLE_N;
    const alpha = this.alpha;
    const latMass = this.latMass, kLat = this.kLat, cLat = this.cLat, offLat = this.offLat;

    // Bar-bar contacts (segment-segment distance between shanks), before integrating.
    this.pairEnergy = 0;
    if (nA >= 2 && !sim.unlimited) this.barBarContacts(h);

    for (let ii = 0; ii < nA; ii++) {
      const i = list[ii];
      const th = theta[i], w = omega[i];
      let T = tau[i];
      // return spring and bearing
      T -= T0 + Tr * Math.max(th, 0);
      T -= Cv * w;
      {
        // Dahl bristle: true stiction, torque bounded by the bearing Coulomb level.
        const dl = lat[i] - offLat[i];
        const Tlim = Tc + this.pivotBind * kLat * (dl < 0 ? -dl : dl);
        const kb = Tc / BEARING_Z, zmax = Tlim / kb;
        let z = this.bearingZ[i] + w * h;
        if (z > zmax) z = zmax; else if (z < -zmax) z = -zmax;
        this.bearingZ[i] = z;
        T -= kb * z;
      }
      // gravity
      {
        const u = th / (this.thetaTravel[i] * 1.2);
        const idx = u <= 0 ? 0 : u >= 1 ? 63.999999 : u * 64;
        const j = idx | 0, f = idx - j, base = i * 65 + j;
        T += this.gravTab[base] + (this.gravTab[base + 1] - this.gravTab[base]) * f;
      }
      // The bar's heel carries the ribbon vibrator: as long as the bar is up, the ribbon is up, including
      // in free flight after a short press has already let the key go.
      {
        const lift = sim.vibrLiftTarget();
        if (lift > 0 && th > 0.15 * this.thetaTravel[i]) {
          const rate = lift / (0.55 * this.thetaTravel[i]);
          let cam = (th - 0.15 * this.thetaTravel[i]) * rate;
          if (cam > lift) cam = lift;
          const pen = cam - sim.vibr;
          if (pen > 0) {
            const Fh = sim.kVibr * pen;
            sim.vibrF += Fh;
            sim.vibrAwake = true; sim.vibrSleep = 0;
            T -= cam < lift ? Fh * rate : 0;
          }
        }
      }
      // rest pad
      if (th >= 0) this.padOn[i] = 0;
      else if (!this.padOn[i]) { this.padOn[i] = 1; sim.ac(AC.PAD, i, -w); }
      if (th < 0) {
        const pen = -th;
        let Fp = kPad * pen - cPad * w;
        if (Fp < 0) Fp = 0;
        T += Fp;
        ports[PORT.PAD] += Fp / Lb;
      }
      // slug against platen
      const thC = this.thetaContact[i];
      const delta = (th - thC) * Lb;
      if (delta > 0) {
        if (!this.inContact[i]) this.beginContact(i, w * Lb);
        const caseI = this.caseIdx[i];
        const ti = delta / dd;
        const j = ti >= TN - 1 ? TN - 2 : ti | 0;
        const frac = ti - j;
        const base = (i * 2 + caseI) * TN + j;
        const Fe0 = faces.force[base], Fe1 = faces.force[base + 1];
        let Fe = Fe0 + (Fe1 - Fe0) * frac;
        if (ti > TN - 1) Fe = Fe1 + (Fe1 - Fe0) * (ti - TN + 1);
        const dDelta = w * Lb;
        let F = Fe * (1 + alpha * dDelta);
        if (F < 0) F = 0;
        T -= F * Lb;
        if (!sim.unlimited) ports[PORT.SLUG] += F;
        // record
        if (F > this.peakF[i]) this.peakF[i] = F;
        if (delta > this.maxD[i]) this.maxD[i] = delta;
        sim.lastForce = F;
        const c = this.traceC[i]++;
        if (c % TRACE_DECIM === 0 && this.traceN[i] < TRACE_LEN) {
          const tn = this.traceN[i]++;
          this.traceF[i * TRACE_LEN + tn] = F;
          this.traceD[i * TRACE_LEN + tn] = delta;
        }
      } else if (this.inContact[i]) {
        this.endContact(i, w * Lb);
      }
      // lateral flexure and type guide
      let Fl = latF[i] - kLat * (lat[i] - offLat[i]) - cLat * latV[i];
      const throatT = this.thetaTravel[i] - this.guideThroatOffset;
      // Guide jaw half-width closes down to the clearance at the throat, wide open before it.
      const halfW = clear + (th < throatT ? taper * (throatT - th) : 0);
      const ab = lat[i] >= 0 ? lat[i] : -lat[i];
      if (ab > halfW) {
        const pen = ab - halfW;
        const Fg = kG * pen;
        Fl -= (lat[i] > 0 ? 1 : -1) * Fg;
        // conservative: U = 0.5 k (|lat| - halfW(theta))^2, dhalfW/dtheta = -taper (mouth) or 0 (throat).
        if (th < throatT) T -= Fg * taper;
        // Jaw friction: a stiff bristle against the fixed jaws holds the slug while it is pressed into
        // them (this is what keeps a wedged pair up), Coulomb limited, so it never adds energy.
        const zmax = (muG * Fg) / GUIDE_KT;
        let gz = this.guideZ[i] + w * Lb * h;
        if (gz > zmax) gz = zmax; else if (gz < -zmax) gz = -zmax;
        this.guideZ[i] = gz;
        T -= GUIDE_KT * gz * Lb;
        ports[PORT.GUIDE] += Fg;
      } else { this.guideZ[i] = 0; }
      // integrate (symplectic Euler)
      let wNew = w + (T / J[i]) * h;
      if (wNew > OMEGA_MAX) wNew = OMEGA_MAX; else if (wNew < -OMEGA_MAX) wNew = -OMEGA_MAX;
      omega[i] = wNew;
      theta[i] = th + wNew * h;
      let vNew = latV[i] + (Fl / latMass) * h;
      if (vNew > LATV_MAX) vNew = LATV_MAX; else if (vNew < -LATV_MAX) vNew = -LATV_MAX;
      latV[i] = vNew;
      lat[i] += vNew * h;
      if (lat[i] > LAT_MAX) { lat[i] = LAT_MAX; if (latV[i] > 0) latV[i] = 0; } else if (lat[i] < -LAT_MAX) { lat[i] = -LAT_MAX; if (latV[i] < 0) latV[i] = 0; }
      tau[i] = 0; latF[i] = 0;
      // sleep once settled on the rest pad, never while displaced (jam stiction needs evaluation)
      if (th < 0.02 && (wNew < 2e-3 && wNew > -2e-3) && (vNew < 2e-3 && vNew > -2e-3)) {
        if (++this.sleepCount[i] > 256) {
          this.awake[i] = 0;
          omega[i] = 0; latV[i] = 0;
          list[ii] = list[--nA];
          ii--;
        }
      } else this.sleepCount[i] = 0;
    }
    this.nActive = nA;
  }

  beginContact(i, vIn) {
    this.inContact[i] = 1;
    const sim = this.sim;
    this.tBegin[i] = sim.t;
    this.vIn[i] = vIn;
    this.peakF[i] = 0;
    this.maxD[i] = 0;
    this.traceN[i] = 0;
    this.traceC[i] = 0;
    this.caseIdx[i] = sim.shiftY > this.m.slug.caseOffset / 2 ? 1 : 0;
  }

  /** Unlimited typing: one slug impact integrated on the spot, reported exactly as a real one. */
  instantStrike(i, force) {
    const sim = this.sim, faces = sim.faces, dd = faces.dd, TN = FACE_TABLE_N, Lb = this.Lbar;
    const speed = force <= V_OF_F[0][0] ? V_OF_F[0][1] : force >= V_OF_F[V_OF_F.length - 1][0] ? V_OF_F[V_OF_F.length - 1][1] : lerpTable(V_OF_F, force);
    const caseI = sim.shiftY > this.m.slug.caseOffset / 2 ? 1 : 0;
    const mEff = this.J[i] / (Lb * Lb), h = sim.h, table = (i * 2 + caseI) * TN;
    let v = speed, d = 0, peak = 0, maxD = 0, c = 0, nT = 0;
    const slot = this.nPhantom < PHANTOM_MAX ? this.nPhantom++ : PHANTOM_MAX - 1;
    const pulse = this.phantomF.subarray(slot * TRACE_LEN, (slot + 1) * TRACE_LEN);
    const indent = new Float32Array(TRACE_LEN);
    for (c = 0; c < 20000; c++) {
      d += v * h;
      if (d <= 0) break;
      const ti = d / dd, j = ti >= TN - 1 ? TN - 2 : ti | 0, frac = ti - j;
      const f0 = faces.force[table + j], f1 = faces.force[table + j + 1];
      let Fe = f0 + (f1 - f0) * frac;
      if (ti > TN - 1) Fe = f1 + (f1 - f0) * (ti - TN + 1);
      let F = Fe * (1 + this.alpha * v);
      if (F < 0) F = 0;
      v -= (F / mEff) * h;
      if (F > peak) peak = F;
      if (d > maxD) maxD = d;
      if (c % TRACE_DECIM === 0 && nT < TRACE_LEN) { pulse[nT] = F; indent[nT] = d; nT++; }
    }
    this.phantomLen[slot] = nT; this.phantomPos[slot] = 0;
    sim.ac(AC.STRIKE, i, peak);
    const k0 = Math.min(FACE_TABLE_N - 1, (maxD / dd) | 0);
    const area = faces.area[table + k0];
    const lift = sim.vibrLiftTarget();
    sim.emitEvent({
      type: 'strike', bar: i, caseIndex: caseI, unlimited: true,
      tBegin: sim.t, duration: c * h,
      carriageX: sim.carriageX(), platenPsi: sim.psi, shiftY: sim.shiftY,
      lateral: 0, vImpact: speed, peakForce: peak,
      maxIndent: maxD, restitution: speed !== 0 ? Math.abs(v / speed) : 0,
      skewRad: this.geo.bars[i].skew, vibratorLift: lift, ribbonInGap: sim.env.ribbonInGap && lift > 0 ? 1 : 0,
      ...(sim.glyphOverride?.[i] && sim.t - sim.glyphOverride[i].t < 0.4 ? { char: sim.glyphOverride[i].c } : null),
      peakPressure: faces.kf * maxD, meanPressure: area > 0 ? peak / area : 0, contactArea: area,
      trace: { dt: h * TRACE_DECIM, force: pulse.slice(0, nT), indent: indent.slice(0, nT) },
    });
  }

  /** Feed the instant strikes' force histories to the acoustic port, as a real slug would have. */
  playPhantoms(ports) {
    for (let p = this.nPhantom - 1; p >= 0; p--) {
      const pos = this.phantomPos[p]++;
      const idx = pos / TRACE_DECIM | 0;
      if (idx >= this.phantomLen[p]) {
        const last = --this.nPhantom;
        if (p !== last) {
          this.phantomF.copyWithin(p * TRACE_LEN, last * TRACE_LEN, (last + 1) * TRACE_LEN);
          this.phantomLen[p] = this.phantomLen[last]; this.phantomPos[p] = this.phantomPos[last];
        }
        continue;
      }
      ports[PORT.SLUG] += this.phantomF[p * TRACE_LEN + idx];
    }
  }

  /** Drop every bar-to-bar contact, so bars that were wedged come free. */
  clearBarContacts() {
    this.poolUsed.fill(0); this.contactSlot.fill(0); this.poolZ.fill(0); this.pairEnergy = 0;
    for (let i = 0; i < this.n; i++) if (this.theta[i] > 0.01 && !this.awake[i]) this.wake(i);
  }

  endContact(i, vOut) {
    this.inContact[i] = 0;
    const sim = this.sim;
    if (this.peakF[i] < 1e-3 || sim.unlimited) return;   // unlimited typing has already printed this keystroke
    sim.ac(AC.STRIKE, i, this.peakF[i]);
    const nT = this.traceN[i];
    const force = new Float32Array(nT);
    const indent = new Float32Array(nT);
    for (let k = 0; k < nT; k++) {
      force[k] = this.traceF[i * TRACE_LEN + k];
      indent[k] = this.traceD[i * TRACE_LEN + k];
    }
    const kf = sim.faces.kf;
    const faces = sim.faces;
    const maxD = this.maxD[i];
    const table = (i * 2 + this.caseIdx[i]) * FACE_TABLE_N;
    const j = Math.min(FACE_TABLE_N - 1, (maxD / faces.dd) | 0);
    const areaAtMax = faces.area[table + j];
    sim.emitEvent({
      type: 'strike', bar: i, caseIndex: this.caseIdx[i],
      tBegin: this.tBegin[i], duration: sim.t - this.tBegin[i],
      carriageX: sim.carriageX(), platenPsi: sim.psi, shiftY: sim.shiftY,
      lateral: this.lat[i], vImpact: this.vIn[i], peakForce: this.peakF[i],
      maxIndent: maxD, restitution: this.vIn[i] !== 0 ? Math.abs(vOut / this.vIn[i]) : 0,
      skewRad: this.geo.bars[i].skew, vibratorLift: sim.vibr, ribbonInGap: sim.ribbonInGapNow() ? 1 : 0,
      ...(sim.glyphOverride?.[i] && sim.t - sim.glyphOverride[i].t < 0.4 ? { char: sim.glyphOverride[i].c } : null),
      peakPressure: kf * maxD, meanPressure: areaAtMax > 0 ? this.peakF[i] / areaAtMax : 0, contactArea: areaAtMax,
      trace: { dt: sim.h * TRACE_DECIM, force, indent },
    });
  }

  barBarContacts(h) {
    const nA = this.nActive, list = this.activeList;
    const { theta, lat, pivot, sDir, pDir, axis, thetaTravel, segs, inRange } = this;
    const L = this.Lbar, Ls = L - this.slugDepth, rc = L - this.slugDepth / 2, hs = this.slugHalf;
    const f0 = (Ls / L) * (Ls / L);
    this.pairEnergy = 0;
    for (let ai = 0; ai < nA; ai++) {
      const a = list[ai];
      const thA = theta[a];
      if (thA < thetaTravel[a] - this.pairRangeTheta) { inRange[ai] = 0; continue; }
      inRange[ai] = 1;
      const a2 = thetaTravel[a] - thA;
      const ca = Math.cos(a2), sa = Math.sin(a2);
      const ia = a * 3;
      const dx = sDir[ia] * ca + pDir[ia] * sa, dy = sDir[ia + 1] * ca + pDir[ia + 1] * sa, dz = sDir[ia + 2] * ca + pDir[ia + 2] * sa;
      const vx = sDir[ia] * sa - pDir[ia] * ca, vy = sDir[ia + 1] * sa - pDir[ia + 1] * ca, vz = sDir[ia + 2] * sa - pDir[ia + 2] * ca;
      const lt = lat[a], ax = axis[ia] * lt, ay = axis[ia + 1] * lt, az = axis[ia + 2] * lt;
      const i0 = ai * 18;
      segs[i0] = pivot[ia]; segs[i0 + 1] = pivot[ia + 1]; segs[i0 + 2] = pivot[ia + 2];
      segs[i0 + 3] = pivot[ia] + dx * Ls + ax * f0; segs[i0 + 4] = pivot[ia + 1] + dy * Ls + ay * f0; segs[i0 + 5] = pivot[ia + 2] + dz * Ls + az * f0;
      const cx = pivot[ia] + dx * rc + ax, cy = pivot[ia + 1] + dy * rc + ay, cz = pivot[ia + 2] + dz * rc + az;
      segs[i0 + 6] = cx - vx * hs; segs[i0 + 7] = cy - vy * hs; segs[i0 + 8] = cz - vz * hs;
      segs[i0 + 9] = cx + vx * hs; segs[i0 + 10] = cy + vy * hs; segs[i0 + 11] = cz + vz * hs;
      segs[i0 + 12] = vx; segs[i0 + 13] = vy; segs[i0 + 14] = vz;
      segs[i0 + 15] = dx; segs[i0 + 16] = dy; segs[i0 + 17] = dz;
      // Bounding boxes of the two capsules, for the broad phase of segPair.
      const bb = this.segBox, b0 = ai * 12, rs = this.rBar, rS = this.rSlug * this.slugNose;
      for (let c = 0; c < 3; c++) {
        const s0 = segs[i0 + c], s1 = segs[i0 + 3 + c], g0 = segs[i0 + 6 + c], g1 = segs[i0 + 9 + c];
        bb[b0 + c * 2] = (s0 < s1 ? s0 : s1) - rs; bb[b0 + c * 2 + 1] = (s0 > s1 ? s0 : s1) + rs;
        bb[b0 + 6 + c * 2] = (g0 < g1 ? g0 : g1) - rS; bb[b0 + 6 + c * 2 + 1] = (g0 > g1 ? g0 : g1) + rS;
      }
    }
    for (let ai = 0; ai < nA; ai++) {
      if (!inRange[ai]) continue;
      for (let bi = ai + 1; bi < nA; bi++) {
        if (!inRange[bi]) continue;
        const a = list[ai], b = list[bi];
        this.segPair(ai, bi, a, b, 1, 1, h);
        this.segPair(ai, bi, a, b, 1, 0, h);
        this.segPair(ai, bi, a, b, 0, 1, h);
        this.segPair(ai, bi, a, b, 0, 0, h);
      }
    }
  }

  /** Contact between one segment of bar a and one of bar b (type 0 shank, 1 slug): true closest points. */
  segPair(ai, bi, a, b, ta, tb, h) {
    const { segs, omega, latV, tau, latF, axis, n, segBox } = this;
    const ca = ai * 12 + (ta ? 6 : 0), cb = bi * 12 + (tb ? 6 : 0);
    if (segBox[ca] > segBox[cb + 1] || segBox[cb] > segBox[ca + 1]
      || segBox[ca + 2] > segBox[cb + 3] || segBox[cb + 2] > segBox[ca + 3]
      || segBox[ca + 4] > segBox[cb + 5] || segBox[cb + 4] > segBox[ca + 5]) {
      const lo = a < b ? a : b, hi = a < b ? b : a;
      this.freeContact((lo * n + hi) * 4 + (a < b ? ta * 2 + tb : tb * 2 + ta));
      return;
    }
    const ia = ai * 18 + (ta ? 6 : 0), ib = bi * 18 + (tb ? 6 : 0);
    const p0x = segs[ia], p0y = segs[ia + 1], p0z = segs[ia + 2];
    const q0x = segs[ib], q0y = segs[ib + 1], q0z = segs[ib + 2];
    const d1x = segs[ia + 3] - p0x, d1y = segs[ia + 4] - p0y, d1z = segs[ia + 5] - p0z;
    const d2x = segs[ib + 3] - q0x, d2y = segs[ib + 4] - q0y, d2z = segs[ib + 5] - q0z;
    const rx = p0x - q0x, ry = p0y - q0y, rz = p0z - q0z;
    const aa = d1x * d1x + d1y * d1y + d1z * d1z;
    const e = d2x * d2x + d2y * d2y + d2z * d2z;
    const f = d2x * rx + d2y * ry + d2z * rz;
    const c = d1x * rx + d1y * ry + d1z * rz;
    const bq = d1x * d2x + d1y * d2y + d1z * d2z;
    const denom = aa * e - bq * bq;
    let s = denom > 1e-14 ? clamp01((bq * f - c * e) / denom) : 0;
    let t = (bq * s + f) / e;
    if (t < 0) { t = 0; s = clamp01(-c / aa); } else if (t > 1) { t = 1; s = clamp01((bq - c) / aa); }
    let nx = rx + d1x * s - d2x * t, ny = ry + d1y * s - d2y * t, nz = rz + d1z * s - d2z * t;
    // Lens-shaped section: the gap is measured in a metric that stretches the sideways coordinate, so the
    // contact force is the true gradient of a potential (conservative) and leans sideways off a bevelled nose.
    const rLat = (ta ? this.rSlug : this.rBar) + (tb ? this.rSlug : this.rBar);
    const rr = (ta ? this.rSlug * this.slugNose : this.rBar) + (tb ? this.rSlug * this.slugNose : this.rBar);
    const beta = rr / rLat;
    const latC = nx * axis[a * 3] + ny * axis[a * 3 + 1] + nz * axis[a * 3 + 2];
    const stretch = (beta * beta - 1) * latC;
    const dist2 = nx * nx + ny * ny + nz * nz + (beta * beta - 1) * latC * latC;
    const lo = a < b ? a : b, hi = a < b ? b : a;
    const subIdx = a < b ? ta * 2 + tb : tb * 2 + ta;
    const key = (lo * n + hi) * 4 + subIdx;
    if (dist2 >= rr * rr) { this.freeContact(key); return; }
    const dist = Math.sqrt(dist2);
    let grad = 1; // |gradient of the gap|: between 1 and beta
    if (dist > 1e-7) {
      nx = (nx + stretch * axis[a * 3]) / dist;
      ny = (ny + stretch * axis[a * 3 + 1]) / dist;
      nz = (nz + stretch * axis[a * 3 + 2]) / dist;
      grad = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= grad; ny /= grad; nz /= grad;
    } else { // coincident axes: separate them sideways, in basket order
      const sgn = this.geo.bars[a].slot < this.geo.bars[b].slot ? -1 : 1;
      nx = axis[a * 3] * sgn; ny = axis[a * 3 + 1] * sgn; nz = axis[a * 3 + 2] * sgn;
    }
    const pen = rr - dist;
    const L = this.Lbar, Ls = L - this.slugDepth, rc = L - this.slugDepth / 2, hs = this.slugHalf;
    const ga = ai * 18, gb = bi * 18;
    // Jacobians of the contact points: d(point)/d(theta) and d(point)/d(lateral)
    let jax, jay, jaz, fa;
    if (ta) {
      const sg = (2 * s - 1) * hs;
      jax = segs[ga + 12] * rc - segs[ga + 15] * sg; jay = segs[ga + 13] * rc - segs[ga + 16] * sg; jaz = segs[ga + 14] * rc - segs[ga + 17] * sg;
      fa = 1;
    } else {
      const r = s * Ls;
      jax = segs[ga + 12] * r; jay = segs[ga + 13] * r; jaz = segs[ga + 14] * r;
      fa = (r / L) * (r / L);
    }
    let jbx, jby, jbz, fb;
    if (tb) {
      const sg = (2 * t - 1) * hs;
      jbx = segs[gb + 12] * rc - segs[gb + 15] * sg; jby = segs[gb + 13] * rc - segs[gb + 16] * sg; jbz = segs[gb + 14] * rc - segs[gb + 17] * sg;
      fb = 1;
    } else {
      const r = t * Ls;
      jbx = segs[gb + 12] * r; jby = segs[gb + 13] * r; jbz = segs[gb + 14] * r;
      fb = (r / L) * (r / L);
    }
    const ia3 = a * 3, ib3 = b * 3, wa = omega[a], wb = omega[b];
    const axx = axis[ia3], axy = axis[ia3 + 1], axz = axis[ia3 + 2];
    const bxx = axis[ib3], bxy = axis[ib3 + 1], bxz = axis[ib3 + 2];
    const lva = latV[a] * fa, lvb = latV[b] * fb;
    const vrx = jax * wa + axx * lva - jbx * wb - bxx * lvb;
    const vry = jay * wa + axy * lva - jby * wb - bxy * lvb;
    const vrz = jaz * wa + axz * lva - jbz * wb - bxz * lvb;
    const vn = vrx * nx + vry * ny + vrz * nz;
    let Fn = grad * (this.kBarBar * pen - this.cBarBar * grad * vn);
    if (Fn < 0) Fn = 0;
    this.pairEnergy += 0.5 * this.kBarBar * pen * pen;
    tau[a] += Fn * (jax * nx + jay * ny + jaz * nz);
    latF[a] += Fn * fa * (axx * nx + axy * ny + axz * nz);
    tau[b] -= Fn * (jbx * nx + jby * ny + jbz * nz);
    latF[b] -= Fn * fb * (bxx * nx + bxy * ny + bxz * nz);
    this.sim.ports[PORT.BARBAR] += Fn;
    // Coulomb friction by a 3D bristle in the contact tangent plane: true stiction, so slugs and shoulders
    // can lock against each other instead of creeping apart.
    const slot = this.allocContact(key);
    if (slot < 0) return;
    const pz = this.poolZ, p3 = slot * 3;
    let zx = pz[p3] + (vrx - vn * nx) * h, zy = pz[p3 + 1] + (vry - vn * ny) * h, zz = pz[p3 + 2] + (vrz - vn * nz) * h;
    const zn = zx * nx + zy * ny + zz * nz;
    zx -= zn * nx; zy -= zn * ny; zz -= zn * nz;
    const zmax = (this.barFriction * Fn) / this.kBarBristle;
    const zl = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (zl > zmax) { const sc = zl > 0 ? zmax / zl : 0; zx *= sc; zy *= sc; zz *= sc; }
    pz[p3] = zx; pz[p3 + 1] = zy; pz[p3 + 2] = zz;
    const kT = this.kBarBristle;
    this.pairEnergy += 0.5 * kT * (zx * zx + zy * zy + zz * zz);
    const fx = -kT * zx, fy = -kT * zy, fz = -kT * zz;
    tau[a] += fx * jax + fy * jay + fz * jaz;
    latF[a] += fa * (fx * axx + fy * axy + fz * axz);
    tau[b] -= fx * jbx + fy * jby + fz * jbz;
    latF[b] -= fb * (fx * bxx + fy * bxy + fz * bxz);
  }

  allocContact(key) {
    const cur = this.contactSlot[key];
    if (cur) return cur - 1;
    for (let s = 0; s < this.poolMax; s++) {
      if (!this.poolUsed[s]) {
        this.poolUsed[s] = 1;
        this.poolZ[s * 3] = 0; this.poolZ[s * 3 + 1] = 0; this.poolZ[s * 3 + 2] = 0;
        this.contactSlot[key] = s + 1;
        return s;
      }
    }
    return -1;
  }

  freeContact(key) {
    const cur = this.contactSlot[key];
    if (cur) { this.poolUsed[cur - 1] = 0; this.contactSlot[key] = 0; }
  }

  guard() {
    let tripped = false;
    const ok = (x) => x - x === 0;
    for (let i = 0; i < this.n; i++) {
      if (!ok(this.theta[i]) || !ok(this.omega[i]) || !ok(this.lat[i]) || !ok(this.latV[i]) || !ok(this.tau[i]) || !ok(this.latF[i]) || !ok(this.bearingZ[i]) || !ok(this.guideZ[i])) {
        this.theta[i] = 0; this.omega[i] = 0; this.lat[i] = this.offLat[i]; this.latV[i] = 0; this.tau[i] = 0; this.latF[i] = 0; this.bearingZ[i] = 0; this.guideZ[i] = 0;
        tripped = true;
      }
    }
    for (let i = 0; i < this.poolZ.length; i++) if (!ok(this.poolZ[i])) { this.poolZ[i] = 0; tripped = true; }
    return tripped;
  }

  /** Strain energy of bar i's heel pressing the ribbon vibrator up. */
  heelEnergy(i) {
    const sim = this.sim, lift = sim.vibrLiftTarget();
    const start = 0.15 * this.thetaTravel[i];
    if (!(lift > 0) || !(this.theta[i] > start)) return 0;
    const rate = lift / (0.55 * this.thetaTravel[i]);
    const cam = Math.min((this.theta[i] - start) * rate, lift);
    const pen = cam - sim.vibr;
    return pen > 0 ? 0.5 * sim.kVibr * pen * pen : 0;
  }

  /** Potential + kinetic energy of the action DOFs (bar rotation, flexure, contacts). */
  energy() {
    const { n, theta, omega, lat, latV, J, T0, Tr, kPad, kLat, latMass, offLat } = this;
    let E = this.pairEnergy;
    for (let i = 0; i < n; i++) {
      const th = theta[i];
      E += 0.5 * J[i] * omega[i] * omega[i];
      E += T0 * Math.max(th, 0) + 0.5 * Tr * Math.max(th, 0) ** 2;
      if (th < 0) E += 0.5 * kPad * th * th;
      E += 0.5 * latMass * latV[i] * latV[i] + 0.5 * kLat * (lat[i] - offLat[i]) ** 2;
      E += this.heelEnergy(i);
      // gravity
      const u = th / (this.thetaTravel[i] * 1.2);
      const idx = u <= 0 ? 0 : u >= 1 ? 63.999999 : u * 64;
      const j = idx | 0, f = idx - j, base = i * 65 + j;
      E -= this.gravPot[base] + (this.gravPot[base + 1] - this.gravPot[base]) * f;
      // Guide: U = 0.5 k pen^2
      const throatT = this.thetaTravel[i] - this.guideThroatOffset;
      const halfW = this.guideClear + (th < throatT ? this.guideTaper * (throatT - th) : 0);
      const ab = Math.abs(lat[i]);
      if (ab > halfW) E += 0.5 * this.kGuide * (ab - halfW) ** 2;
      // Slug contact
      const delta = (th - this.thetaContact[i]) * this.Lbar;
      if (delta > 0) {
        const faces = this.sim.faces;
        const ti = delta / faces.dd;
        const j2 = ti >= FACE_TABLE_N - 1 ? FACE_TABLE_N - 2 : ti | 0;
        const fr = ti - j2;
        const b2 = (i * 2 + this.caseIdx[i]) * FACE_TABLE_N + j2;
        E += faces.energy[b2] + (faces.energy[b2 + 1] - faces.energy[b2]) * fr;
      }
    }
    return E;
  }

  /** Link stored energy for one key, for the conservative-energy tests. */
  linkEnergy(k, x) {
    const T = this.keyTravel;
    let u = x / T;
    if (u <= 0) u = 0;
    if (u > 1) u = 1;
    const idx = u * S_LUT_N, i0 = idx | 0, f = idx - i0;
    const s = this.S[i0] + (this.S[i0 + 1] - this.S[i0]) * f;
    const thetaC = this.thetaCoupled * this.thetaTravel[k];
    let phi = Math.min(this.lever[k] * thetaC * s, this.linkMaxFrac * this.thetaTravel[k]) - this.theta[k];
    if (this.reboundLatch[k]) phi -= this.linkLostMotion;
    return phi > 0 ? 0.5 * this.Klink * phi * phi : 0;
  }

  snapshot(state, L) {
    for (let i = 0; i < this.n; i++) {
      state[L.barTheta + i] = this.theta[i];
      state[L.barOmega + i] = this.omega[i];
      state[L.barLateral + i] = this.lat[i];
    }
  }

  exportState() {
    return {
      theta: this.theta.slice(), omega: this.omega.slice(), lat: this.lat.slice(), latV: this.latV.slice(),
      inContact: this.inContact.slice(), caseIdx: this.caseIdx.slice(),
    };
  }

  importState(s) {
    this.theta.set(s.theta); this.omega.set(s.omega); this.lat.set(s.lat); this.latV.set(s.latV);
    if (s.caseIdx) this.caseIdx.set(s.caseIdx);
    // Contact records (event accounting) restart cleanly; wake anything that isn't asleep at rest.
    this.poolUsed.fill(0); this.contactSlot.fill(0);
    for (let i = 0; i < this.n; i++) {
      if (this.theta[i] > 1e-6 || this.omega[i] !== 0 || Math.abs(this.lat[i] - this.offLat[i]) > 1e-9 || this.latV[i] !== 0) this.wake(i);
    }
  }
}

function clamp01(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x; }

export function createAction(sim) {
  const type = sim.m.action?.type;
  switch (type) {
    case 'typebar-frontstrike':
    case 'typebar-upstrike':
      return new TypebarAction(sim);
    default:
      throw new Error(`Unknown action type '${type}': add it to createAction in src/sim/actions.js`);
  }
}
