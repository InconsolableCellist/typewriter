// Print action of the electric single-element machine: a constantly running motor, one-revolution clutches,
// a whiffletree selection into tilt and rotate DOFs, and a cam-thrown ball. The carrier, margins, line-space
// pawl and platen are the common mechanism in src/sim/mechanics.js, driven through the same forces the manual
// machine applies by hand; the frame stays the moving-carriage one (carriageX = minus the carrier's world x).
import { PORT, AC } from './ports.js';
import { FACE_TABLE_N } from './faces.js';

const TWO_PI = 2 * Math.PI;
const TRACE_LEN = 256;
const TRACE_DECIM = 4;
const LUT = 2048;
const COL_HALF = 5;      // columns -5 .. +5 on each hemisphere
const TAB_REST_S = 0.004;
const TAB_SHORT = 0.2;      // of a pitch
// Key kinds. Print keys and these controls run a cycle and take the interposer slot; the others act alone.
const K_PRINT = 0, K_SPACE = 1, K_BACK = 2, K_CORRECT = 3, K_INDEX = 4, K_RETURN = 5, K_TAB = 6;
const K_SHIFT = 10, K_LOCK = 11, K_SET = 12, K_CLEAR = 13, K_POWER = 14;
const OP_NONE = 0, OP_SPACE = 1, OP_BACK = 2, OP_INDEX = 3, OP_RETURN = 4;

function smooth(u, a, b) { if (u <= a) return 0; if (u >= b) return 1; const s = (u - a) / (b - a); return s * s * (3 - 2 * s); }
function camLut(spec, shape) {
  const [r0, r1, f0, f1] = spec;
  const t = new Float64Array(LUT + 2);
  // `throw` rises with constant acceleration and ends at its peak speed, so the follower leaves the cam at full speed.
  const rise = shape === 'throw' ? (u) => { if (u <= r0) return 0; if (u >= r1) return 1; const s = (u - r0) / (r1 - r0); return s * s; } : (u) => smooth(u, r0, r1);
  for (let i = 0; i <= LUT + 1; i++) { const u = (i % LUT) / LUT; t[i] = rise(u) * (1 - smooth(u, f0, f1)); }
  return t;
}
function detentEnergy(err, K, Tmax) {
  const a = err < 0 ? -err : err, e0 = Tmax / K;
  return a < e0 ? 0.5 * K * a * a : Tmax * a - 0.5 * Tmax * e0;
}

/** One-way cam follower against a shaft, as used by every print-cycle function. */
class ShaftCam {
  constructor(lut) { this.lut = lut; this.v = 0; this.dv = 0; }
  at(u) {
    const x = u * LUT, i = x | 0, f = x - i, t = this.lut;
    this.v = t[i] + (t[i + 1] - t[i]) * f;
    this.dv = (t[i + 1] - t[i]) * LUT / TWO_PI;     // per radian of the shaft
    return this;
  }
}

/** A single-revolution (or half-revolution) spring clutch shaft: stops one turn after it is tripped. */
function makeShaft(p, ratio, period) {
  return {
    J: p.inertia, Cv: p.bearingViscous, Tc: p.bearingCoulomb, k: p.clutchStiffness, cc: p.clutchDamping, Tmax: p.clutchMaxTorque,
    latch: p.latchPhase, kStop: p.stopStiffness, cStop: p.stopDamping, offset: p.stopAngle ?? 0, ratio, period,
    phi: 0, w: 0, tau: 0, on: false, moving: false, wind: 0, checked: false,
  };
}

export class ElementAction {
  constructor(sim) {
    this.sim = sim; this.m = sim.m; this.geo = sim.g;
    this.keyF = 0;   // keyForce's result
    this.selV = 0; this.selDV = 0; this.selW = 0; this.detV = 0; this.detDV = 0;   // the selection cams, for stepDof
    this.rockerF = 0;   // a number from the start: a field first left undefined holds boxed numbers, a new one per store
    const n = sim.g.nPrint;
    this.n = n;
    this.cells = sim.g.element.cells;
    this.nActive = 0; this.activeList = new Int32Array(1); this.inContact = new Uint8Array(n); this.nPhantom = 0;   // the interface the engine reads
    this.setupConstants();
    this.resetState();
  }

  setupConstants() {
    const { m, geo: g, sim } = this, E = m.element;
    this.E = E;
    const M = E.motor;
    this.motorP = M; this.wSync = M.syncOmega; this.Tb = M.breakdownTorque; this.sb = M.breakdownSlip; this.Jm = M.inertia;
    this.wRated = M.ratedOmega; this.fanB = M.fanTorqueAtRated / (M.ratedOmega * M.ratedOmega); this.Tf = M.frictionTorque;
    this.wTrip = 0.7 * M.ratedOmega;
    const shafts0 = this.cyc ? [this.cyc, this.op, this.shiftS] : null;
    this.cyc = makeShaft(E.cycleShaft, E.drive.shaftRatio, TWO_PI);
    this.op = makeShaft(E.opShaft, E.opShaft.motorRatio, TWO_PI);
    this.shiftS = makeShaft(E.shiftShaft, E.shiftShaft.motorRatio, Math.PI);
    if (shafts0) {
      for (const [a, b] of [[this.cyc, shafts0[0]], [this.op, shafts0[1]], [this.shiftS, shafts0[2]]]) {
        a.phi = b.phi; a.w = b.w; a.on = b.on; a.moving = b.moving; a.wind = b.wind; a.checked = b.checked;
      }
    }
    this.camSel = new ShaftCam(camLut(E.cams.select)); this.camDet = new ShaftCam(camLut(E.cams.detent));
    const I = E.impression, pc = E.cams.print, riseT = I.riseMax + (I.riseMin - I.riseMax) * Math.min(1, Math.max(0, I.setting));
    this.camRib = new ShaftCam(camLut(E.cams.ribbon)); this.camPrt = new ShaftCam(camLut([pc[1] - riseT, pc[1], pc[2], pc[3]], 'throw'));
    this.camCor = new ShaftCam(camLut(E.cams.correct)); this.camCorFeed = new ShaftCam(camLut(E.cams.correctFeed));
    this.camEsc = new ShaftCam(camLut(E.cams.escape));
    this.opSpace = new ShaftCam(camLut(E.opCams.space)); this.opBack = new ShaftCam(camLut(E.opCams.backspace));
    this.opIdx = new ShaftCam(camLut(E.opCams.index));
    this.restorePhase = E.cams.restore;
    this.tP = E.tilt; this.rP = E.rotate; this.hP = E.hemisphere;
    const R = E.rocker;
    this.rMass = R.mass; this.rF0 = R.returnSpring; this.rRate = R.returnRate; this.rC = R.damping;
    this.rCamK = R.camStiffness; this.rCamC = R.camDamping; this.rStopK = R.restStopK; this.rStopC = R.restStopC;
    this.gap = E.strikeGap;
    this.stroke = this.gap * I.strokeFraction;
    const C = E.correction;
    this.corFull = C.lift; this.corMass = C.mass; this.corF0 = C.spring0; this.corRate = C.springRate; this.corK = C.kCam; this.corInc = C.feedPerCorrection;
    this.alpha = m.platen.huntCrossleyAlpha;
    const ip = E.interposer;
    this.uLatch = ip.latchFraction; this.uRearm = ip.rearmFraction; this.uBlock = ip.blockFraction; this.uRepeat = ip.repeatFraction;
    this.humpA = ip.humpForce; this.kBlock = ip.blockStiffness; this.cBlock = ip.blockDamping;
    const Rt = E.return;
    this.retV = Rt.targetSpeed; this.retF = Rt.maxForce; this.retG = Rt.gain; this.retZone = Rt.cushionZone; this.retMin = Rt.cushionMinSpeed;
    this.retLatchPhase = Rt.latchPhase; this.retTol = Rt.arrivalTolerance; this.retArrV = Rt.arrivalSpeed;
    this.tabP = E.tab;
    this.ballR = E.ball.radius;
    this.kEsc = 4e4; this.kRib = 2e4; this.kLs = 40; this.kBackPawl = 2.5e5;
    this.setEnv();
  }

