// MechanicalSim: the rigid mechanism of the typewriter, integrated at 384 kHz with symplectic Euler,
// real unilateral contacts and per-element sleeping. Pure JS and typed arrays, no DOM or audio.
// Everything that happens (spacing, carriage return ratchet, jams, the bell) is a consequence of
// these contacts; nothing is triggered by key events.
import { makeLayout } from './layout.js';
import { buildFaceTables } from './faces.js';
import { createAction } from './actions.js';
import { PORT, AC } from './ports.js';

const SLEEP_FRAMES = 384;
const KEY_PRINT = 0, KEY_SPACE = 1, KEY_SHIFT = 2, KEY_LOCK = 3, KEY_BACKSPACE = 4, KEY_MARGIN = 5;
const AUX = { paperRelease: 0, carriageRelease: 1, bail: 2, marginL: 3, marginR: 4, ribbonSelector: 5 };
const AUX_N = 6;
const FINGER_MAX = 16;
const GRAB_MAX = 32;
const DOF_KEY = 1, DOF_BAR = 2, DOF_CARRIAGE = 3, DOF_PLATEN = 4, DOF_LSLEVER = 5, DOF_AUX = 6;
const FLOOR = Math.floor;
// Hard rate limits: no real motion gets near these. They are the last resort against runaway, not physics
// anyone should see; the speed a hand can reach is limited in the grab force below.
const V_KEY = 8, V_CAR = 8, V_PSI = 160, V_LL = 90, V_DOG = 40, V_AUX = 160, V_HAMMER = 400;
const SHIFT_V = 8;

export const SUBSTEP_HZ = 384000;

export class MechanicalSim {
  constructor({ machine, geometry, glyphs } = {}) {
    if (!machine || !geometry) throw new Error('MechanicalSim needs { machine, geometry }');
    this.m = machine; this.g = geometry;
    this.h = 1 / SUBSTEP_HZ;
    this.t = 0;
    this.layout = makeLayout(geometry);
    this.env = {
      paperCaliperM: machine.paper.thickness, ribbonCaliperM: machine.ribbon.thickness,
      ribbonInGap: true, paperPresent: true, paperStrength: 1,
    };
    this.glyphs = glyphs;
    this.faces = buildFaceTables(machine, geometry, glyphs);
    this.ports = new Float64Array(PORT.COUNT);
    this.acQ = new Float64Array(3 * 256); this.acN = 0; this.keyBot = new Uint8Array(512); this.keyTop = new Uint8Array(512); this.stopOn = false; this.shiftStop = 0;
    this.events = [];
    this.lastForce = 0;
    this.workExt = 0;  // work done by fingers and grabs, for the conservative checks
    this.guardTick = 0;

    // Keys
    const nk = geometry.nKeys;
    this.nKeys = nk; this.nPrint = geometry.nPrint;
    this.kx = new Float64Array(nk); this.kv = new Float64Array(nk); this.kF = new Float64Array(nk);
    this.kTravel = new Float64Array(nk);
    this.unlimited = false; this.spaceK = -1;
    this.kEdge = new Uint8Array(nk).fill(1);   // unlimited mode: armed for one keystroke as the key goes down
    this.kSkip = new Uint8Array(nk);           // unlimited mode: this stroke was already printed by pressKey
    this.kRet0 = new Float64Array(nk);
    this.kType = new Uint8Array(nk);
    this.kAwake = new Uint8Array(nk);
    this.kActive = new Int32Array(nk);
    this.kSleep = new Int32Array(nk);
    this.nActiveK = 0;
    this.kBack = -1; // backspace pawl latch position, -1 when disengaged
    // Fingers (timed Hill-type finger force)
    this.fKey = new Int32Array(FINGER_MAX); this.fT0 = new Float64Array(FINGER_MAX);
    this.fPeak = new Float64Array(FINGER_MAX); this.fDur = new Float64Array(FINGER_MAX);
    this.nFingers = 0;
    // Grabs (virtual spring on a DOF)
    this.gDof = new Int32Array(GRAB_MAX); this.gIndex = new Int32Array(GRAB_MAX);
    this.gTarget = new Float64Array(GRAB_MAX); this.gK = new Float64Array(GRAB_MAX);
    this.gC = new Float64Array(GRAB_MAX); this.gMax = new Float64Array(GRAB_MAX); this.gVhand = new Float64Array(GRAB_MAX);
    this.gActive = new Int32Array(GRAB_MAX); this.nGrabs = 0;
    this.nextGrabId = 1;
    this.gIdToSlot = new Map();

    // Escapement group
    this.u = 0; this.uV = 0; this.uF = 0;
    this.yf = 0; this.yfV = 0; this.yl = 0; this.ylV = 0; this.sl = 0; this.slV = 0;
    // Carriage
    this.q = 0; this.qV = 0; this.cF = 0; this.cZ = 0;
    this.escAwake = false; this.escSleep = 0;
    // Shift
    this.shiftY = 0; this.shiftV = 0; this.shiftF = 0; this.shiftAwake = false; this.shiftSleep = 0;
    this.shiftLatch = 0;
    // Platen group
    this.psi = 0; this.psiV = 0; this.psiT = 0;
    this.ll = 0; this.llV = 0; this.llT = 0;
    this.pawlEngaged = false; this.pawlArmed = true; this.pawl0 = 0; this.lineTeeth = 1;
    this.platenAwake = false; this.platenSleep = 0;
    // Bell
    this.hammer = 0; this.hammerV = 0; this.bellArmed = true; this.bellAwake = false; this.bellSleep = 0;
    this.bellContact = false; this.bellPeak = 0; this.bellF = 0; this.hammerT = 0;
    this.llF = 0; this.toothFy = 0; this.toothFs = 0;
    // Vibrator and ribbon pawl
    this.vibr = 0; this.vibrV = 0; this.vibrF = 0; this.vibrAwake = false; this.vibrSleep = 0;
    this.rp = 0; this.rpV = 0;
    // Aux levers
    this.ax = new Float64Array(AUX_N); this.av = new Float64Array(AUX_N); this.aF = new Float64Array(AUX_N);
    this.aAwake = new Uint8Array(AUX_N); this.aSleep = new Int32Array(AUX_N);
    this.deriveConstants();
    this.action = createAction(this);
    this.reset();
  }