  resetState() {
    const { n, sim, E } = this;
    this.motorOn = !!E.motor.startOn;
    this.motorW = this.motorOn ? this.wRated : 0;
    this.motorT = 0;
    this.tilt = 0; this.tiltV = 0; this.tiltSum = 0; this.tiltNotch = 0; this.tiltSeated = false;
    this.rot = 0; this.rotV = 0; this.rotSum = 0; this.rotNotch = 0; this.rotSeated = false;
    this.hemi = 0; this.hemiV = 0;
    this.shiftIndex = 0;        // 0 lower hemisphere at rest, 1 upper
    this.bitsT = 0; this.bitsR = 0;
    this.selKey = -1; this.ipKey = -1;      // key whose code is in the latches; key in the interposer slot
    this.restored = false; this.opRestored = false;
    this.opFunc = OP_NONE;
    this.returnLatched = false; this.tabLatched = false; this.tabStopping = false; this.tabTargetQ = 0; this.tabK = -1; this.tabHeld = false; this.tabRest = 0; this.relief = 0;
    this.correctionArmed = false; this.correcting = false; this.cor = 0; this.corV = 0; this.corF = 0; this.tapeFed = 0; this.feedBase = 0;
    this.rocker = 0; this.rockerV = 0;
    this.contact = false; this.bar = 0; this.caseI = 0; this.tBegin = 0; this.vIn = 0; this.peakF = 0; this.maxD = 0;
    this.traceF = new Float32Array(TRACE_LEN); this.traceD = new Float32Array(TRACE_LEN); this.traceN = 0; this.traceC = 0;
    this.armed = new Uint8Array(sim.nKeys).fill(1);
    this.keyU = new Float64Array(sim.nKeys);
    this.kind = new Uint8Array(sim.nKeys).fill(K_PRINT);
    this.hasKeys = false;
    this.tabStops = new Uint8Array(160);
    for (const c of E.tab.defaultStops) this.tabStops[c] = 1;
    this.cycles = 0;
    this.lastRotErr = 0; this.lastTiltErr = 0;
    this.backQ = 0;
  }

  /** Key index -> kind. Deferred until the sim has its key tables built. */
  bindKeys() {
    if (this.hasKeys) return;
    this.hasKeys = true;
    const g = this.geo;
    for (let k = 0; k < g.nKeys; k++) {
      const key = g.keys[k];
      let c = K_PRINT;
      switch (key.id) {
        case 'space': c = K_SPACE; break;
        case 'backspace': c = K_BACK; break;
        case 'correct': c = K_CORRECT; break;
        case 'index': c = K_INDEX; break;
        case 'return': c = K_RETURN; break;
        case 'tab': c = K_TAB; break;
        case 'shiftL': case 'shiftR': c = K_SHIFT; break;
        case 'shiftLock': c = K_LOCK; break;
        case 'tabSet': c = K_SET; break;
        case 'tabClear': c = K_CLEAR; break;
        case 'onOff': c = K_POWER; break;
        default: c = key.kind === 'print' ? K_PRINT : K_POWER + 1;
      }
      this.kind[k] = c;
    }
  }

  setEnv() { this.xContact = this.gap - this.sim.stackCaliper(); }
  wake() {}
  position() { return 0; }
  velocity() { return 0; }
  grabForce() {}
  clearBarContacts() {}
  playPhantoms() {}

  // ---- keyboard --------------------------------------------------------------------------
  slotFreeFor(k) { return this.ipKey < 0 || this.ipKey === k; }

  /** Reaction on key k from its interposer or control linkage, plus any block by the compensator, left in this.keyF
   * (see TypebarAction.keyForce). */
  keyForce(k) {
    this.bindKeys();
    const sim = this.sim, T = sim.kTravel[k], x = sim.kx[k], v = sim.kv[k];
    const u = x / T;
    this.keyU[k] = u;
    const c = this.kind[k];
    let F = 0;
    if (c <= K_TAB) {
      if (u < this.uRearm) this.armed[k] = 1;
      // Typamatic: space or backspace still held deep when its cycle has finished trips the next one, at the op shaft's own rate.
      if ((c === K_SPACE || c === K_BACK) && !this.armed[k] && u > this.uRepeat && this.ipKey < 0 && !this.op.moving) this.armed[k] = 1;
      if (this.armed[k] && u > this.uLatch && this.slotFreeFor(k) && !sim.unlimited) this.latchKey(k, c);
      // The compensator: while another interposer holds the channel this one cannot fall past the block.
      const blocked = this.armed[k] === 1 && !this.slotFreeFor(k);   // a key already past the latch is not held back
      if (blocked && u > this.uBlock) {
        const pen = x - this.uBlock * T;
        let Fb = this.kBlock * pen + this.cBlock * v;
        if (Fb < 0) Fb = 0;
        F -= Fb;
      }
    } else {
      if (u < this.uRearm) this.armed[k] = 1;
      if (this.armed[k] && u > this.uLatch) { this.armed[k] = 0; this.controlPress(c); }
      if (c === K_SHIFT && u > 0.4) sim.shiftLatch = 0;
    }
    F -= this.hump(u);
    this.keyF = F;
  }

  hump(u) {
    if (u <= 0) return 0;
    const uL = this.uLatch, a = this.humpA;
    if (u >= 1) return 0;
    return u < uL ? (a * u) / uL : (a * (1 - u)) / (1 - uL);
  }