  /** Recompute every constant derived from the machine definition (also after setParam). */
  deriveConstants() {
    const m = this.m, g = this.g;
    const esc = m.escapement, car = m.carriage;
    this.p = esc.pitch; this.D = esc.toothDepth;
    this.yBot = (esc.dogEngageFloor ?? 0.25) * this.D;
    this.q0Sign = car.typingDirection ?? -1;            // x direction of typing (see report)
    this.xStart = car.startX;
    this.railMin = -car.travel / 2; this.railMax = car.travel / 2;
    this.kTooth = esc.toothStiffness; this.cTooth = esc.toothDamping;
    this.kRamp = esc.rampStiffness ?? 2.5e6; this.cRamp = esc.rampDamping ?? 120;
    this.kDogStop = esc.dogStop; this.kDogSpring = esc.dogSpring; this.dogMass = esc.dogMass;
    this.Fdog0 = esc.dogPreload ?? 0.4;
    this.kCam = esc.camStiffness ?? 4e4;
    this.rFix = esc.fixedReleaseAt; this.rLoose = esc.looseEngageAt;
    this.qLoose = (esc.looseClear ?? 0.25) * esc.looseSlack;
    this.sMax = esc.looseSlack - this.qLoose;
    this.kSlack = esc.looseSpring;
    this.kSlackStop = esc.slackStop ?? 1.5e6;
    this.toothRamp = this.D / this.p;
    this.rampNorm = Math.sqrt(1 + this.toothRamp * this.toothRamp);
    const ub = m.universalBar;
    this.uMass = ub.mass; this.uSpring0 = ub.spring; this.uRate = ub.springRate;
    this.uFull = (1 - ub.tripAtKeyFraction) * m.linkage.keyTravel;
    this.kUbar = ub.contactStiffness ?? 8e4; this.cUbar = ub.contactDamping ?? 40;
    this.tripFrac = ub.tripAtKeyFraction;
    this.kVibr = 2e4;
    const vib = m.ribbon.vibrator;
    this.vibrMass = vib.mass ?? 0.012; this.vibrStart = vib.liftStartKeyFraction;
    this.vibrLift = vib.fullLift; this.vibrSpring0 = vib.spring0 ?? 0.8; this.vibrRate = vib.springRate ?? 90;
    this.rpMass = 0.001; this.rpFull = m.ribbon.feedPerKey; this.kRp = 2500; this.rpRet = 20;
    const kd = m.keys;
    this.keyMass = kd.mass; this.keyRetRate = kd.returnRate; this.keyCoulomb = kd.coulomb ?? 0;
    this.kFelt = kd.felt.k; this.cFelt = kd.felt.c;
    this.mCar = car.mass; this.drawF0 = car.drawbandPreload; this.drawRate = car.drawbandRate;
    this.railC = car.railViscous; this.railF = car.railCoulomb; this.releaseBrake = car.releaseBrake ?? 0; this.railZs = car.railBristle ?? 2e-5;
    this.kStop = car.stopStiffness; this.cStop = car.stopDamping;
    this.shiftTravel = car.shiftTravel; this.shiftF0 = car.shiftSpring; this.shiftRate = car.shiftSpringRate;
    this.kShiftLink = 3e5; this.cShiftLink = 80;
    const ls = m.lineSpace;
    this.lsJ = ls.inertia; this.lsSpring0 = ls.spring; this.lsRate = ls.springRate;
    this.lsTravel = ls.travel; this.lsLeverLen = ls.leverLength;
    this.lsPick = ls.pawlPick ?? 0.12 * ls.travel;
    this.lsEnd = ls.pawlEnd ?? 0.9 * ls.travel;
    this.lsRearm = ls.pawlRearm ?? 0.1 * this.lsPick;   // the pawl drops back behind a tooth only when the lever is really home
    this.lsKStop = ls.stopStiffness ?? 8;
    this.lsCStop = ls.stopDamping ?? 0.02;
    this.lsDamp = ls.damping ?? 2e-4;
    this.teeth = ls.pawlTeethPerSpace;
    if (!this.lineSpaceSetting) this.lineSpaceSetting = ls.defaultSpace;
    this.kPawl = ls.pawlStiffness ?? 1500;
    this.pawlMaxT = ls.pawlMaxTorque ?? 6;
    this.cPawl = ls.pawlDamping ?? 0.4;
    this.kOver = ls.overthrowStiffness ?? 2500;
    const pl = m.platen;
    this.psiJ = pl.inertia; this.psiV0 = pl.bearingViscous; this.psiC0 = pl.bearingCoulomb;
    this.detN = pl.detentNotches; this.detT = pl.detentTorque;
    this.cOver = 1.8 * Math.sqrt(this.kOver * pl.inertia);   // nearly critical: the stop does not throw the platen back
    this.ratchet = 2 * Math.PI / pl.ratchetTeeth;
    const b = m.bell;
    this.hammerJ = b.hammerInertia; this.hammerSpring = b.hammerSpring;
    this.bellRing = b.ringsBeforeRightMargin;
    this.bellGap = b.gap ?? 0.09;      // rad, hammer rest to bell
    this.bellR = b.hammerArm ?? 0.028;
    this.bellK = b.contactHertz ?? 2.5e9;
    this.bellAlpha = b.contactAlpha ?? 0.1;
    this.bellCam = b.camLift ?? 0.45;  // rad the finger cocks the hammer
    this.bellCamW = b.camWidth ?? 0.0014;  // m of carriage travel over which the finger lifts
    this.bellCamK = b.camStiffness ?? 1.2;
    this.bellDamp = b.damping ?? 1.1e-4;
    const f = m.finger ?? {};
    this.fVmax = f.vMax ?? 0.45; this.fHillB = f.hillB ?? 4; this.fAttack = f.attack ?? 0.008; this.fRelease = f.release ?? 0.014;
    this.auxParams = this.auxParams ?? this.buildAux();
    this.setEnvDerived();
  }

  buildAux() {
    const m = this.m, tb = m.bell;
    return [
      /* paperRelease  */ { J: 1.2e-5, spring0: 0, rate: 0, lo: 0, hi: 1.0, visc: 8e-4, coul: 5e-3, detents: [0, 1.0], detentT: 0.06, kStop: 80, cStop: 0.03 },
      /* carriageRelease */ { J: 6e-6, spring0: 0, rate: 0, lo: 0, hi: 0.35, visc: 2e-4, coul: 5e-4, detents: [0, 0.35], detentT: 0.02, kStop: 60, cStop: 0.02 },   // latches open: one pointer cannot hold it and slide the carriage
      /* bail          */ { J: 2.5e-5, spring0: 0.02, rate: 0.08, lo: 0, hi: m.paper.bailTravel, visc: 4e-4, coul: 8e-4, detents: null, detentT: 0, kStop: 40, cStop: 0.02 },
      /* marginL  m */ { J: 0.015, spring0: 0, rate: 0, lo: -0.15, hi: 0.15, visc: 18, coul: 0.5, detents: null, detentT: 0, kStop: 3e4, cStop: 30 },
      /* marginR  m */ { J: 0.015, spring0: 0, rate: 0, lo: -0.15, hi: 0.15, visc: 18, coul: 0.5, detents: null, detentT: 0, kStop: 3e4, cStop: 30 },
      /* ribbonSelector */ { J: 4e-6, spring0: 0, rate: 0, lo: 0, hi: 0.7, visc: 2e-4, coul: 3e-4, detents: [0, 0.35, 0.7], detentT: 0.03, kStop: 30, cStop: 0.01 },
    ];
  }

  stackCaliper() {
    const e = this.env;
    return (e.paperPresent ? e.paperCaliperM : 0) + (e.ribbonInGap ? e.ribbonCaliperM : 0);
  }
  ribbonInGapNow() { return this.env.ribbonInGap && this.vibr > 0.55 * this.vibrLift; }
  carriageX() { return this.xStart + this.q0Sign * this.q; }

  setEnvDerived() {
    if (this.action) this.action.setEnv();
  }

  setEnv(e) {
    Object.assign(this.env, e);
    this.setEnvDerived();
  }

  /** Update a parameter of the machine by dotted path, e.g. setParam('carriage.mass', 2.4). */
  setParam(path, value) {
    if (path === 'typing.unlimited') {
      const on = !!value;
      if (on && !this.unlimited) this.action.clearBarContacts();
      this.unlimited = on;
      return true;
    }
    const keys = path.split('.');
    let o = this.m;
    for (let i = 0; i < keys.length - 1; i++) { o = o[keys[i]]; if (o === undefined) return false; }
    o[keys[keys.length - 1]] = value;
    if (keys[0] === 'slug' || keys[0] === 'platen') this.faces = buildFaceTables(this.m, this.g, this.glyphs);
    this.auxParams = this.buildAux();
    this.deriveConstants();
    this.action.setupConstants();
    return true;
  }

  reset() {
    const q0 = 0;
    this.kx.fill(0); this.kv.fill(0); this.kF.fill(0);
    this.kAwake.fill(0); this.nActiveK = 0; this.nFingers = 0; this.nGrabs = 0;
    for (let k = 0; k < this.nKeys; k++) {
      const key = this.g.keys[k];
      const code = key.kind === 'print' ? KEY_PRINT
        : key.id === 'space' ? KEY_SPACE
        : key.id === 'shiftL' || key.id === 'shiftR' ? KEY_SHIFT
        : key.id === 'shiftLock' ? KEY_LOCK
        : key.id === 'backspace' ? KEY_BACKSPACE
        : key.id === 'marginRelease' ? KEY_MARGIN : KEY_SPACE;
      this.kType[k] = code;
      if (key.id === 'space') this.spaceK = k;
      this.kTravel[k] = key.travel;
      this.kRet0[k] = key.returnForce;
    }
    this.u = 0; this.uV = 0;
    this.yf = this.yBot; this.yfV = 0; this.yl = this.camLoose(0); this.ylV = 0; this.sl = 0; this.slV = 0;
    this.q = q0; this.qV = 0; this.cF = 0; this.cZ = 0;
    this.shiftY = 0; this.shiftV = 0; this.shiftLatch = 0;
    this.psi = 0; this.psiV = 0; this.ll = 0; this.llV = 0;
    this.hammer = 0; this.hammerV = 0;
    this.vibr = 0; this.vibrV = 0; this.rp = 0; this.rpV = 0;
    this.ax.fill(0); this.av.fill(0);
    const car = this.m.carriage;
    this.ax[AUX.marginL] = car.marginLeftX ?? car.startX + 0.0005;
    this.ax[AUX.marginR] = car.marginRightX ?? car.startX - 0.1905;
    this.escAwake = false; this.platenAwake = false; this.bellAwake = false; this.vibrAwake = false; this.shiftAwake = false;
    this.kBack = -1;
    this.pawlEngaged = false; this.pawlArmed = true; this.bellArmed = true;
    this.lastForce = 0; this.workExt = 0; this.t = 0; this.events.length = 0;
  }

  // ---- external inputs ------------------------------------------------------------
  /** A timed Hill-type finger: peak force at bottom-out, velocity-limited in between. */
  pressKey(k, peakForceN, durationS, glyph) {
    if (k < 0 || k >= this.nKeys) return;
    // Terminal mode only: the strike this press produces carries `glyph` so a donor bar can print a character it has no slug for.
    (this.glyphOverride ??= [])[k] = glyph ? { c: glyph, t: this.t } : null;
    if (this.unlimited && Number.isFinite(peakForceN)) { this.unlimitedKeystroke(k, peakForceN); this.kSkip[k] = 1; }
    if (this.nFingers >= FINGER_MAX || !Number.isFinite(peakForceN) || !Number.isFinite(durationS)) return;
    peakForceN = Math.min(Math.max(peakForceN, 0), 150); durationS = Math.min(Math.max(durationS, 0), 10);
    const i = this.nFingers++;
    this.fKey[i] = k; this.fPeak[i] = peakForceN; this.fDur[i] = durationS; this.fT0[i] = this.t;
    this.wakeKey(k);
  }