  /** Potential of the key's linkage, for the energy accounting. */
  linkEnergy(k, x) {
    const sim = this.sim, T = sim.kTravel[k], u = x / T, uL = this.uLatch, a = this.humpA * T;
    let E = 0;
    if (u > 0) {
      const v = u < 1 ? u : 1;
      E += v < uL ? (a * v * v) / (2 * uL) : a * (uL / 2 + ((1 - uL) ** 2 - (1 - v) ** 2) / (2 * (1 - uL)));
    }
    this.bindKeys();
    if (this.kind[k] <= K_TAB && this.armed[k] === 1 && !this.slotFreeFor(k) && u > this.uBlock) {
      const pen = x - this.uBlock * T;
      E += 0.5 * this.kBlock * pen * pen;
    }
    return E;
  }

  latchKey(k, c) { this.armed[k] = 0; this.ipKey = k; this.ipKind = c; this.ipOpSet = false; }

  controlPress(c) {
    const sim = this.sim;
    switch (c) {
      case K_POWER:
        this.motorOn = !this.motorOn;
        break;
      case K_LOCK:
        sim.shiftLatch = 1;
        break;
      case K_SET: case K_CLEAR: {
        const col = Math.round(sim.q / sim.p);
        if (col >= 0 && col < this.tabStops.length) this.tabStops[col] = c === K_SET ? 1 : 0;
        break;
      }
      default: break;
    }
  }

  wantHemisphere() {
    const sim = this.sim;
    if (sim.shiftLatch) return 1;
    this.bindKeys();
    for (let k = sim.nPrint; k < sim.nKeys; k++) {
      if (this.kind[k] === K_SHIFT && sim.kx[k] > 0.45 * sim.kTravel[k]) return 1;
    }
    return 0;
  }

  // ---- step ------------------------------------------------------------------------------
  step() {
    const h = this.sim.h;
    const sim = this.sim, ports = sim.ports;
    this.motorT = 0;
    this.tripLogic();
    // Each part reads the step from sim.h itself: a double passed to a call that is not inlined is boxed, a fresh heap
    // number per call and substep (docs/perf-review.md 25).
    this.driveCycle();
    this.driveOp();
    this.driveShift();
    this.driveCorrectionLift();
    this.driveSelection();
    this.driveRocker();
    this.driveReturn();
    this.integrateShaft(this.cyc);
    this.integrateShaft(this.op);
    this.integrateShaft(this.shiftS);
    // Motor: Kloss torque, fan and bearing, belt and clutch reactions.
    const w = this.motorW;
    let T = this.motorT, Tm = 0;
    if (this.motorOn) {
      const s = (this.wSync - w) / this.wSync;
      Tm = (2 * this.Tb * s * this.sb) / (s * s + this.sb * this.sb);
      if (s < 0) Tm *= 0.5;        // braking as an induction generator above synchronous speed
    }
    T += Tm;
    T -= this.fanB * w * w + this.Tf * (w > 1 ? 1 : w < -1 ? -1 : w);
    const wn = w + (T / this.Jm) * h;
    sim.workExt += Tm * w * h;
    this.motorW = wn;
    if (this.relief > 0 || this.returnLatched || this.tabLatched) this.updateRelief(h);
  }

  updateRelief(h) {
    const target = this.returnLatched || (this.tabLatched && !this.tabStopping) ? 1 : 0;
    this.relief += (target - this.relief) * Math.min(1, h * 900);
    if (target === 0 && this.relief < 1e-3) this.relief = 0;
    this.sim.dogRelief = this.relief;
    if (this.relief > 0) { this.sim.escAwake = true; this.sim.escSleep = 0; }
  }

  busy() { return this.cyc.moving || this.op.moving || this.shiftS.moving || this.returnLatched || this.tabLatched; }

  tripLogic() {
    const sim = this.sim;
    // Case: a half-turn shift waits for the print shaft to stop; the print shaft then waits for the shift.
    const want = this.wantHemisphere();
    const pendingShift = want !== this.shiftIndex;
    if (pendingShift && !this.shiftS.moving && !this.cyc.moving && !this.op.moving && this.motorW > this.wTrip) {
      this.shiftS.on = true; this.shiftS.moving = true; this.shiftS.checked = false;
      sim.ac(AC.CLUTCH, 2, 1);
    }
    if (this.ipKey < 0 || this.motorW <= this.wTrip) return;
    if (pendingShift || this.shiftS.moving || this.cyc.moving || this.op.moving || this.returnLatched || this.tabLatched) return;
    const c = this.ipKind;
    if (c === K_PRINT) this.startCycle(); else this.startOp(c);
  }

  /** Whatever is in the interposer slot is transferred to the latches and the clutch trips. */
  startCycle() {
    const S = this.cyc, sim = this.sim;
    S.on = true; S.moving = true; S.checked = false; S.phi = S.offset; S.wind = 0;
    this.restored = false; this.detented = false;
    this.beginSelection();
    sim.ac(AC.CLUTCH, 0, 1);
    this.cycles++;
  }

  /** The interposer's code goes to the latches; an armed correction latch makes this the lift-off stroke. */
  beginSelection() {
    this.correcting = this.correctionArmed;
    this.setSelection(this.ipKey);
  }

  /** The correction tape indexed on this stroke and the latch cleared by the cycle, whether or not it reached the platen. */
  finishCorrection() {
    if (!this.correcting) return;
    this.correcting = false; this.correctionArmed = false;
    this.feedBase += this.corInc; this.tapeFed = this.feedBase;
  }

  setSelection(k) {
    this.selKey = k;
    const seat = this.geo.element.keys[k];
    const t = seat.tilt, r = seat.rotate;
    // Binary latches into the adder (see machine.element.latches); the code wheel of the real keylever.
    const tb = (t & 1 ? 1 : 0) + (t & 2 ? 2 : 0);
    let R5 = 0, rr = r;
    if (rr < 0) { R5 = 1; rr += 5; }
    const R2A = rr >= 4 ? 1 : 0;
    rr -= R2A * 2;
    const R2 = rr >= 2 ? 1 : 0;
    const R1 = rr - R2 * 2;
    this.bitsT = tb; this.bitsR = R1 | (R2 << 1) | (R2A << 2) | (R5 << 3);
    this.tiltSum = tb;
    this.rotSum = R1 + 2 * R2 + 2 * R2A - 5 * R5;
  }

  startOp(c) {
    const S = this.op, sim = this.sim;
    S.on = true; S.moving = true; S.checked = false; S.phi = 0; S.wind = 0;
    this.opRestored = false;
    this.opFunc = c === K_SPACE ? OP_SPACE : c === K_BACK || c === K_CORRECT ? OP_BACK : c === K_INDEX ? OP_INDEX : c === K_RETURN ? OP_RETURN : OP_NONE;
    this.opKeyKind = c;
    if (c === K_CORRECT) this.correctionArmed = true;
    this.backQ = sim.q;
    sim.ac(AC.CLUTCH, c === K_RETURN ? 5 : c === K_BACK ? 6 : c === K_CORRECT ? 7 : c === K_TAB ? 8 : 1, 1);
    if (c === K_TAB) this.startTab();
  }