  /** A finger flicking the bell hammer back and letting go: the same hammer, spring and bell contact as the carriage trip. */
  flickBell() { this.bellFlick = 0.008; this.bellAwake = true; this.bellSleep = 0; }

  /**
   * Unlimited typing (setParam('typing.unlimited', true)), deliberately unphysical: the keystroke prints at once at the
   * carriage's current column and the carriage is then moved on by exactly one pitch. The rack is periodic in the pitch,
   * so the dogs stay seated. The bar and key still move, but only as a picture.
   */
  unlimitedKeystroke(k, force) {
    if (this.kType[k] === KEY_PRINT) this.action.instantStrike(k, force);
    else if (k !== this.spaceK) return;
    const next = this.q + this.p;
    const qR = this.q0Sign * (this.ax[AUX.marginR] - this.xStart);
    const x = this.xStart + this.q0Sign * next;
    if ((next <= qR + 3e-4 || this.marginReleased()) && x >= this.railMin && x <= this.railMax) {
      const qT = qR - this.bellRing;
      if (this.bellArmed && this.q < qT + this.bellCamW && next >= qT + this.bellCamW) {   // the step jumps the bell cam: cock it
        this.hammer = this.bellCam; this.hammerV = 0; this.bellAwake = true; this.bellSleep = 0;
      }
      this.q = next;
    }
    this.escAwake = true; this.escSleep = 0;
  }

  wakeKey(k) {
    if (!this.kAwake[k]) { this.kAwake[k] = 1; this.kActive[this.nActiveK++] = k; }
    this.kSleep[k] = 0;
  }

  grab(dof, index = 0, { target, k, c, maxF } = {}) {
    const code = dofCode(dof);
    if (code < 0 || this.nGrabs >= GRAB_MAX) return -1;
    let auxIdx = index;
    if (code === DOF_AUX) auxIdx = AUX[dof];
    const slot = this.nGrabs++;
    const id = this.nextGrabId++;
    this.gIdToSlot.set(id, slot);
    this.gDof[slot] = code; this.gIndex[slot] = auxIdx;
    const d = grabDefaults(dof);
    this.gTarget[slot] = finiteOr(target, this.dofPosition(code, auxIdx));
    this.gActive[slot] = id;
    // Stability: the virtual coupling must stay well inside omega*dt < 2 for the DOF's own inertia, and no
    // hand is stronger than maxF for its grip on that part.
    const inertia = this.dofInertia(code, auxIdx);
    const wMax = 0.25 / this.h;
    const kMax = inertia * wMax * wMax, cMax = (0.3 * inertia) / this.h;
    this.gK[slot] = clampFinite(k ?? d.k, 0, kMax);
    this.gC[slot] = clampFinite(c ?? d.c, 0, cMax);
    this.gMax[slot] = clampFinite(maxF ?? d.maxF, 0, d.hardMax);
    this.gVhand[slot] = d.vHand;
    this.wakeDof(code, auxIdx);
    return id;
  }

  moveGrab(g, target) {
    const s = this.gIdToSlot.get(g);
    if (s !== undefined && Number.isFinite(target)) this.gTarget[s] = target;
  }

  release(g) {
    const s = this.gIdToSlot.get(g);
    if (s === undefined) return;
    this.gIdToSlot.delete(g);
    const last = --this.nGrabs;
    if (s !== last) {
      this.gDof[s] = this.gDof[last]; this.gIndex[s] = this.gIndex[last]; this.gTarget[s] = this.gTarget[last];
      this.gK[s] = this.gK[last]; this.gC[s] = this.gC[last]; this.gMax[s] = this.gMax[last]; this.gActive[s] = this.gActive[last]; this.gVhand[s] = this.gVhand[last];
      this.gIdToSlot.set(this.gActive[s], s);
    }
  }

  wakeDof(code, i) {
    switch (code) {
      case DOF_KEY: this.wakeKey(i); break;
      case DOF_BAR: this.action.wake(i); break;
      case DOF_CARRIAGE: this.escAwake = true; this.escSleep = 0; break;
      case DOF_PLATEN: this.platenAwake = true; this.platenSleep = 0; break;
      case DOF_LSLEVER: this.platenAwake = true; this.platenSleep = 0; break;
      case DOF_AUX: this.aAwake[i] = 1; this.aSleep[i] = 0; break;
    }
  }

  dofPosition(code, i) {
    switch (code) {
      case DOF_KEY: return this.kx[i];
      case DOF_BAR: return this.action.position(i);
      case DOF_CARRIAGE: return this.carriageX();
      case DOF_PLATEN: return this.psi;
      case DOF_LSLEVER: return this.ll;
      case DOF_AUX: return this.ax[i];
    }
    return 0;
  }
  dofInertia(code, i) {
    switch (code) {
      case DOF_KEY: return this.keyMass;
      case DOF_BAR: return this.action.J ? this.action.J[i] : 1e-5;
      case DOF_CARRIAGE: return this.mCar;
      case DOF_PLATEN: return this.psiJ;
      case DOF_LSLEVER: return this.lsJ;
      case DOF_AUX: return this.auxParams[i].J;
    }
    return 1;
  }

  dofVelocity(code, i) {
    switch (code) {
      case DOF_KEY: return this.kv[i];
      case DOF_BAR: return this.action.velocity(i);
      case DOF_CARRIAGE: return this.q0Sign * this.qV;
      case DOF_PLATEN: return this.psiV;
      case DOF_LSLEVER: return this.llV;
      case DOF_AUX: return this.av[i];
    }
    return 0;
  }

  // ---- step -----------------------------------------------------------------------
  /** Advance one 384 kHz substep. */
  step() {
    const h = this.h;
    this.t += h;
    const ports = this.ports;

    // Grabs: virtual spring-damper on a DOF, clamped to maxF. Target in the DOF's units.
    for (let gi = 0; gi < this.nGrabs; gi++) {
      const code = this.gDof[gi], idx = this.gIndex[gi];
      const pos = this.dofPosition(code, idx), vel = this.dofVelocity(code, idx);
      let f = this.gK[gi] * (this.gTarget[gi] - pos) - this.gC[gi] * vel;
      const max = this.gMax[gi];
      if (f > max) f = max; else if (f < -max) f = -max;
      // A hand cannot push faster than it can move: the force fades to nothing at twice its top speed.
      {
        const vH = this.gVhand[gi], along = f > 0 ? vel : -vel;
        if (along > vH) f *= along > 2 * vH ? 0 : 2 - along / vH;
      }
      this.workExt += f * vel * h;
      this.wakeDof(code, idx);
      switch (code) {
        case DOF_KEY: this.kF[idx] += f; break;
        case DOF_BAR: this.action.grabForce(idx, f); break;
        case DOF_CARRIAGE: this.cF += this.q0Sign * f; break;
        case DOF_PLATEN: this.psiT += f; break;
        case DOF_LSLEVER: this.llT += f; break;
        case DOF_AUX: this.aF[idx] += f; break;
      }
    }

    if (this.action.nPhantom) this.action.playPhantoms(ports);

    // Fingers
    for (let fi = 0; fi < this.nFingers; fi++) {
      const k = this.fKey[fi];
      const age = this.t - this.fT0[fi];
      const dur = this.fDur[fi], att = this.fAttack, rel = this.fRelease;
      let a;
      if (age < att) { const s = age / att; a = s * s * (3 - 2 * s); }
      else if (age < dur) a = 1;
      else if (age < dur + rel) { const s = (age - dur) / rel; a = 1 - s * s * (3 - 2 * s); }
      else { this.fKey[fi] = this.fKey[--this.nFingers]; this.fT0[fi] = this.fT0[this.nFingers]; this.fPeak[fi] = this.fPeak[this.nFingers]; this.fDur[fi] = this.fDur[this.nFingers]; fi--; continue; }
      const v = this.kv[k], Vm = this.fVmax, b = this.fHillB;
      // Hill force-velocity: full force stationary (bottom-out), zero at fingertip speed Vm.
      const y = v / Vm;
      let hill;
      if (y >= 1) hill = 0; else if (y >= 0) hill = (1 - y) / (1 + b * y); else hill = 1;
      const F = this.fPeak[fi] * a * hill;
      this.kF[k] += F;
      this.workExt += F * v * h;
      this.wakeKey(k);
    }

    if ((++this.guardTick & 255) === 0) this.guard();
    this.stepKeys(h);
    if (this.escAwake) this.stepEsc(h);
    if (this.shiftAwake) this.stepShift(h);
    if (this.platenAwake) this.stepPlaten(h);
    if (this.bellAwake) this.stepBell(h);
    if (this.vibrAwake) this.stepVibrator(h);
    this.stepAux(h);
    this.action.step(h);
  }

  /** Last resort: if a value is ever not finite, return that element to rest instead of poisoning the sim. */
  guard() {
    const bad = (x) => !(x - x === 0);
    let tripped = false;
    for (let k = 0; k < this.nKeys; k++) if (bad(this.kx[k]) || bad(this.kv[k]) || bad(this.kF[k])) { this.kx[k] = 0; this.kv[k] = 0; this.kF[k] = 0; tripped = true; }
    if (bad(this.q) || bad(this.qV)) { this.q = 0; this.qV = 0; this.cZ = 0; tripped = true; }
    if (bad(this.psi) || bad(this.psiV)) { this.psi = 0; this.psiV = 0; tripped = true; }
    if (bad(this.ll) || bad(this.llV)) { this.ll = 0; this.llV = 0; tripped = true; }
    if (bad(this.u) || bad(this.uV) || bad(this.yf) || bad(this.yfV) || bad(this.yl) || bad(this.ylV) || bad(this.sl) || bad(this.slV) || bad(this.shiftY) || bad(this.shiftV) || bad(this.hammer) || bad(this.hammerV) || bad(this.vibr) || bad(this.vibrV) || bad(this.rp) || bad(this.rpV)) {
      this.u = 0; this.uV = 0; this.yf = this.yBot; this.yfV = 0; this.yl = this.camLoose(0); this.ylV = 0; this.sl = 0; this.slV = 0;
      this.shiftY = 0; this.shiftV = 0; this.hammer = 0; this.hammerV = 0; this.vibr = 0; this.vibrV = 0; this.rp = 0; this.rpV = 0;
      tripped = true;
    }
    for (let i = 0; i < AUX_N; i++) if (bad(this.ax[i]) || bad(this.av[i])) { this.ax[i] = 0; this.av[i] = 0; tripped = true; }
    if (this.action.guard()) tripped = true;
    if (tripped) this.guardTrips = (this.guardTrips | 0) + 1;
  }

  stepKeys(h) {
    const list = this.kActive;
    let n = this.nActiveK;
    const kx = this.kx, kv = this.kv, kF = this.kF;
    const mass = this.keyMass, kF0 = this.kFelt, cF0 = this.cFelt, retRate = this.keyRetRate;
    const action = this.action;
    const ports = this.ports;
    for (let ii = 0; ii < n; ii++) {
      const k = list[ii];
      const x = kx[k], v = kv[k], Tr = this.kTravel[k], type = this.kType[k];
      let F = kF[k];
      kF[k] = 0;
      // Return spring (always returns toward 0). Zero rate/preload beyond the top stop.
      if (x > 0) F -= this.kRet0[k] + retRate * x;
      // Sliding friction of the key lever and link pivots (regularised Coulomb)
      F -= this.keyCoulomb * (v > 0.01 ? 1 : v < -0.01 ? -1 : v / 0.01);
      // Felt stops, top (x<0) and bottom (x>travel)
      if (x < 0) {
        let Ff = -kF0 * x - cF0 * v;
        if (Ff < 0) Ff = 0;
        F += Ff; ports[PORT.FELT] += Ff;
        if (!this.keyTop[k]) { this.keyTop[k] = 1; this.ac(AC.KEY_TOP, k, -v); }
      } else if (x > Tr) {
        let Ff = kF0 * (x - Tr) + cF0 * v;
        if (Ff < 0) Ff = 0;
        F -= Ff; ports[PORT.FELT] += Ff;
        if (!this.keyBot[k]) { this.keyBot[k] = 1; this.ac(AC.KEY_BOTTOM, k, v); }
      }
      if (x < 0.7 * Tr) this.keyBot[k] = 0;   // re-arm clear of the felt: a bounce on it is not a new landing
      if (x > 0.02 * Tr) this.keyTop[k] = 0;
      if (this.unlimited && (type === KEY_PRINT || k === this.spaceK)) {   // a key driven by hand rather than pressKey
        if (x < 0.3 * Tr) this.kEdge[k] = 1;
        else if (x > 0.6 * Tr && this.kEdge[k]) {
          this.kEdge[k] = 0;
          if (this.kSkip[k]) this.kSkip[k] = 0; else this.unlimitedKeystroke(k, 34);
        }
      }
      // Coupling to the mechanism
      switch (type) {
        case KEY_PRINT: {
          F += action.keyForce(k, x, v);
          F += this.ubarContact(k, x, v);
          F += this.vibratorContact(k, x, v);
          break;
        }
        case KEY_SPACE: F += this.ubarContact(k, x, v); break;
        case KEY_SHIFT: F += this.shiftContact(k, x, v, 0); break;
        case KEY_LOCK: F += this.shiftContact(k, x, v, 1); break;
        case KEY_BACKSPACE: F += this.backspaceContact(k, x, v); break;
        case KEY_MARGIN: break;
      }
      let vn = v + (F / mass) * h;
      if (vn > V_KEY) vn = V_KEY; else if (vn < -V_KEY) vn = -V_KEY;
      kv[k] = vn;
      kx[k] = x + vn * h;
      const hasGrab = this.grabOn(DOF_KEY, k);
      if (!hasGrab && (vn < 1e-3 && vn > -1e-3) && x < 3e-5 && x > -3e-4 && !this.hasFinger(k)) {
        if (++this.kSleep[k] > SLEEP_FRAMES) {
          this.kAwake[k] = 0; kv[k] = 0;
          list[ii] = list[--n];
          ii--;
        }
      } else this.kSleep[k] = 0;
    }
    this.nActiveK = n;
  }

  hasFinger(k) { for (let i = 0; i < this.nFingers; i++) if (this.fKey[i] === k) return true; return false; }
  grabOn(code, idx) {
    for (let i = 0; i < this.nGrabs; i++) if (this.gDof[i] === code && this.gIndex[i] === idx) return true;
    return false;
  }

  ubarContact(k, x, v) {
    const Tr = this.kTravel[k];
    const xTrip = this.tripFrac * Tr;
    if (x <= xTrip) return 0;
    const ratio = this.uFull / ((1 - this.tripFrac) * Tr);
    const pen = (x - xTrip) * ratio - this.u;
    if (pen <= 0) return 0;
    let Fc = this.kUbar * pen + this.cUbar * (v * ratio - this.uV);
    if (Fc < 0) Fc = 0;
    this.uF += Fc;
    this.ports[PORT.UBAR] += Fc;
    this.escAwake = true; this.escSleep = 0;
    return -Fc * ratio;
  }

  vibratorContact(k, x, v) {
    const Tr = this.kTravel[k];
    const xs = this.vibrStart * Tr;
    if (x <= xs) return 0;
    const ratio = this.vibrLiftTarget() / ((1 - this.vibrStart) * Tr);
    const pen = (x - xs) * ratio - this.vibr;
    if (pen <= 0) return 0;
    const Fc = this.kVibr * pen;
    this.vibrF += Fc;
    this.vibrAwake = true; this.vibrSleep = 0;
    return -Fc * ratio;
  }

  vibrLiftTarget() {
    // Ribbon selector: 0 = upper band, 1 = lower band (full lift), 2 = stencil (no lift).
    const s = this.ax[AUX.ribbonSelector], pos = this.auxParams[AUX.ribbonSelector].detents;
    if (s <= (pos[0] + pos[1]) / 2) return this.vibrLift * 0.72;
    if (s <= (pos[1] + pos[2]) / 2) return this.vibrLift;
    return 0;
  }

  shiftContact(k, x, v, kind) {
    const Tr = this.kTravel[k];
    const frac = x / Tr;
    this.shiftAwake = true; this.shiftSleep = 0;
    const ratio = this.shiftTravel / Tr;
    let F = 0;
    if (kind === 1) { // shift lock key: latch once fully down
      if (frac > 0.85) this.shiftLatch = 1;
      // latch force is applied to the shift DOF, the key just bottoms on its felt
      return 0;
    }
    // Shift key lever pushes the carriage shift up, one-way, and unlatches it
    if (this.shiftLatch && frac > 0.4) this.shiftLatch = 0;
    const pen = x * ratio - this.shiftY;
    if (pen > 0) {
      let Fc = this.kShiftLink * pen + this.cShiftLink * (v * ratio - this.shiftV);
      if (Fc < 0) Fc = 0;
      this.shiftF += Fc;
      F = -Fc * ratio;
    }
    return F;
  }

  backspaceContact(k, x, v) {
    const Tr = this.kTravel[k];
    const pick = 0.25 * Tr;
    if (x <= pick) { this.kBack = -1; return 0; }
    if (this.kBack < 0) { this.kBack = this.q; this.escAwake = true; this.escSleep = 0; }
    const ratio = 1.12 * this.p / (Tr - pick);
    // At the end of its throw the pawl blocks the rack, so a hard stroke cannot fling the carriage past the next tooth.
    const over = this.kBack - 1.16 * this.p - this.q;
    if (over > 0) {
      const Fs = Math.max(0, 2.5e5 * over - 400 * this.qV);
      this.cF += Fs; this.ports[PORT.DOG] += Fs;
      this.escAwake = true; this.escSleep = 0;
    }
    let pen = (x - pick) * ratio - (this.kBack - this.q);
    if (pen <= 0) return 0;
    // The pawl only ever holds one tooth: if the carriage was pulled away from it, it slips.
    if (pen > 1.3 * this.p) { this.kBack = this.q + (x - pick) * ratio - 0.2 * this.p; pen = 0.2 * this.p; }
    const Fc = 2.5e5 * pen;
    this.cF -= Fc;
    this.escAwake = true; this.escSleep = 0;
    this.ports[PORT.DOG] += Fc;
    return -Fc * ratio;
  }