  /** The carrier position of the next set stop ahead, or Infinity when there is none before the right margin. */
  nextTabQ() {
    const sim = this.sim, cur = sim.q / sim.p;
    for (let i = Math.ceil(cur + 0.4); i < this.tabStops.length; i++) if (this.tabStops[i]) return (i - TAB_SHORT) * sim.p;   // just short of its tooth, so the dogs drop in behind it
    return Infinity;
  }

  startTab() {
    const sim = this.sim;
    this.tabLatched = true; this.tabK = this.ipKey; this.tabHeld = false;
    this.tabTargetQ = this.nextTabQ();
    sim.escAwake = true; sim.escSleep = 0;
  }

  // ---- cycle shaft cams ------------------------------------------------------------------
  shaftU(S) {
    let u = S.phi / S.period;
    if (u < 0) u = 0; else if (u >= 1) u = 0.999999;
    return u;
  }

  /** A one-way follower: force k*(lift - x) when positive, reaction torque back on the shaft through d(lift)/dphi. */
  follow(S, lift, dLift, x, k, port) {
    const pen = lift - x;
    if (pen <= 0) return 0;
    const F = k * pen;
    S.tau -= F * dLift;
    if (port !== undefined) this.sim.ports[port] += F;
    return F;
  }

  driveCycle() {
    const h = this.sim.h;
    const S = this.cyc, sim = this.sim;
    if (!S.moving) return;
    const u = this.shaftU(S);
    // Clutch latch: at the end of the turn the check catches the tang unless the next key has already tripped it.
    if (S.on && !S.checked && u >= S.latch) {
      S.checked = true;
      const nextReady = this.ipKey >= 0 && this.restored && this.ipKind === K_PRINT && this.shiftIndex === this.wantHemisphere() && !this.shiftS.moving && this.motorW > this.wTrip;
      if (nextReady) S.chain = true; else { S.on = false; S.chain = false; S.wind = 0; sim.ac(AC.CLUTCH, 3, this.cyc.w); }
    }
    if (S.chain && S.phi >= S.period + S.offset) {
      S.phi -= S.period; S.chain = false; S.checked = false;
      this.finishCorrection();
      this.beginSelection(); this.restored = false; this.detented = false;
      sim.ac(AC.CLUTCH, 0, 1); this.cycles++;
    }
    // Interposer restored by the bail once the code is held in the latches.
    if (!this.restored && u >= this.restorePhase) {
      this.restored = true;
      if (this.ipKey === this.selKey) this.ipKey = -1;
    }
    this.camDet.at(u);
    this.camSel.at(u);
    if (!S.on) return;
    // Print rocker, ribbon lift and escapement: three cams on the same shaft.
    const camP = this.camPrt.at(u), L = this.stroke * camP.v, dL = this.stroke * camP.dv;
    const pen = L - this.rocker;
    if (pen > 0) {
      let Fr = this.rCamK * pen + this.rCamC * (dL * S.w - this.rockerV);   // the follower roller is not a perfect spring: it takes the rebound
      if (Fr < 0) Fr = 0;
      S.tau -= Fr * dL;
      this.rockerF = (this.rockerF ?? 0) + Fr;
    }
    if (this.correcting) {
      // The correction tape takes the ribbon's place: its own cam lifts it, the ribbon stays down, the escapement stays out.
      const camC = this.camCor.at(u);
      this.corF += this.follow(S, this.corFull * camC.v, this.corFull * camC.dv, this.cor, this.corK);
      this.tapeFed = this.feedBase + this.corInc * this.camCorFeed.at(u).v;
    } else {
      const camR = this.camRib.at(u);
      const lift = sim.vibrLiftTarget();
      const Fv = this.follow(S, lift * camR.v, lift * camR.dv, sim.vibr, this.kRib);
      if (Fv > 0) { sim.vibrF += Fv; sim.vibrAwake = true; sim.vibrSleep = 0; }
      const camE = this.camEsc.at(u);
      const Lesc = 1.08 * sim.uFull;
      const Fe = this.follow(S, Lesc * camE.v, Lesc * camE.dv, sim.u, this.kEsc);
      if (Fe > 0) { sim.uF += Fe; sim.escAwake = true; sim.escSleep = 0; }
    }
  }

  driveCorrectionLift() {
    const h = this.sim.h;
    if (this.cor === 0 && this.corV === 0 && this.corF === 0) return;
    let F = this.corF;
    this.corF = 0;
    const x = this.cor, v = this.corV;
    F -= this.corF0 + this.corRate * (x > 0 ? x : 0) + 0.6 * v;
    if (x < 0) { const Fs = 2e4 * -x - 8 * v; if (Fs > 0) F += Fs; }
    const vn = v + (F / this.corMass) * h;
    this.corV = vn; this.cor = x + vn * h;
    if (x <= 0 && vn <= 0 && F <= 0 && Math.abs(vn) < 1e-3) { this.cor = 0; this.corV = 0; }
  }

  driveOp() {
    const h = this.sim.h;
    const S = this.op, sim = this.sim;
    if (!S.moving) return;
    const u = this.shaftU(S);
    if (S.on && !S.checked && u >= S.latch) { S.checked = true; S.on = false; S.wind = 0; sim.ac(AC.CLUTCH, 3, S.w); }
    if (!this.opRestored && u >= 0.3) {
      this.opRestored = true;
      if (this.ipKey >= 0 && this.ipKind === this.opKeyKind) this.ipKey = -1;
    }
    if (!S.on) return;
    const fn = this.opFunc;
    if (fn === OP_SPACE) {
      const cam = this.opSpace.at(u), L = 1.08 * sim.uFull;
      const F = this.follow(S, L * cam.v, L * cam.dv, sim.u, this.kEsc);
      if (F > 0) { sim.uF += F; sim.escAwake = true; sim.escSleep = 0; }
    } else if (fn === OP_BACK) {
      const cam = this.opBack.at(u), L = 1.12 * sim.p;
      const target = this.backQ - L * cam.v;
      let pen = sim.q - target;     // pawl pulls q down toward target
      if (pen > 1.3 * sim.p) { this.backQ = sim.q + L * cam.v - 0.2 * sim.p; pen = 0.2 * sim.p; }
      if (pen > 0) {
        const Fc = this.kBackPawl * pen;
        sim.cF -= Fc;
        S.tau -= Fc * L * cam.dv;
        sim.escAwake = true; sim.escSleep = 0;
        sim.ports[PORT.DOG] += Fc;
      }
    } else if (fn === OP_INDEX || fn === OP_RETURN) {
      const cam = this.opIdx.at(u), L = 0.96 * sim.lsTravel;
      const Tp = this.follow(S, L * cam.v, L * cam.dv, sim.ll, this.kLs);
      if (Tp > 0) { sim.llT += Tp; sim.platenAwake = true; sim.platenSleep = 0; }
    }
  }