  camFixed(r) {
    const r0 = this.rFix - 0.28;
    return r <= r0 ? this.yBot : this.yBot + (this.D * 1.08 - this.yBot) * (r - r0) / (this.rFix - r0);
  }
  camLoose(r) {
    const rE = this.rLoose;
    const span = 0.32;
    const lift = (rE + span - r) / span; // >1 above the tip, 0 at engaged depth
    return this.yBot + (this.D * 1.08 - this.yBot) * lift;
  }
  camFixedD(r) { const r0 = this.rFix - 0.28; return r <= r0 ? 0 : (this.D * 1.08 - this.yBot) / (this.rFix - r0); }
  camLooseD() { const span = 0.32; return -(this.D * 1.08 - this.yBot) / span; }

  stepEsc(h) {
    const ports = this.ports;
    // Universal bar and rocker (rocker is a rigid extension of the ubar: r = u / uFull).
    const uFull = this.uFull;
    let r = this.u / uFull;
    if (r > 1.4) r = 1.4;
    let uf = this.uF;
    this.uF = 0;
    uf -= this.uSpring0 + this.uRate * (this.u > 0 ? this.u : 0);
    if (this.u < 0) {
      let Fs = -this.u * 1.2e6 - 300 * this.uV;
      if (Fs < 0) Fs = 0;
      uf += Fs;
      ports[PORT.UBAR] += Fs;
    }
    uf -= 0.6 * this.uV; // light pivot damping
    const camRel = this.ax[AUX.carriageRelease] / this.auxParams[AUX.carriageRelease].hi; // 0..1 lifts dogs clear

    // Fixed dog. Rocker lifts it against its spring; y = height above root.
    let Fyf = -(this.Fdog0 + this.kDogSpring * (this.yf - this.yBot));
    Fyf -= 0.08 * this.yfV;
    if (this.yf < this.yBot) {
      let Fs = this.kDogStop * (this.yBot - this.yf) - 30 * this.yfV;
      if (Fs < 0) Fs = 0;
      Fyf += Fs; ports[PORT.DOG] += Fs;
    }
    const rd = this.unlimited ? 0 : r;   // unlimited typing: the rocker no longer works the dogs
    const rawCamF = this.camFixed(rd), reliefT = this.yBot + (this.D * 1.45 - this.yBot) * camRel;
    const camF = rawCamF > reliefT ? rawCamF : reliefT;
    const penF = camF - this.yf;
    if (penF > 0) {
      let Fc = this.kCam * penF;
      Fyf += Fc;
      if (rawCamF >= reliefT) uf -= (Fc * this.camFixedD(rd)) / uFull;
    }
    // Loose dog: held clear by the rocker cam at rest, moved in as r increases, slides on slack
    let Fyl = -(this.Fdog0 + this.kDogSpring * (this.yl - this.yBot));
    Fyl -= 0.08 * this.ylV;
    if (this.yl < this.yBot) {
      let Fs = this.kDogStop * (this.yBot - this.yl) - 30 * this.ylV;
      if (Fs < 0) Fs = 0;
      Fyl += Fs; ports[PORT.DOG] += Fs;
    }
    const rawCamL = this.camLoose(rd);
    const camL = rawCamL > reliefT ? rawCamL : reliefT;
    const penL = camL - this.yl;
    if (penL > 0) {
      const Fc = this.kCam * penL;
      Fyl += Fc;
      if (rawCamL >= reliefT) uf -= (Fc * this.camLooseD()) / uFull;
    }
    // Slack DOF of the loose dog: spring pulls s back, end stops at 0 and sMax (rocker slot)
    let Fs = -this.kSlack * this.sl - 0.4 * this.slV;
    if (this.sl < 0) { let Fx = this.kSlackStop * -this.sl - 60 * this.slV; if (Fx < 0) Fx = 0; Fs += Fx; ports[PORT.DOG] += Fx; }
    else if (this.sl > this.sMax) { let Fx = this.kSlackStop * (this.sl - this.sMax) + 60 * this.slV; if (Fx < 0) Fx = 0; Fs -= Fx; ports[PORT.DOG] += Fx; }

    // Tooth contacts
    let Fq = this.cF;
    this.cF = 0;
    Fq += this.toothContact(0, this.yf, 0);
    const fy1 = this.toothFy;
    Fq += this.toothContact(this.qLoose + this.sl, this.yl, 1);
    const fy2 = this.toothFy;
    Fs += this.toothFs;
    Fyf += fy1; Fyl += fy2;
    // Integrate ubar and dogs
    const uV = clampMag(this.uV + (uf / this.uMass) * h, V_KEY);
    this.uV = uV; this.u += uV * h;
    this.yfV = clampMag(this.yfV + (Fyf / this.dogMass) * h, V_DOG);
    this.yf += this.yfV * h;
    this.ylV = clampMag(this.ylV + (Fyl / this.dogMass) * h, V_DOG);
    this.yl += this.ylV * h;
    this.slV = clampMag(this.slV + (Fs / this.dogMass) * h, V_DOG);
    this.sl += this.slV * h;
    // Ribbon pawl tracks the rocker through a stiff one-way cam (feed follows the bar)
    {
      const rTarget = (r > 1 ? 1 : r < 0 ? 0 : r) * this.rpFull;
      const pen = rTarget - this.rp;
      let Fp = -this.rpRet * this.rp - 0.6 * this.rpV;
      if (pen > 0) Fp += this.kRp * pen;
      if (this.rp < 0) { Fp -= 3e4 * this.rp + 2 * this.rpV; }
      const v = this.rpV + (Fp / this.rpMass) * h;
      this.rpV = v; this.rp += v * h;
    }

    // Carriage
    const q = this.q, v = this.qV;
    // drawband pulls toward +q (typing direction); wound tighter at line start (small q).
    const xOff = this.xStart + this.q0Sign * q - this.railMin;
    Fq += this.drawF0 + this.drawRate * (xOff > 0 ? xOff : 0);
    // Rail friction (viscous + Dahl bristle so stiction is real, not a discontinuity)
    Fq -= this.railC * v;
    {
      const zs = this.railZs;
      const zDot = v - Math.abs(v) * this.cZ / zs;
      this.cZ += zDot * h;
      if (this.cZ > zs) this.cZ = zs; else if (this.cZ < -zs) this.cZ = -zs;
      // With the release latched open the carriage stays where it is put, standing in for the typist's other hand on it.
      const Fr = (this.railF + this.releaseBrake * camRel) * this.cZ / zs;
      Fq -= Fr;
      ports[PORT.RAIL] += Fr;
    }
    // Rail end stops and margin stops (stop is held by the frame and is one-way)
    const x = this.xStart + this.q0Sign * q;
    let stopF = 0;
    if (x > this.railMax) stopF += -this.q0Sign * this.kStop * (x - this.railMax) - this.cStop * v;
    if (x < this.railMin) stopF += this.q0Sign * this.kStop * (this.railMin - x) - this.cStop * v;
    if (!this.marginReleased()) {
      const xL = this.ax[AUX.marginL], xR = this.ax[AUX.marginR];
      const qL = this.q0Sign * (xL - this.xStart), qR = this.q0Sign * (xR - this.xStart);
      if (q < qL) { let F = this.kStop * (qL - q) - this.cStop * v; if (F < 0) F = 0; stopF += F; }
      if (q > qR) { let F = this.kStop * (q - qR) + this.cStop * v; if (F < 0) F = 0; stopF -= F; }
    }
    if (stopF !== 0) {
      Fq += stopF; ports[PORT.STOP] += Math.abs(stopF);
      if (!this.stopOn) { this.stopOn = true; this.ac(AC.STOP, 0, v < 0 ? -v : v); }
    } else this.stopOn = false;
    // Bell trip finger on the carriage
    this.stepBellTrip();
    Fq += this.bellF; this.bellF = 0;
    Fq += this.llF; this.llF = 0;
    let qVn = v + (Fq / this.mCar) * h;
    if (qVn > V_CAR) qVn = V_CAR; else if (qVn < -V_CAR) qVn = -V_CAR;
    this.qV = qVn; this.q = q + qVn * h;

    // Sleep group when everything is settled
    if ((uV < 1e-4 && uV > -1e-4) && (this.yfV < 1e-3 && this.yfV > -1e-3) && (this.ylV < 1e-3 && this.ylV > -1e-3)
      && (qVn < 3e-6 && qVn > -3e-6) && !this.grabOn(DOF_CARRIAGE, 0)) {
      if (++this.escSleep > SLEEP_FRAMES) {
        this.escAwake = false; this.uV = 0; this.yfV = 0; this.ylV = 0; this.slV = 0; this.qV = 0; this.rpV = 0;
      }
    } else this.escSleep = 0;
  }

  marginReleased() {
    // marginRelease key held past 40% of its travel lifts the margin stops clear
    for (let k = this.nPrint; k < this.nKeys; k++) {
      if (this.kType[k] === KEY_MARGIN && this.kx[k] > 0.4 * this.kTravel[k]) return true;
    }
    return false;
  }

  /** Dog against sawtooth rack. Stores toothFy, toothFs and returns the force on the carriage (+q). */
  toothContact(qDog, y, loose) {
    const ports = this.ports;
    const p = this.p, D = this.D;
    const rho = qDog - this.q;
    let f = rho / p;
    f -= FLOOR(f);
    const S = D * f;
    let Fq = 0, Fy = 0, Fs = 0;
    const qv = this.qV;
    const dogV = loose ? this.ylV : this.yfV;
    const penWall = (1 - f) * p;
    let wall = false;
    if (f > 0.5 && y < S) {
      // Inside the tooth, on the side where the face holds the carriage. Choose the surface it is nearest
      // to escape from, so a dog landing near the tip rides the ramp but a seated dog is on the face.
      const gRamp = (S - y) / this.rampNorm;
      if (gRamp >= penWall) wall = true;
    }
    if (wall) {
      const k = this.kTooth;
      let Fw = k * penWall + this.cTooth * qv;
      if (Fw < 0) Fw = 0;
      Fq = -Fw;
      if (loose) {
        // The light slack dog is damped against its relative motion separately, or it chatters at 17 kHz.
        let FwS = k * penWall + 150 * (qv - this.slV);
        if (FwS < 0) FwS = 0;
        Fs = FwS;
      }
      ports[PORT.DOG] += Fw;
    } else {
      const g = S - y;
      if (g > 0) {
        // Ramp: normal force lifts the dog and resists the carriage returning
        let Fn = this.kRamp * g - this.cRamp * (dogV + this.toothRamp * qv);
        if (Fn < 0) Fn = 0;
        Fy = Fn;
        Fq = Fn * this.toothRamp;
        Fs = loose ? -Fn * this.toothRamp : 0;
        ports[PORT.DOG] += Fn;
      }
    }
    this.toothFy = Fy; this.toothFs = Fs;
    return Fq;
  }

  stepBellTrip() {
    const q = this.q;
    const qR = this.q0Sign * (this.ax[AUX.marginR] - this.xStart);
    const qT = qR - this.bellRing;
    const w = this.bellCamW;
    if (q < qT - 0.002) { this.bellArmed = true; return; }
    if (this.bellArmed && q >= qT && q <= qT + w) {
      const cam = (q - qT) / w * this.bellCam;
      const pen = cam - this.hammer;
      if (pen > 0) {
        const T = this.bellCamK * pen;
        this.hammerT += T;
        this.bellF -= T * this.bellCam / w;
        this.bellAwake = true; this.bellSleep = 0;
      }
    } else if (this.bellArmed && q > qT + w) {
      // Finger has passed; the hammer is released and free. Stays disarmed until the carriage returns.
      this.bellArmed = false;
    }
  }

  stepBell(h) {
    const ports = this.ports;
    let T = this.hammerT;
    this.hammerT = 0;
    const th = this.hammer, w = this.hammerV;
    T -= this.hammerSpring * th + this.bellDamp * w;
    if (this.bellFlick > 0) { this.bellFlick = th < 0.9 * this.bellCam ? this.bellFlick - h : 0; T += this.bellCamK * Math.max(0, this.bellCam - th); }
    const g = this.bellGap;
    const pen = (-th - g) * this.bellR;
    if (pen > 0) {
      // Hunt-Crossley hammer-bell contact (Hertz exponent 3/2)
      const vc = -w * this.bellR;
      const sq = Math.sqrt(pen);
      let F = this.bellK * pen * sq * (1 + this.bellAlpha * vc);
      if (F < 0) F = 0;
      T += F * this.bellR;
      ports[PORT.BELL] += F;
      if (F > this.bellPeak) this.bellPeak = F;
      this.bellContact = true;
    } else if (this.bellContact) {
      this.bellContact = false;
      this.emitEvent({ type: 'bell', peakForce: this.bellPeak, carriageX: this.carriageX() });
      this.ac(AC.BELL, 0, this.bellPeak);
      this.bellPeak = 0;
    }
    const wN = clampMag(w + (T / this.hammerJ) * h, V_HAMMER);
    this.hammerV = wN; this.hammer = th + wN * h;
    if (wN < 2e-3 && wN > -2e-3 && th < 2e-3 && th > -2e-3) {
      if (++this.bellSleep > SLEEP_FRAMES) { this.bellAwake = false; this.hammerV = 0; }
    } else this.bellSleep = 0;
  }

  stepShift(h) {
    const ports = this.ports;
    let F = this.shiftF;
    this.shiftF = 0;
    F -= this.shiftF0 + this.shiftRate * (this.shiftY > 0 ? this.shiftY : 0);
    F -= 18 * this.shiftV;
    if (this.shiftLatch && this.shiftY < this.shiftTravel) {
      const Fl = 3e5 * (this.shiftTravel - this.shiftY);
      F += Fl;
    }
    if (this.shiftY > 0.2 * this.shiftTravel && this.shiftY < 0.8 * this.shiftTravel) this.shiftStop = 0;   // re-arms only clear of the stops: a bounce is not a new landing
    else if (this.shiftY < 0 && this.shiftStop !== 1) { this.shiftStop = 1; this.ac(AC.SHIFT_UP, 0, -this.shiftV); }
    else if (this.shiftY > this.shiftTravel && this.shiftStop !== 2) { this.shiftStop = 2; this.ac(AC.SHIFT_DOWN, 0, this.shiftV); }
    if (this.shiftY < 0) { let Fs = -this.kStop * this.shiftY - this.cStop * this.shiftV; if (Fs < 0) Fs = 0; F += Fs; ports[PORT.STOP] += Fs; }
    if (this.shiftY > this.shiftTravel) { let Fs = this.kStop * (this.shiftY - this.shiftTravel) + this.cStop * this.shiftV; if (Fs < 0) Fs = 0; F -= Fs; ports[PORT.STOP] += Fs; }
    const v = clampMag(this.shiftV + (F / this.mCar) * h, SHIFT_V);
    this.shiftV = v; this.shiftY += v * h;
    if ((v < 1e-5 && v > -1e-5) && (this.shiftY < 1e-5 || this.shiftLatch)) {
      if (++this.shiftSleep > SLEEP_FRAMES) { this.shiftAwake = false; this.shiftV = 0; }
    } else this.shiftSleep = 0;
  }

  stepPlaten(h) {
    const ports = this.ports;
    let T = this.psiT, TL = this.llT;
    this.psiT = 0; this.llT = 0;
    const psi = this.psi, w = this.psiV, l = this.ll, lv = this.llV;
    // Line-space lever
    TL -= this.lsSpring0 + this.lsRate * (l > 0 ? l : 0);
    TL -= this.lsDamp * lv;
    if (l < 0) {
      let Ts = -this.lsKStop * l - this.lsCStop * lv;
      if (Ts < 0) Ts = 0;
      TL += Ts; ports[PORT.PAWL] += Ts * 40;
    }
    // Pawl on the platen ratchet: picks up a tooth at lsPick, indexes `teeth` until lsEnd
    const pick = this.lsPick, end = this.lsEnd;
    const setting = (this.lineSpaceSetting | 0) || 1;
    const teeth = this.teeth[Math.min(this.teeth.length - 1, Math.max(0, setting - 1))] ?? 1;
    if (l < this.lsRearm) this.pawlArmed = true;
    if (l > pick && (this.pawlEngaged || this.pawlArmed)) {
      if (!this.pawlEngaged) { this.pawlEngaged = true; this.pawlArmed = false; this.ac(AC.LS_PICK, 0, lv); this.pawl0 = Math.round(psi / this.ratchet) * this.ratchet; this.lineTeeth = teeth; }
      const R = (this.lineTeeth * this.ratchet) / (end - pick);
      const drive = Math.min(l - pick, end - pick) * R;
      let pen = drive - (psi - this.pawl0);
      // The pawl sits against one ratchet tooth; if the platen has been spun off that tooth it ratchets
      // to the nearest one instead of winding up an arbitrary angle.
      if (pen > 1.2 * this.ratchet) {
        const lose = Math.ceil((pen - 0.5 * this.ratchet) / this.ratchet);
        this.pawl0 -= lose * this.ratchet;
        pen -= lose * this.ratchet;
      }
      if (pen > 0) {
        let Tp = this.kPawl * pen + this.cPawl * ((l - pick < end - pick ? lv * R : 0) - w);
        if (Tp < 0) Tp = 0;
        if (Tp > this.pawlMaxT) Tp = this.pawlMaxT;
        T += Tp;
        TL -= Tp * R;
        ports[PORT.PAWL] += Tp * 30;
      }
      // Overthrow stop at the end of the pawl stroke: a thrown platen cannot coast past the set line space.
      const over = psi - (this.pawl0 + this.lineTeeth * this.ratchet);
      if (over > 0) {
        let To = this.kOver * over + this.cOver * w;
        if (To < 0) To = 0;
        T -= To;
        ports[PORT.PAWL] += Math.min(To, this.pawlMaxT) * 30;
      }
    } else if (this.pawlEngaged) this.pawlEngaged = false;
    // Lever limit: the stop is on the carriage, so the reaction pushes the carriage back (return)
    if (l > this.lsTravel) {
      const pen = l - this.lsTravel;
      let Ts = this.lsKStop * pen + this.lsCStop * lv;
      if (Ts < 0) Ts = 0;
      TL -= Ts;
      const Fq = Ts / this.lsLeverLen;
      this.llF -= Fq;
      this.workExt += -Fq * this.qV * h;   // the hand's work reaches the carriage through the lever stop
      this.escAwake = true; this.escSleep = 0;
      ports[PORT.STOP] += Fq;
    }
    // Platen detent potential and bearing
    T -= this.detT * Math.sin(this.detN * psi);
    T -= this.psiV0 * w;
    const satw = w > 0.2 ? 1 : w < -0.2 ? -1 : w / 0.2;
    T -= this.psiC0 * satw;
    let wN = w + (T / this.psiJ) * h;
    if (wN > V_PSI) wN = V_PSI; else if (wN < -V_PSI) wN = -V_PSI;
    this.psiV = wN; this.psi = psi + wN * h;
    let lvN = lv + (TL / this.lsJ) * h;
    if (lvN > V_LL) lvN = V_LL; else if (lvN < -V_LL) lvN = -V_LL;
    this.llV = lvN; this.ll = l + lvN * h;
    if ((wN < 2e-3 && wN > -2e-3) && (lvN < 2e-3 && lvN > -2e-3) && !this.grabOn(DOF_PLATEN, 0) && !this.grabOn(DOF_LSLEVER, 0)) {
      if (++this.platenSleep > SLEEP_FRAMES) { this.platenAwake = false; this.psiV = 0; this.llV = 0; }
    } else this.platenSleep = 0;
  }