  driveShift() {
    const h = this.sim.h;
    const S = this.shiftS, sim = this.sim;
    if (!S.moving) return;
    const u = this.shaftU(S);
    if (S.on && !S.checked && u >= S.latch) { S.checked = true; S.on = false; S.wind = 0; sim.ac(AC.CLUTCH, 3, S.w); }
  }

  /** Spin the shaft through its clutch; stop it on the check at the end of the turn. */
  integrateShaft(S) {
    const h = this.sim.h;
    let T = S.tau;
    S.tau = 0;
    const sim = this.sim;
    if (S.on) {
      const rel = this.motorW / S.ratio - S.w;
      S.wind += rel * h;
      const wMax = S.Tmax / S.k;
      if (S.wind < 0) S.wind = 0; else if (S.wind > wMax) S.wind = wMax;
      let Tc = S.k * S.wind + S.cc * rel;
      if (Tc < 0) Tc = 0;
      T += Tc;
      this.motorT -= Tc / S.ratio;
    }
    T -= S.Cv * S.w + S.Tc * (S.w > 1 ? 1 : S.w < -1 ? -1 : S.w);
    const stop = S.period + S.offset;
    if (!S.on && S.moving && S.phi > stop) {
      let Ts = S.kStop * (S.phi - stop) + S.cStop * S.w;
      if (Ts < 0) Ts = 0;
      T -= Ts;
      sim.ports[PORT.DOG] += Ts * 2;
    }
    const w = S.w + (T / S.J) * h;
    S.w = w; S.phi += w * h;
    if (S.on && S.phi >= S.period + S.offset && !S.chain) {
      // A clutch that has not latched by the end of its turn keeps going: mistimed, but never stuck.
      S.phi -= S.period;
    }
    if (!S.on && S.moving && S.phi > stop - 0.08 && Math.abs(w) < 0.8) {
      S.phi = S.offset; S.w = 0; S.moving = false;
      if (S === this.shiftS) this.shiftIndex = 1 - this.shiftIndex;
      if (S === this.cyc) { this.selKey = -1; this.finishCorrection(); }
      if (S === this.op) this.opFunc = OP_NONE;
      if (S !== this.op) this.settle(S === this.cyc ? 0 : 2);
    }
    if (S.moving === false && Math.abs(S.phi) > 1e-9 && !S.on) S.phi = S.offset;
  }

  settle(which) { this.sim.ac(AC.SETTLE, which, Math.abs(this.rotV) + Math.abs(this.tiltV)); }

  // ---- selection DOFs --------------------------------------------------------------------
  /** The nearest allowed detent notch on the tilt or rotate carrier. */
  // The cam values come in fields set by driveSelection and the constants from the carrier's parameters P: each double
  // passed as an argument was boxed, some thirty heap numbers a substep.
  stepDof(st, P, sumN, lo, hi) {
    const h = this.sim.h, step = P.step, sum = sumN * step;
    const target = sum * this.selV, targetRate = sum * this.selDV * this.selW, dTargetCam = sum * this.selDV;
    const D = this.detV, dD = this.detDV, K = P.detentStiffness, Tmax = P.detentMaxTorque, J = P.inertia;
    const kt = P.tapeStiffness, ct = P.tapeDamping, visc = P.viscous, coul = P.bearingCoulomb, kStop = P.stopStiffness, cStop = P.stopDamping;
    const S = this.cyc;
    let x = st.x, v = st.v;
    let T = kt * (target - x) + ct * (targetRate - v);
    S.tau -= (kt * (target - x) + ct * (targetRate - v)) * dTargetCam;
    if (D > 1e-4) {
      if (!st.seated) { st.seated = true; st.notch = Math.max(lo, Math.min(hi, Math.round(x / step))); }
      const err = x - st.notch * step;
      const e0 = Tmax / K;
      const f = err > e0 ? Tmax : err < -e0 ? -Tmax : K * err;
      const Td = D * f;
      T -= Td;
      S.tau -= detentEnergy(err, K, Tmax) * dD;
    } else st.seated = false;
    T -= visc * v + coul * (v > 0.5 ? 1 : v < -0.5 ? -1 : v * 2);
    const min = (lo - 0.25) * step, max = (hi + 0.25) * step;
    if (x < min) { let F = kStop * (min - x) - cStop * v; if (F < 0) F = 0; T += F; }
    if (x > max) { let F = kStop * (x - max) + cStop * v; if (F < 0) F = 0; T -= F; }
    v += (T / J) * h;
    x += v * h;
    // At rest both decay towards zero; flush them before they go subnormal (many times slower on x86).
    if (v < 1e-20 && v > -1e-20) v = 0;
    if (x < 1e-20 && x > -1e-20) x = 0;
    st.x = x; st.v = v;
  }

  driveSelection() {
    const h = this.sim.h;
    const S = this.cyc;
    const sP = this.camSel, dP = this.camDet;
    let selV = 0, dSel = 0, detV = 0, dDet = 0;
    if (S.moving) {
      const u = this.shaftU(S);
      sP.at(u); dP.at(u);
      selV = sP.v; dSel = sP.dv; detV = dP.v; dDet = dP.dv;
      if (detV > 0.99 && !this.detented) { this.detented = true; this.settle(1); }
      if (detV < 0.01) this.detented = false;
    }
    const tP = this.tP, rP = this.rP;
    this.tiltSt = this.tiltSt ?? { x: 0, v: 0, seated: false, notch: 0 };
    this.rotSt = this.rotSt ?? { x: 0, v: 0, seated: false, notch: 0 };
    this.tiltSt.x = this.tilt; this.tiltSt.v = this.tiltV; this.rotSt.x = this.rot; this.rotSt.v = this.rotV;
    this.tiltSt.seated = this.tiltSeated; this.tiltSt.notch = this.tiltNotch; this.rotSt.seated = this.rotSeated; this.rotSt.notch = this.rotNotch;
    this.selV = selV; this.selDV = dSel; this.selW = S.moving ? S.w : 0; this.detV = detV; this.detDV = dDet;
    this.stepDof(this.tiltSt, tP, this.tiltSum, 0, 3);
    this.stepDof(this.rotSt, rP, this.rotSum, -COL_HALF, COL_HALF);
    this.tilt = this.tiltSt.x; this.tiltV = this.tiltSt.v; this.tiltSeated = this.tiltSt.seated; this.tiltNotch = this.tiltSt.notch;
    this.rot = this.rotSt.x; this.rotV = this.rotSt.v; this.rotSeated = this.rotSt.seated; this.rotNotch = this.rotSt.notch;
    // Hemisphere: ball half-turn through its own tape off the shift cam; two detents.
    const hS = this.shiftS, hP = this.hP;
    const chi = this.shiftIndex * Math.PI + hS.phi;
    const s = 0.5 * (1 - Math.cos(chi)), ds = 0.5 * Math.sin(chi);
    const target = Math.PI * s;
    const rate = Math.PI * ds * (hS.moving ? hS.w : 0);
    const kt = hP.tapeStiffness, ct = hP.tapeDamping;
    let T = kt * (target - this.hemi) + ct * (rate - this.hemiV);
    hS.tau -= T * Math.PI * ds;
    const notch = this.hemi > Math.PI / 2 ? Math.PI : 0;
    const err = this.hemi - notch;
    const e0 = hP.detentMaxTorque / hP.detentStiffness;
    T -= hS.moving ? 0 : (err > e0 ? hP.detentMaxTorque : err < -e0 ? -hP.detentMaxTorque : hP.detentStiffness * err);
    T -= hP.viscous * this.hemiV + hP.bearingCoulomb * (this.hemiV > 0.5 ? 1 : this.hemiV < -0.5 ? -1 : this.hemiV * 2);
    this.hemiV += (T / hP.inertia) * h;
    this.hemi += this.hemiV * h;
    if (this.hemi < -0.05) { this.hemi = -0.05; if (this.hemiV < 0) this.hemiV = 0; }
    if (this.hemi > Math.PI + 0.05) { this.hemi = Math.PI + 0.05; if (this.hemiV > 0) this.hemiV = 0; }
  }