  stepVibrator(h) {
    let F = this.vibrF;
    this.vibrF = 0;
    F -= this.vibrSpring0 + this.vibrRate * (this.vibr > 0 ? this.vibr : 0);
    F -= 0.8 * this.vibrV;
    if (this.vibr < 0) { let Fs = -2e5 * this.vibr - 40 * this.vibrV; if (Fs < 0) Fs = 0; F += Fs; }
    const lift = this.vibrLift;
    if (this.vibr > lift) { let Fs = 2e5 * (this.vibr - lift) + 40 * this.vibrV; if (Fs < 0) Fs = 0; F -= Fs; }
    const v = clampMag(this.vibrV + (F / this.vibrMass) * h, V_DOG);
    this.vibrV = v; this.vibr += v * h;
    if ((v < 2e-4 && v > -2e-4) && this.vibr < 5e-5) {
      if (++this.vibrSleep > SLEEP_FRAMES) { this.vibrAwake = false; this.vibrV = 0; }
    } else this.vibrSleep = 0;
  }

  stepAux(h) {
    for (let i = 0; i < AUX_N; i++) {
      if (!this.aAwake[i]) continue;
      const p = this.auxParams[i];
      const pos = this.ax[i], v = this.av[i];
      let F = this.aF[i];
      this.aF[i] = 0;
      if (p.spring0 || p.rate) F -= p.spring0 + p.rate * Math.max(pos - p.lo, 0);
      F -= p.visc * v;
      const vs = (p.hi - p.lo) * 0.02;
      const sat = v > vs ? 1 : v < -vs ? -1 : v / vs;
      F -= p.coul * sat;
      if (p.detents) {
        let dBest = 1e9, dT = 0;
        const dets = p.detents;
        for (let j = 0; j < dets.length; j++) {
          const d = dets[j] - pos, a = d < 0 ? -d : d;
          if (a < dBest) { dBest = a; dT = d; }
        }
        // A detent spring toward the nearest notch
        const span = dets.length > 1 ? Math.abs(dets[1] - dets[0]) : 0.3;
        F += p.detentT * Math.sin(Math.max(-1, Math.min(1, dT / (span / 2))) * Math.PI) * 1.0;
      }
      if (pos < p.lo) { let Fs = p.kStop * (p.lo - pos) - p.cStop * v; if (Fs < 0) Fs = 0; F += Fs; }
      if (pos > p.hi) { let Fs = p.kStop * (pos - p.hi) + p.cStop * v; if (Fs < 0) Fs = 0; F -= Fs; }
      const vN = clampMag(v + (F / p.J) * h, i === AUX.marginL || i === AUX.marginR ? 3 : V_AUX);
      this.av[i] = vN;
      this.ax[i] = pos + vN * h;
      const thr = (p.hi - p.lo) * 1e-3;
      if ((vN < thr && vN > -thr) && !this.grabOn(DOF_AUX, i) && Math.abs(F) < p.J * 200) {
        if (++this.aSleep[i] > SLEEP_FRAMES) { this.aAwake[i] = 0; this.av[i] = 0; }
      } else this.aSleep[i] = 0;
    }
  }

  // ---- events and snapshot -------------------------------------------------------
  emitEvent(e) { this.events.push(e); }
  /** Queue an acoustic event for the audio thread (drained every audio sample, no allocation). */
  ac(t, a, b) { const n = this.acN; if (n < 256) { const q = this.acQ; q[n * 3] = t; q[n * 3 + 1] = a; q[n * 3 + 2] = b; this.acN = n + 1; } }
  drainEvents(out) { for (const e of this.events) out.push(e); this.events.length = 0; }

  writeSnapshot(s) {
    const L = this.layout;
    s[L.time] = this.t;
    for (let k = 0; k < this.nKeys; k++) { s[L.keyX + k] = this.kx[k]; s[L.keyV + k] = this.kv[k]; }
    this.action.snapshot(s, L);
    s[L.ubar] = this.u; s[L.rocker] = this.u / this.uFull;
    s[L.dogFixedR] = this.yf; s[L.dogLooseR] = this.yl; s[L.dogLooseS] = this.sl;
    s[L.carriageX] = this.carriageX(); s[L.carriageV] = this.q0Sign * this.qV;
    const xOff = this.xStart + this.q0Sign * this.q - this.railMin;
    s[L.mainspringN] = this.drawF0 + this.drawRate * Math.max(xOff, 0);
    s[L.carriageRelease] = this.ax[AUX.carriageRelease];
    s[L.shiftY] = this.shiftY; s[L.shiftLock] = this.shiftLatch;
    s[L.platenPsi] = this.psi; s[L.platenOmega] = this.psiV; s[L.lsLever] = this.ll;
    s[L.lsPawl] = this.pawlEngaged ? this.psi - this.pawl0 : 0;
    s[L.lineSpaceSetting] = this.lineSpaceSetting;
    s[L.bellHammer] = this.hammer;
    s[L.marginL] = this.ax[AUX.marginL]; s[L.marginR] = this.ax[AUX.marginR];
    s[L.vibratorLift] = this.vibr; s[L.ribbonPawlTravel] = this.rp; s[L.ribbonSelector] = this.ax[AUX.ribbonSelector];
    s[L.paperRelease] = this.ax[AUX.paperRelease]; s[L.bail] = this.ax[AUX.bail];
    s[L.lastForce] = this.lastForce;
  }

  // ---- state transfer (LocalHost -> worklet) ---------------------------------------
  exportState() {
    const scalarKeys = ['t','u','uV','yf','yfV','yl','ylV','sl','slV','q','qV','cZ','shiftY','shiftV','shiftLatch','psi','psiV','ll','llV','pawlEngaged','pawlArmed','pawl0','lineTeeth','lineSpaceSetting','hammer','hammerV','bellArmed','vibr','vibrV','rp','rpV','kBack'];
    const s = {};
    for (const k of scalarKeys) s[k] = this[k];
    s.kx = this.kx.slice(); s.kv = this.kv.slice();
    s.ax = this.ax.slice(); s.av = this.av.slice();
    s.action = this.action.exportState();
    s.env = { ...this.env };
    return s;
  }

  importState(s) {
    for (const k of Object.keys(s)) if (typeof s[k] === 'number' || typeof s[k] === 'boolean') this[k] = s[k];
    this.kx.set(s.kx); this.kv.set(s.kv); this.ax.set(s.ax); this.av.set(s.av);
    this.action.importState(s.action);
    Object.assign(this.env, s.env); this.setEnvDerived();
    // Wake whatever is not at rest
    this.escAwake = true; this.escSleep = 0;
    this.platenAwake = true; this.bellAwake = true; this.vibrAwake = true; this.shiftAwake = true;
    for (let k = 0; k < this.nKeys; k++) if (Math.abs(this.kx[k]) > 1e-5 || this.kv[k] !== 0) this.wakeKey(k);
    for (let i = 0; i < AUX_N; i++) if (this.av[i] !== 0) this.aAwake[i] = 1;
  }