  // ---- print rocker and contact -------------------------------------------------------------
  driveRocker() {
    const h = this.sim.h;
    const sim = this.sim, ports = sim.ports;
    let F = this.rockerF ?? 0;
    this.rockerF = 0;
    const x = this.rocker, v = this.rockerV;
    F -= this.rF0 + this.rRate * (x > 0 ? x : 0) + this.rC * v;
    if (x < 0) {
      let Fs = -this.rStopK * x - this.rStopC * v;
      if (Fs < 0) Fs = 0;
      F += Fs;
    }
    const delta = x - this.xContact;
    if (delta > 0) {
      if (!this.contact) this.beginContact(v);
      const faces = sim.faces, TN = FACE_TABLE_N, ti = delta / faces.dd;
      const j = ti >= TN - 1 ? TN - 2 : ti | 0, frac = ti - j, base = (this.bar * 2 + this.caseI) * TN + j;
      let Fe = faces.force[base] + (faces.force[base + 1] - faces.force[base]) * frac;
      if (ti > TN - 1) Fe = faces.force[base + 1] + (faces.force[base + 1] - faces.force[base]) * (ti - TN + 1);
      let Fc = Fe * (1 + this.alpha * v);
      if (Fc < 0) Fc = 0;
      F -= Fc;
      ports[PORT.SLUG] += Fc;
      if (Fc > this.peakF) this.peakF = Fc;
      if (delta > this.maxD) this.maxD = delta;
      sim.lastForce = Fc;
      const c = this.traceC++;
      if (c % TRACE_DECIM === 0 && this.traceN < TRACE_LEN) { this.traceF[this.traceN] = Fc; this.traceD[this.traceN] = delta; this.traceN++; }
    } else if (this.contact) this.endContact(v);
    let vn = v + (F / this.rMass) * h;
    if (vn > 20) vn = 20; else if (vn < -20) vn = -20;
    this.rockerV = vn; this.rocker = x + vn * h;
    this.inContact[this.bar] = this.contact ? 1 : 0;
    this.nActive = this.contact ? 1 : 0;
    this.activeList[0] = this.bar;
  }

  /** The face in line with the platen is whichever one the ball is actually seated on. */
  seatedFace() {
    const step = this.rP.step, tStep = this.tP.step;
    const col = Math.max(-COL_HALF, Math.min(COL_HALF, Math.round(this.rot / step)));
    const band = Math.max(0, Math.min(3, Math.round(this.tilt / tStep)));
    const idx = band * (2 * COL_HALF + 1) + col + COL_HALF;
    const key = this.cells[idx];
    this.bar = key >= 0 ? key : (this.selKey >= 0 ? this.selKey : 0);
    this.caseI = this.hemi > Math.PI / 2 ? 1 : 0;
    this.lastRotErr = this.rot - col * step;
    this.lastTiltErr = this.tilt - band * tStep;
  }

  beginContact(v) {
    this.seatedFace();
    this.contact = true;
    this.tBegin = this.sim.t; this.vIn = v; this.peakF = 0; this.maxD = 0; this.traceN = 0; this.traceC = 0;
  }

  endContact(v) {
    this.contact = false;
    const sim = this.sim;
    if (this.peakF < 1e-3 || sim.unlimited) return;
    sim.ac(AC.STRIKE, this.bar, this.peakF);
    const nT = this.traceN;
    const force = this.traceF.slice(0, nT), indent = this.traceD.slice(0, nT);
    const faces = sim.faces, table = (this.bar * 2 + this.caseI) * FACE_TABLE_N;
    const j = Math.min(FACE_TABLE_N - 1, (this.maxD / faces.dd) | 0);
    const area = faces.area[table + j];
    const gov = sim.glyphOverride?.[this.bar];
    sim.emitEvent({
      type: 'strike', bar: this.bar, caseIndex: this.caseI,
      tBegin: this.tBegin, duration: sim.t - this.tBegin,
      carriageX: sim.carriageX(), platenPsi: sim.psi, shiftY: 0,
      lateral: this.lastRotErr * this.ballR, vImpact: this.vIn, peakForce: this.peakF,
      maxIndent: this.maxD, restitution: this.vIn !== 0 ? Math.abs(v / this.vIn) : 0,
      skewRad: 0, vibratorLift: sim.vibr, ribbonInGap: sim.ribbonInGapNow() ? 1 : 0,
      ...(gov && sim.t - gov.t < 0.4 ? { char: gov.c } : null),
      peakPressure: faces.kf * this.maxD, meanPressure: area > 0 ? this.peakF / area : 0, contactArea: area,
      tiltError: this.lastTiltErr, rotateError: this.lastRotErr,
      ...(this.correcting ? { erase: true } : null),
      trace: { dt: sim.h * TRACE_DECIM, force, indent },
    });
  }

  /** Unlimited typing: the same impact integrated at once at the key's own seat. */
  instantStrike(k, force) {
    const sim = this.sim, faces = sim.faces, dd = faces.dd, TN = FACE_TABLE_N, h = sim.h;
    const caseI = sim.shiftLatch || this.wantHemisphere() ? 1 : 0;
    const table = (k * 2 + caseI) * TN;
    let vv = 1.4 + Math.min(1.4, Math.max(0, (force - 20) / 25)), d = 0, peak = 0, maxD = 0;
    const speed = vv, trace = new Float32Array(TRACE_LEN), indent = new Float32Array(TRACE_LEN);
    let c = 0, nT = 0;
    for (; c < 20000; c++) {
      d += vv * h;
      if (d <= 0) break;
      const ti = d / dd, j = ti >= TN - 1 ? TN - 2 : ti | 0, frac = ti - j;
      let Fe = faces.force[table + j] + (faces.force[table + j + 1] - faces.force[table + j]) * frac;
      if (ti > TN - 1) Fe = faces.force[table + j + 1] + (faces.force[table + j + 1] - faces.force[table + j]) * (ti - TN + 1);
      let F = Fe * (1 + this.alpha * vv);
      if (F < 0) F = 0;
      vv -= (F / this.rMass) * h;
      if (F > peak) peak = F;
      if (d > maxD) maxD = d;
      if (c % TRACE_DECIM === 0 && nT < TRACE_LEN) { trace[nT] = F; indent[nT] = d; nT++; }
    }
    sim.ac(AC.STRIKE, k, peak);
    const k0 = Math.min(TN - 1, (maxD / dd) | 0), area = faces.area[table + k0];
    const lift = sim.vibrLiftTarget();
    const gov = sim.glyphOverride?.[k];
    sim.emitEvent({
      type: 'strike', bar: k, caseIndex: caseI, unlimited: true,
      tBegin: sim.t, duration: c * h, carriageX: sim.carriageX(), platenPsi: sim.psi, shiftY: 0,
      lateral: 0, vImpact: speed, peakForce: peak, maxIndent: maxD, restitution: speed ? Math.abs(vv / speed) : 0,
      skewRad: 0, vibratorLift: lift, ribbonInGap: sim.env.ribbonInGap && lift > 0 ? 1 : 0,
      ...(gov && sim.t - gov.t < 0.4 ? { char: gov.c } : null),
      peakPressure: faces.kf * maxD, meanPressure: area > 0 ? peak / area : 0, contactArea: area,
      trace: { dt: h * TRACE_DECIM, force: trace.slice(0, nT), indent: indent.slice(0, nT) },
    });
  }

  // ---- return, tab -------------------------------------------------------------------------
  driveReturn() {
    const h = this.sim.h;
    const sim = this.sim, S = this.op;
    if (this.opFunc === OP_RETURN && !this.returnLatched && S.moving && this.shaftU(S) >= this.retLatchPhase) { this.returnLatched = true; sim.escAwake = true; sim.escSleep = 0; }
    if (this.returnLatched) {
      if (this.motorW < 0.2 * this.wRated) { this.returnLatched = false; this.ipKey = this.ipKey >= 0 && this.ipKind === K_RETURN ? -1 : this.ipKey; return; }
      const qL = sim.q0Sign * (sim.ax[3] - sim.xStart);
      const atMargin = sim.q <= qL + this.retTol || (sim.stopOn && sim.q < qL + 0.002);
      const retV = -sim.qV;
      if (atMargin && retV < this.retArrV) { this.returnLatched = false; sim.ac(AC.CLUTCH, 4, 1); return; }
      const dist = Math.max(0, sim.q - qL);
      const vt = Math.max(this.retMin, this.retV * Math.min(1, dist / this.retZone));
      let F = this.retG * (vt - retV);
      if (F < 0) F = 0;
      const limit = this.retF * Math.min(1, this.motorW / this.wRated);
      if (F > limit) F = limit;
      sim.cF -= F;
      if (retV > 0) this.motorT -= (F * retV) / Math.max(40, this.motorW);
      sim.escAwake = true; sim.escSleep = 0;
    }
    if (this.tabLatched) {
      const tp = this.tabP;
      // A tab key held down keeps the stops out of the way; letting go drops the latch at the next one ahead.
      if (!this.tabStopping) {
        if (this.keyU[this.tabK] > tp.holdFraction) { this.tabHeld = true; this.tabTargetQ = Infinity; }
        else if (this.tabHeld) { this.tabHeld = false; this.tabTargetQ = this.nextTabQ(); }
      }
      let stopForce = sim.q > this.tabTargetQ ? tp.stopStiffness * (sim.q - this.tabTargetQ) + tp.stopDamping * sim.qV : 0;
      if (stopForce < 0) stopForce = 0;
      if (stopForce > 0) {
        sim.cF -= stopForce; sim.ports[PORT.STOP] += stopForce;
        // Resting on the stop, not merely turning round at the bottom of a bounce off it.
        this.tabRest = Math.abs(sim.qV) < tp.arrivalSpeed ? this.tabRest + h : 0;
        if (this.tabRest > TAB_REST_S) this.tabStopping = true;
      } else this.tabRest = 0;
      // Without a stop ahead the carrier runs out to the right margin.
      const qR = sim.q0Sign * (sim.ax[4] - sim.xStart);
      if (!Number.isFinite(this.tabTargetQ) && sim.q >= qR - 0.0005 && Math.abs(sim.qV) < 0.04) this.tabStopping = true;
      // The stop holds the carrier while the dogs come back down, so it lands on the stop's own tooth.
      if (this.tabStopping && this.relief < 0.02) { this.tabLatched = false; this.tabStopping = false; sim.ac(AC.CLUTCH, 4, 1); }
      sim.escAwake = true; sim.escSleep = 0;
    }
  }

  guard() {
    let bad = false;
    for (const S of [this.cyc, this.op, this.shiftS]) if (!ok(S.phi) || !ok(S.w) || !ok(S.tau) || !ok(S.wind)) { S.phi = 0; S.w = 0; S.tau = 0; S.wind = 0; S.on = false; S.moving = false; bad = true; }
    if (!ok(this.motorW)) { this.motorW = this.wRated; bad = true; }
    if (!ok(this.tilt) || !ok(this.tiltV)) { this.tilt = 0; this.tiltV = 0; bad = true; }
    if (!ok(this.rot) || !ok(this.rotV)) { this.rot = 0; this.rotV = 0; bad = true; }
    if (!ok(this.hemi) || !ok(this.hemiV)) { this.hemi = 0; this.hemiV = 0; bad = true; }
    if (!ok(this.rocker) || !ok(this.rockerV)) { this.rocker = 0; this.rockerV = 0; bad = true; }
    return bad;
  }