  // ---- energy, for tests -------------------------------------------------------------
  energy() {
    let E = 0;
    const kFelt = this.kFelt;
    for (let k = 0; k < this.nKeys; k++) {
      const x = this.kx[k], v = this.kv[k], Tr = this.kTravel[k];
      E += 0.5 * this.keyMass * v * v;
      if (x > 0) E += this.kRet0[k] * x + 0.5 * this.keyRetRate * x * x;
      if (x < 0) E += 0.5 * kFelt * x * x; else if (x > Tr) E += 0.5 * kFelt * (x - Tr) ** 2;
      if (this.kType[k] === KEY_PRINT) E += this.action.linkEnergy(k, x);
      // ubar contact potential
      const xTrip = this.tripFrac * Tr;
      if ((this.kType[k] === KEY_PRINT || this.kType[k] === KEY_SPACE) && x > xTrip) {
        const ratio = this.uFull / ((1 - this.tripFrac) * Tr);
        const pen = (x - xTrip) * ratio - this.u;
        if (pen > 0) E += 0.5 * this.kUbar * pen * pen;
      }
    }
    const r = this.u / this.uFull, yBot = this.yBot;
    E += 0.5 * this.uMass * this.uV * this.uV + this.uSpring0 * Math.max(this.u, 0) + 0.5 * this.uRate * Math.max(this.u, 0) ** 2;
    if (this.u < 0) E += 0.5 * 1.2e6 * this.u * this.u;
    E += 0.5 * this.dogMass * (this.yfV * this.yfV + this.ylV * this.ylV + this.slV * this.slV);
    E += this.Fdog0 * (this.yf - yBot) + 0.5 * this.kDogSpring * (this.yf - yBot) ** 2;
    E += this.Fdog0 * (this.yl - yBot) + 0.5 * this.kDogSpring * (this.yl - yBot) ** 2;
    if (this.yf < yBot) E += 0.5 * this.kDogStop * (yBot - this.yf) ** 2;
    if (this.yl < yBot) E += 0.5 * this.kDogStop * (yBot - this.yl) ** 2;
    const camRelE = this.ax[AUX.carriageRelease] / this.auxParams[AUX.carriageRelease].hi;
    const reliefE = this.yBot + (this.D * 1.45 - this.yBot) * camRelE;
    const pf = Math.max(this.camFixed(r), reliefE) - this.yf, pl2 = Math.max(this.camLoose(r), reliefE) - this.yl;
    if (pf > 0) E += 0.5 * this.kCam * pf * pf;
    if (pl2 > 0) E += 0.5 * this.kCam * pl2 * pl2;
    E += 0.5 * this.kSlack * this.sl * this.sl;
    if (this.sl > this.sMax) E += 0.5 * this.kSlackStop * (this.sl - this.sMax) ** 2;
    if (this.sl < 0) E += 0.5 * this.kSlackStop * this.sl * this.sl;
    E += this.toothPotential(0, this.yf) + this.toothPotential(this.qLoose + this.sl, this.yl);
    // Carriage
    E += 0.5 * this.mCar * this.qV * this.qV;
    const xOff = this.xStart + this.q0Sign * this.q - this.railMin;
    if (xOff > 0) E += this.drawF0 * xOff + 0.5 * this.drawRate * xOff * xOff;
    E += 0.5 * ((this.railF + this.releaseBrake * camRelE) / this.railZs) * this.cZ * this.cZ;
    const x = this.carriageX();
    if (x > this.railMax) E += 0.5 * this.kStop * (x - this.railMax) ** 2;
    if (x < this.railMin) E += 0.5 * this.kStop * (this.railMin - x) ** 2;
    if (!this.marginReleased()) {
      const qL = this.q0Sign * (this.ax[AUX.marginL] - this.xStart), qR = this.q0Sign * (this.ax[AUX.marginR] - this.xStart);
      if (this.q < qL) E += 0.5 * this.kStop * (qL - this.q) ** 2;
      if (this.q > qR) E += 0.5 * this.kStop * (this.q - qR) ** 2;
    }
    // Shift
    E += 0.5 * this.mCar * this.shiftV * this.shiftV + this.shiftF0 * Math.max(this.shiftY, 0) + 0.5 * this.shiftRate * Math.max(this.shiftY, 0) ** 2;
    if (this.shiftY < 0) E += 0.5 * this.kStop * this.shiftY ** 2;
    if (this.shiftY > this.shiftTravel) E += 0.5 * this.kStop * (this.shiftY - this.shiftTravel) ** 2;
    // Platen and lever
    const l = this.ll;
    E += 0.5 * this.psiJ * this.psiV * this.psiV + 0.5 * this.lsJ * this.llV * this.llV;
    E += (this.detT / this.detN) * (1 - Math.cos(this.detN * this.psi));
    E += this.lsSpring0 * Math.max(l, 0) + 0.5 * this.lsRate * Math.max(l, 0) ** 2;
    if (l < 0) E += 0.5 * this.lsKStop * l * l; else if (l > this.lsTravel) E += 0.5 * this.lsKStop * (l - this.lsTravel) ** 2;
    if (this.pawlEngaged) {
      const R = (this.lineTeeth * this.ratchet) / (this.lsEnd - this.lsPick);
      const drive = Math.min(l - this.lsPick, this.lsEnd - this.lsPick) * R;
      const pen = drive - (this.psi - this.pawl0);
      if (pen > 0) E += 0.5 * this.kPawl * pen * pen;
      const over = this.psi - (this.pawl0 + this.lineTeeth * this.ratchet);
      if (over > 0) E += 0.5 * this.kOver * over * over;
    }
    // Bell hammer
    const J = this.hammerJ, th = this.hammer;
    E += 0.5 * J * this.hammerV * this.hammerV + 0.5 * this.hammerSpring * th * th;
    const pen = (-th - this.bellGap) * this.bellR;
    if (pen > 0) E += this.bellK * Math.pow(pen, 2.5) * 0.4;
    // Vibrator (and ribbon pawl)
    E += 0.5 * this.vibrMass * this.vibrV * this.vibrV + this.vibrSpring0 * Math.max(this.vibr, 0) + 0.5 * this.vibrRate * Math.max(this.vibr, 0) ** 2;
    if (this.vibr > this.vibrLift) E += 0.5 * 2e5 * (this.vibr - this.vibrLift) ** 2;
    if (this.vibr < 0) E += 0.5 * 2e5 * this.vibr ** 2;
    E += 0.5 * this.rpMass * this.rpV * this.rpV + 0.5 * this.rpRet * this.rp * this.rp;
    if (this.rp < 0) E += 0.5 * 3e4 * this.rp ** 2;
    // Aux levers
    for (let i = 0; i < AUX_N; i++) {
      const p = this.auxParams[i], pos = this.ax[i];
      E += 0.5 * p.J * this.av[i] ** 2 + p.spring0 * Math.max(pos - p.lo, 0) + 0.5 * p.rate * Math.max(pos - p.lo, 0) ** 2;
      if (pos < p.lo) E += 0.5 * p.kStop * (p.lo - pos) ** 2;
      if (pos > p.hi) E += 0.5 * p.kStop * (pos - p.hi) ** 2;
    }
    E += this.action.energy();
    return E;
  }

  toothPotential(qDog, y) {
    const p = this.p, D = this.D;
    const rho = qDog - this.q;
    let f = rho / p;
    f -= FLOOR(f);
    const S = D * f;
    const penWall = (1 - f) * p;
    if (f > 0.5 && y < S) {
      const gRamp = (S - y) / this.rampNorm;
      if (gRamp >= penWall) return 0.5 * this.kTooth * penWall * penWall;
    }
    const g = S - y;
    if (g > 0) return 0.5 * this.kRamp * g * g;
    return 0;
  }
}

function clampMag(v, m) { return v > m ? m : v < -m ? -m : v; }
function finiteOr(v, d) { return Number.isFinite(v) ? v : d; }
function clampFinite(v, lo, hi) { return !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v; }

function dofCode(dof) {
  switch (dof) {
    case 'key': return DOF_KEY;
    case 'bar': return DOF_BAR;
    case 'carriage': return DOF_CARRIAGE;
    case 'platen': return DOF_PLATEN;
    case 'lsLever': return DOF_LSLEVER;
    case 'paperRelease': case 'carriageRelease': case 'bail':
    case 'marginL': case 'marginR': case 'ribbonSelector': return DOF_AUX;
  }
  return -1;
}

function grabDefaults(dof) {
  // Virtual coupling: stiff enough to track a hand, soft enough that omega*dt << 2. hardMax is the most a
  // hand or finger can exert on that part (N or N m); vHand is the top speed of a hand on it (m/s or rad/s).
  switch (dof) {
    case 'key': return { k: 2500, c: 8, maxF: 60, hardMax: 120, vHand: 1.6 };
    case 'bar': return { k: 6, c: 0.05, maxF: 4, hardMax: 6, vHand: 25 };
    case 'carriage': return { k: 2500, c: 40, maxF: 90, hardMax: 160, vHand: 2.5 };
    case 'platen': return { k: 12, c: 0.06, maxF: 1.5, hardMax: 4, vHand: 22 };   // a knob spun hard by the fingers
    case 'lsLever': return { k: 18, c: 0.08, maxF: 10, hardMax: 12, vHand: 14 };  // lever torque up to the hand
    case 'paperRelease': case 'bail': case 'carriageRelease': return { k: 2, c: 0.03, maxF: 0.8, hardMax: 2, vHand: 16 };
    case 'ribbonSelector': return { k: 1.2, c: 0.02, maxF: 0.6, hardMax: 1.5, vHand: 16 };
    case 'marginL': case 'marginR': return { k: 3000, c: 40, maxF: 40, hardMax: 80, vHand: 1.5 };
  }
  return { k: 100, c: 2, maxF: 10, hardMax: 20, vHand: 5 };
}