  /** Stored energy of the action. Cam-spring terms exist only while the cam leads its follower. */
  energy() {
    const { sim, E } = this;
    let e = 0.5 * this.Jm * this.motorW * this.motorW;
    for (const S of [this.cyc, this.op, this.shiftS]) {
      e += 0.5 * S.J * S.w * S.w;
      if (S.on) e += 0.5 * S.k * S.wind * S.wind;
      const stop = S.period + S.offset;
      if (!S.on && S.moving && S.phi > stop) e += 0.5 * S.kStop * (S.phi - stop) ** 2;
    }
    // Tilt, rotate, hemisphere.
    const S = this.cyc, u = S.moving ? this.shaftU(S) : 0;
    this.camSel.at(u); this.camDet.at(u);
    const tP = this.tP, rP = this.rP;
    const tTarget = this.tiltSum * tP.step * this.camSel.v, rTarget = this.rotSum * rP.step * this.camSel.v;
    e += 0.5 * tP.inertia * this.tiltV ** 2 + 0.5 * tP.tapeStiffness * (tTarget - this.tilt) ** 2;
    e += 0.5 * rP.inertia * this.rotV ** 2 + 0.5 * rP.tapeStiffness * (rTarget - this.rot) ** 2;
    const D = this.camDet.v;
    if (D > 1e-4) {
      const errT = this.tilt - this.tiltNotch * tP.step, errR = this.rot - this.rotNotch * rP.step;
      e += D * (detentEnergy(errT, tP.detentStiffness, tP.detentMaxTorque) + detentEnergy(errR, rP.detentStiffness, rP.detentMaxTorque));
    }
    const hS = this.shiftS, hP = this.hP, chi = this.shiftIndex * Math.PI + hS.phi;
    const hT = Math.PI * 0.5 * (1 - Math.cos(chi));
    e += 0.5 * hP.inertia * this.hemiV ** 2 + 0.5 * hP.tapeStiffness * (hT - this.hemi) ** 2;
    if (!hS.moving) {
      const notch = this.hemi > Math.PI / 2 ? Math.PI : 0;
      e += detentEnergy(this.hemi - notch, hP.detentStiffness, hP.detentMaxTorque);
    }
    // Rocker.
    const x = this.rocker;
    e += 0.5 * this.rMass * this.rockerV ** 2 + this.rF0 * Math.max(x, 0) + 0.5 * this.rRate * Math.max(x, 0) ** 2;
    if (x < 0) e += 0.5 * this.rStopK * x * x;
    e += 0.5 * this.corMass * this.corV ** 2 + this.corF0 * Math.max(this.cor, 0) + 0.5 * this.corRate * Math.max(this.cor, 0) ** 2;
    if (this.cor < 0) e += 0.5 * 2e4 * this.cor ** 2;
    const uP = S.moving ? this.shaftU(S) : 0;
    const penR = (S.moving ? this.stroke * this.camPrt.at(uP).v : 0) - x;
    if (penR > 0) e += 0.5 * this.rCamK * penR * penR;
    const delta = x - this.xContact;
    if (delta > 0) {
      const faces = sim.faces, ti = delta / faces.dd, TN = FACE_TABLE_N;
      const j = ti >= TN - 1 ? TN - 2 : ti | 0, fr = ti - j, base = (this.bar * 2 + this.caseI) * TN + j;
      e += faces.energy[base] + (faces.energy[base + 1] - faces.energy[base]) * fr;
    }
    // Cam strains on the common mechanism's DOFs.
    if (S.moving && this.correcting) {
      const pc = this.corFull * this.camCor.at(uP).v - this.cor; if (pc > 0) e += 0.5 * this.corK * pc * pc;
    } else if (S.moving) {
      const camR = this.camRib.at(uP), lift = sim.vibrLiftTarget();
      const pv = lift * camR.v - sim.vibr; if (pv > 0) e += 0.5 * this.kRib * pv * pv;
      const camE = this.camEsc.at(uP);
      const pe = 1.08 * sim.uFull * camE.v - sim.u; if (pe > 0) e += 0.5 * this.kEsc * pe * pe;
    }
    const O = this.op;
    if (O.moving) {
      const uo = this.shaftU(O);
      if (this.opFunc === OP_SPACE) { const p = 1.08 * sim.uFull * this.opSpace.at(uo).v - sim.u; if (p > 0) e += 0.5 * this.kEsc * p * p; }
      if (this.opFunc === OP_INDEX || this.opFunc === OP_RETURN) { const p = 0.96 * sim.lsTravel * this.opIdx.at(uo).v - sim.ll; if (p > 0) e += 0.5 * this.kLs * p * p; }
      if (this.opFunc === OP_BACK) {
        const p = sim.q - (this.backQ - 1.12 * sim.p * this.opBack.at(uo).v);
        if (p > 0) e += 0.5 * this.kBackPawl * p * p;
      }
    }
    return e;
  }

  snapshot(s, L) {
    s[L.motorOmega] = this.motorW; s[L.motorOn] = this.motorOn ? 1 : 0;
    s[L.printShaft] = this.cyc.phi; s[L.clutchOn] = this.cyc.on ? 1 : 0; s[L.opShaft] = this.op.phi;
    s[L.shiftShaft] = this.shiftS.phi + this.shiftIndex * Math.PI;
    s[L.interposerKey] = this.ipKey; s[L.selectedKey] = this.selKey;
    s[L.tilt] = this.tilt; s[L.rotate] = this.rot; s[L.hemisphere] = this.hemi;
    s[L.printRocker] = this.rocker;
    s[L.returnLatched] = this.returnLatched ? 1 : 0; s[L.tabLatched] = this.tabLatched ? 1 : 0;
    s[L.correctionLift] = Math.max(0, Math.min(1, this.cor / this.corFull)); s[L.correctionTape] = this.tapeFed;
  }

  exportState() {
    const shaft = (S) => ({ phi: S.phi, w: S.w, on: S.on, moving: S.moving, wind: S.wind, checked: S.checked, chain: !!S.chain });
    return {
      motorOn: this.motorOn, motorW: this.motorW,
      tilt: this.tilt, tiltV: this.tiltV, tiltSum: this.tiltSum, tiltNotch: this.tiltNotch, tiltSeated: this.tiltSeated,
      rot: this.rot, rotV: this.rotV, rotSum: this.rotSum, rotNotch: this.rotNotch, rotSeated: this.rotSeated,
      hemi: this.hemi, hemiV: this.hemiV, shiftIndex: this.shiftIndex,
      selKey: this.selKey, ipKey: this.ipKey, ipKind: this.ipKind ?? 0, restored: this.restored, opRestored: this.opRestored, opFunc: this.opFunc,
      opKeyKind: this.opKeyKind ?? 0, returnLatched: this.returnLatched, tabLatched: this.tabLatched, tabStopping: this.tabStopping, tabTargetQ: this.tabTargetQ, tabK: this.tabK, tabHeld: this.tabHeld, tabRest: this.tabRest, relief: this.relief, backQ: this.backQ,
      rocker: this.rocker, rockerV: this.rockerV, cycles: this.cycles,
      correctionArmed: this.correctionArmed, correcting: this.correcting, cor: this.cor, corV: this.corV, tapeFed: this.tapeFed, feedBase: this.feedBase,
      armed: this.armed.slice(), tabStops: this.tabStops.slice(),
      cyc: shaft(this.cyc), op: shaft(this.op), shiftS: shaft(this.shiftS),
    };
  }

  importState(s) {
    for (const k of Object.keys(s)) if (typeof s[k] === 'number' || typeof s[k] === 'boolean') this[k] = s[k];
    this.armed.set(s.armed); this.tabStops.set(s.tabStops);
    for (const name of ['cyc', 'op', 'shiftS']) Object.assign(this[name], s[name]);
    this.sim.dogRelief = this.relief;
  }
}

/** A finite number. Module level: guard() runs every 256 substeps and a closure there would be a new object each time. */
function ok(x) { return x - x === 0; }
