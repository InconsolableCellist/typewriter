// The printwheel printer's mechanism (architecture.md 6.1): every DOF integrated from forces at the host's substep.
// Wheel on a three-phase VR stepper with a viscous inertia damper; carrier on a leadscrew through a sprung follower;
// platen turned through a timing belt by the index stepper; hammer armature thrown by its coil into a petal, and the
// petal's face into ribbon, paper and platen through the existing face tables (Hunt-Crossley); ribbon stepper with
// its feed and lift cam; paper-handling cam motor with its followers; access cover; panel keys; power rocker; fan.
// The controller (printer-ctl.js) reaches this only through `io`: phase commands, coil currents, the cam motor's
// voltage, and sensors. Nothing here decides anything.
import { buildFaceTables, FACE_TABLE_N } from '../faces.js';
import { Stepper2Phase, StepperVR3 } from './stepper.js';
import { WP_PORT, WAC } from './ports.js';

const TWO_PI = 2 * Math.PI;
const SLEEP_FRAMES = 384;
const TRACE_LEN = 256, TRACE_DECIM = 4;
const sat = (x, x0) => (x > x0 ? 1 : x < -x0 ? -1 : x / x0);
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const dsmooth = (u) => (u <= 0 || u >= 1 ? 0 : 6 * u * (1 - u));

export class PrinterMech {
  /** sim: the host (t, h, env, ports, emitEvent, ac); def: machine.printer; geo: geometry.printer. */
  constructor(sim, def, geo, glyphs) {
    this.sim = sim; this.def = def; this.geo = geo; this.glyphs = glyphs;
    this.screw = new Stepper2Phase(def.carrier);
    this.sel = new StepperVR3({ ...def.wheel, peakTorque: def.selection.peakTorque, tauE: def.selection.tauE });
    this.idx = new Stepper2Phase(def.index);
    this.rib = new Stepper2Phase(def.ribbonFeed);
    this.irq = null;           // the controller's sensor interrupts, set by the host
    this.derive(true);
    this.reset();
  }

  /** Constants derived from the definition (again after setParam); faces: rebuild the face tables too. */
  derive(faces) {
    const d = this.def;
    if (faces) this.faces = buildFaceTables(d, this.geo, this.glyphs);
    this.screw.setParams(d.carrier); this.idx.setParams(d.index); this.rib.setParams(d.ribbonFeed);
    this.sel.setParams({ ...d.wheel, peakTorque: d.selection.peakTorque, tauE: d.selection.tauE });
    const C = d.carrier;
    this.leadR = C.lead / TWO_PI;                 // m of follower travel per rad of screw
    this.halfStep = this.screw.step / 2;          // encoder resolution: two edges per step
    const W = d.wheel;
    this.nPetals = W.petals; this.tipR = W.tipRadius;
    this.pickDiv = W.pickupDivisions;
    const H = d.hammer;
    this.mA = H.armatureMass; this.mP = W.petal.mass;
    this.alpha = d.platen.huntCrossleyAlpha;
    const R = d.ribbonFeed;
    this.feedPerRad = R.feedPerStep / this.rib.step;
    this.liftPerRad = TWO_PI / (R.lift.stepsPerRev * this.rib.step);   // cam radians per motor radian
    const K = d.cam;
    this.camStep = TWO_PI / K.positions;
  }

  reset() {
    this.screw.th = 0; this.screw.w = 0;
    this.xc = this.def.carrier.home; this.vc = 0;
    this.carrierAwake = false; this.carrierSleep = 0; this.enc = 0; this.stopOn = false;
    this.sel.th = 0; this.sel.w = 0; this.wd = 0; this.wheelAwake = false; this.wheelSleep = 0; this.pick = 0;
    this.xp = new Float64Array(this.nPetals); this.vp = new Float64Array(this.nPetals);
    this.petalAwake = new Uint8Array(this.nPetals); this.petalList = [];
    this.xa = 0; this.va = 0; this.coil = 0; this.coilCmd = 0; this.hammerAwake = false; this.hammerSleep = 0;
    this.onStop = true; this.rebound = false; this.petalPush = 0; this.pushPetal = -1; this.engaged = -1;
    this.contact = false; this.contactF = 0; this.cPetal = 0; this.tBegin = 0; this.vIn = 0; this.peakF = 0; this.maxD = 0;
    this.peakX = 0; this.peakPsi = 0; this.peakLift = 0; this.selErr = 0;
    this.traceF = new Float32Array(TRACE_LEN); this.traceD = new Float32Array(TRACE_LEN); this.traceN = 0; this.traceC = 0;
    this.strikes = 0;
    this.idx.th = 0; this.idx.w = 0; this.psi = 0; this.psiV = 0; this.indexAwake = false; this.indexSleep = 0;
    this.rib.th = 0; this.rib.w = 0; this.lift = this.liftProfile(0); this.liftV = 0; this.ribbonAwake = false; this.ribbonSleep = 0;
    this.camTh = 0; this.camW = 0; this.camVolts = 0; this.camAwake = false; this.camSleep = 0;
    this.rel = 0; this.relV = 0; this.bail = 0; this.bailV = 0;
    this.cover = 0; this.coverV = 0; this.coverAwake = false; this.coverSleep = 0; this.coverSeated = true;
    const nK = this.def.panel.keys.length;
    this.kx = new Float64Array(nK); this.kv = new Float64Array(nK); this.kF = new Float64Array(nK); this.kAwake = new Uint8Array(nK); this.kSleep = new Int32Array(nK); this.kBot = new Uint8Array(nK);
    this.power = this.def.power.travel; this.powerV = 0; this.powerAwake = false; this.powerSleep = 0;
    this.fan = 0;
    this.F = { ribbon: 0, cover: 0, power: 0 };   // hand forces gathered for this substep
  }

  // ---- what the controller may touch --------------------------------------------------------------------------
  /** The actuators. Each wakes the body it drives. */
  setCarrier(state, amp) { if (state !== this.screw.state || amp !== this.screw.amp) { this.screw.command(state, amp); this.wake('carrier'); } }
  setWheel(phase, amp) { if (phase !== this.sel.phase || amp !== this.sel.amp) { this.sel.command(phase, amp); this.wake('wheel'); } }
  setIndex(state, amp) { if (state !== this.idx.state || amp !== this.idx.amp) { this.idx.command(state, amp); this.wake('index'); } }
  setRibbon(state, amp) { if (state !== this.rib.state || amp !== this.rib.amp) { this.rib.command(state, amp); this.wake('ribbon'); } }
  setHammer(amps) {
    if (amps === this.coilCmd) return;
    if (amps > 0) this.rebound = false;
    this.coilCmd = amps; this.wake('hammer');
  }
  setCam(volts) { if (volts !== this.camVolts) { this.camVolts = volts; this.wake('cam'); } }

  /** Sensors. */
  encoder() { return this.enc; }                                  // half steps of the escapement motor (A02 encoder)
  pickup() { return this.pick; }                                  // wheel rotor in 1/pickupDivisions steps
  wheelSpeed() { return this.sel.w / this.sel.step; }            // the pickups' EMF goes with speed: steps/s
  wheelHome() {                                                   // fourth reluctance pickup: lowercase a in line
    const r = this.sel.th / this.sel.step;
    const m = ((r % this.nPetals) + this.nPetals) % this.nPetals;
    return m < 0.25 || m > this.nPetals - 0.25;
  }
  hammerSense() { return this.va; }                               // sense-coil voltage is proportional to speed
  camReeds() {
    const a = (((this.camTh / this.def.cam.ratio) % TWO_PI) + TWO_PI) % TWO_PI;
    const k = Math.round(a / this.camStep), off = Math.abs(a - k * this.camStep), on = off < this.def.cam.reedWindow;
    return { home: on && k % this.def.cam.positions === 0, pos: on && k % this.def.cam.positions !== 0 };
  }
  coverClosed() { return this.cover < this.def.cover.interlockAngle; }
  panelKey(i) { return this.kx[i] > this.def.panel.make * this.def.panel.travel; }
  powered() { return this.power > 0.5 * this.def.power.travel; }
  ribbonLeft() { return this.def.ribbon.length - this.rib.th * this.feedPerRad; }
  paperAtSensor() { const v = this.sim.env.paperEdgeV; return v !== undefined && v >= 0; }   // the sensor is on the frame, not the carrier

  // ---- position of the print point --------------------------------------------------------------------------
  carriageX() { return -this.xc; }
  ribbonFed() { return this.rib.th * this.feedPerRad; }

  wake(group) {
    switch (group) {
      case 'carrier': this.carrierAwake = true; this.carrierSleep = 0; break;
      case 'wheel': this.wheelAwake = true; this.wheelSleep = 0; break;
      case 'hammer': this.hammerAwake = true; this.hammerSleep = 0; break;
      case 'index': this.indexAwake = true; this.indexSleep = 0; break;
      case 'ribbon': this.ribbonAwake = true; this.ribbonSleep = 0; break;
      case 'cam': this.camAwake = true; this.camSleep = 0; break;
      case 'cover': this.coverAwake = true; this.coverSleep = 0; break;
      case 'power': this.powerAwake = true; this.powerSleep = 0; break;
    }
  }

  wakePetal(p) { if (!this.petalAwake[p]) { this.petalAwake[p] = 1; this.petalList.push(p); } }

  /** Grabbable DOFs, registered with the host's Inputs. */
  registerDofs(inputs) {
    const d = this.def;
    inputs.register('panelKey', {
      n: this.kx.length, pos: (i) => this.kx[i], vel: (i) => this.kv[i], inertia: () => d.panel.mass,
      apply: (i, f) => { this.kF[i] += f; }, wake: (i) => { this.kAwake[i] = 1; this.kSleep[i] = 0; },
      k: 2500, c: 8, maxF: 12, hardMax: 30, vHand: 1.2,
    });
    inputs.register('printerCover', {
      n: 1, pos: () => this.cover, vel: () => this.coverV, inertia: () => d.cover.inertia,
      apply: (i, f) => { this.F.cover += f; }, wake: () => this.wake('cover'),
      k: 40, c: 0.5, maxF: 8, hardMax: 15, vHand: 6,
    });
    inputs.register('printerPower', {
      n: 1, pos: () => this.power, vel: () => this.powerV, inertia: () => d.power.inertia,
      apply: (i, f) => { this.F.power += f; }, wake: () => this.wake('power'),
      k: 2, c: 0.02, maxF: 0.4, hardMax: 1, vHand: 12,
    });
    inputs.register('ribbonKnob', {
      n: 1, pos: () => this.rib.th, vel: () => this.rib.w, inertia: () => d.ribbonFeed.rotorInertia,
      apply: (i, f) => { this.F.ribbon += f; }, wake: () => this.wake('ribbon'),
      k: 0.05, c: 2e-4, maxF: 0.05, hardMax: 0.1, vHand: 30,
    });
  }

  // ---- step ----------------------------------------------------------------------------------------------------
  step(h) {
    const P = this.sim.ports;
    if (this.carrierAwake) this.stepCarrier(h, P);
    if (this.wheelAwake || this.contact) this.stepWheel(h, P);
    if (this.hammerAwake) this.stepHammer(h, P);
    if (this.petalList.length) this.stepPetals(h);
    if (this.indexAwake) this.stepIndex(h, P);
    if (this.ribbonAwake) this.stepRibbon(h, P);
    if (this.camAwake) this.stepCam(h, P);
    if (this.coverAwake) this.stepCover(h, P);
    this.stepPanel(h, P);
    if (this.powerAwake) this.stepPower(h);
    this.stepFan(h);
  }

  stepCarrier(h, P) {
    const C = this.def.carrier, s = this.screw;
    // Follower: two sprung halves on the screw thread, a spring and damper between nut and carrier.
    const xs = C.home + s.th * this.leadR, vs = s.w * this.leadR;
    const Ff = C.followerStiffness * (xs - this.xc) + C.followerDamping * (vs - this.vc);
    P[WP_PORT.FOLLOWER] += Ff < 0 ? -Ff : Ff;
    s.integrate(h, -Ff * this.leadR);
    const F = Ff - C.railViscous * this.vc - C.railCoulomb * sat(this.vc, 0.002);
    const [xL, xR] = C.stops;
    let Fs = 0;
    if (this.xc < xL) Fs = Math.max(0, C.stopStiffness * (xL - this.xc) - C.stopDamping * this.vc);
    else if (this.xc > xR) Fs = Math.min(0, -C.stopStiffness * (this.xc - xR) - C.stopDamping * this.vc);
    if (Fs !== 0) {
      if (!this.stopOn) { this.stopOn = true; this.sim.ac(WAC.CARRIER_STOP, 0, Math.abs(this.vc)); }
      P[WP_PORT.CARRIER_STOP] += Math.abs(Fs);
    } else this.stopOn = false;
    this.vc += ((F + Fs) / C.mass) * h;
    this.xc += this.vc * h;
    const e = Math.floor(s.th / this.halfStep);
    if (e !== this.enc) { this.enc = e; this.irq?.encoder(this.sim.t, e); }
    if (s.still() && Math.abs(this.vc) < 1e-5) {
      if (++this.carrierSleep > SLEEP_FRAMES) { this.carrierAwake = false; s.w = 0; this.vc = 0; }
    } else this.carrierSleep = 0;
  }

  stepWheel(h, P) {
    const W = this.def.wheel, s = this.sel;
    // Viscous inertia damper on the shaft: a ring dragged through silicone, which only acts while the speed changes.
    const Td = W.damper.viscous * (this.wd - s.w);
    this.wd -= (Td / W.damper.inertia) * h;
    // A petal held against the paper drags the wheel by friction at its tip.
    let Tf = 0;
    if (this.contact && this.contactF > 0) Tf = -W.petalFriction * this.contactF * this.tipR * sat(s.w, 0.5);
    s.integrate(h, Td + Tf);
    P[WP_PORT.WHEEL] += Math.abs(s.torque());
    this.pick = Math.round((s.th / s.step) * this.pickDiv);
    if (s.still() && Math.abs(this.wd) < 1e-4 && !this.contact) {
      if (++this.wheelSleep > SLEEP_FRAMES) { this.wheelAwake = false; s.w = 0; this.wd = 0; }
    } else this.wheelSleep = 0;
  }

  /** The petal in line with the hammer, and how far off line it sits (rad). */
  petalUnderHammer() {
    const r = this.sel.th / this.sel.step, k = Math.round(r);
    return { petal: ((k % this.nPetals) + this.nPetals) % this.nPetals, err: (r - k) * this.sel.step };
  }

  stackCaliper() {
    const e = this.sim.env;
    return (e.paperPresent ? e.paperCaliperM : 0) + (e.ribbonInGap ? e.ribbonCaliperM : 0);
  }

  stepHammer(h, P) {
    const H = this.def.hammer, W = this.def.wheel;
    // Coil: a current-regulated drive rises with tauOn and decays through the clamp with tauOff.
    this.coil += (this.coilCmd - this.coil) * (h / (this.coilCmd > this.coil ? H.tauOn : H.tauOff));
    if (this.coilCmd === 0 && this.coil < 1e-6) this.coil = 0;
    const x = this.xa, v = this.va;
    let F = H.forceConstant * this.coil - (H.returnSpring + H.returnRate * (x > 0 ? x : 0));
    if (x < 0) {
      const Fs = Math.max(0, -H.backstopStiffness * x - H.backstopDamping * v);
      F += Fs; P[WP_PORT.ARMATURE] += Fs;
      if (!this.onStop) { this.onStop = true; this.sim.ac(WAC.BACKSTOP, 0, -v); }
    } else if (x > 2e-5) this.onStop = false;
    const over = x - (H.freeTravel + H.petalTravel + H.overtravel);
    if (over > 0) F -= Math.max(0, H.backstopStiffness * over + H.backstopDamping * v);
    // The nose catches the back of the petal in line as it comes up to it from behind. A petal turned sideways into
    // a nose that is already forward is not caught: the controller only turns the wheel with the hammer home.
    const { petal, err } = this.petalUnderHammer();
    const inLine = Math.abs(err) * this.tipR < W.noseHalfWidth;
    if (this.engaged < 0 && inLine) {
      const pen = x - H.freeTravel - this.xp[petal];
      if (pen > 0 && pen < H.catchDepth && v > this.vp[petal]) this.engaged = petal;
    }
    if (this.engaged >= 0) {
      const p = this.engaged, pen = x - H.freeTravel - this.xp[p];
      if (pen <= 0 || p !== petal || !inLine) this.engaged = -1;
      else {
        const Fc = Math.max(0, H.pickupStiffness * pen + H.pickupDamping * (v - this.vp[p]));
        F -= Fc; this.petalPush = Fc; this.pushPetal = p;
        P[WP_PORT.ARMATURE] += Fc;
        this.wakePetal(p);
      }
    }
    this.va = v + (F / this.mA) * h;
    this.xa = x + this.va * h;
    if (!this.rebound && this.va < -H.reboundSpeed) { this.rebound = true; this.irq?.rebound(this.sim.t); }
    if (this.coil === 0 && Math.abs(this.va) < 1e-4 && x < 0 && x > -2e-5) {
      if (++this.hammerSleep > SLEEP_FRAMES) { this.hammerAwake = false; this.va = 0; }
    } else this.hammerSleep = 0;
  }

  stepPetals(h) {
    const W = this.def.wheel, P = this.sim.ports;
    const gap = this.def.hammer.petalTravel - this.stackCaliper();
    const list = this.petalList, line = this.petalUnderHammer();
    for (let n = 0; n < list.length; n++) {
      const p = list[n];
      const x = this.xp[p], v = this.vp[p];
      let F = -W.petal.stiffness * x - W.petal.damping * v;
      if (this.pushPetal === p) { F += this.petalPush; this.petalPush = 0; this.pushPetal = -1; }
      // Only the petal at the top of the wheel faces the platen.
      const delta = p === line.petal && Math.abs(line.err) * this.tipR < W.noseHalfWidth ? x - gap : -1;
      if (delta > 0) {
        if (!this.contact) this.beginContact(p, v);
        if (p === this.cPetal) {
          const faces = this.faces, TN = FACE_TABLE_N, ti = delta / faces.dd;
          const j = ti >= TN - 1 ? TN - 2 : ti | 0, frac = ti - j, base = p * 2 * TN + j;
          let Fe = faces.force[base] + (faces.force[base + 1] - faces.force[base]) * frac;
          if (ti > TN - 1) Fe = faces.force[base + 1] + (faces.force[base + 1] - faces.force[base]) * (ti - TN + 1);
          let Fc = Fe * (1 + this.alpha * v);
          if (Fc < 0) Fc = 0;
          F -= Fc;
          this.contactF = Fc;
          P[WP_PORT.HAMMER] += Fc;
          this.sim.lastForce = Fc;
          if (Fc > this.peakF) { this.peakF = Fc; this.peakX = this.carriageX(); this.peakPsi = this.psi; this.peakLift = this.lift; }
          if (delta > this.maxD) this.maxD = delta;
          const c = this.traceC++;
          if (c % TRACE_DECIM === 0 && this.traceN < TRACE_LEN) { this.traceF[this.traceN] = Fc; this.traceD[this.traceN] = delta; this.traceN++; }
        }
      } else if (this.contact && p === this.cPetal) this.endContact(v);
      this.vp[p] = v + (F / this.mP) * h;
      this.xp[p] = x + this.vp[p] * h;
      if (Math.abs(this.xp[p]) < 1e-7 && Math.abs(this.vp[p]) < 1e-5 && !(this.contact && p === this.cPetal)) {
        this.vp[p] = 0; this.petalAwake[p] = 0; list.splice(n--, 1);
      }
    }
  }

  beginContact(p, v) {
    this.contact = true; this.cPetal = p; this.contactF = 0;
    this.tBegin = this.sim.t; this.vIn = v; this.peakF = 0; this.maxD = 0; this.traceN = 0; this.traceC = 0;
    const u = this.petalUnderHammer();
    this.selErr = u.petal === p ? u.err : 0;
    this.wake('wheel');
    this.irq?.impact(this.sim.t);
  }

  endContact(v) {
    this.contact = false; this.contactF = 0;
    const sim = this.sim;
    if (this.peakF < 1e-3) return;
    this.strikes++;
    sim.ac(WAC.STRIKE, this.cPetal, this.peakF);
    const faces = this.faces, table = this.cPetal * 2 * FACE_TABLE_N;
    const area = faces.area[table + Math.min(FACE_TABLE_N - 1, (this.maxD / faces.dd) | 0)];
    sim.emitEvent({
      type: 'strike', bar: this.cPetal, caseIndex: 0,
      tBegin: this.tBegin, duration: sim.t - this.tBegin,
      carriageX: this.peakX, platenPsi: this.peakPsi, shiftY: 0,
      lateral: this.selErr * this.tipR, vImpact: this.vIn, peakForce: this.peakF,
      maxIndent: this.maxD, restitution: this.vIn !== 0 ? Math.abs(v / this.vIn) : 0,
      skewRad: 0, vibratorLift: this.peakLift, ribbonInGap: sim.env.ribbonInGap ? 1 : 0,
      peakPressure: faces.kf * this.maxD, meanPressure: area > 0 ? this.peakF / area : 0, contactArea: area,
      selectionError: this.selErr,
      trace: { dt: sim.h * TRACE_DECIM, force: this.traceF.slice(0, this.traceN), indent: this.traceD.slice(0, this.traceN) },
    });
  }

  stepIndex(h, P) {
    const I = this.def.index, pl = this.def.platen, s = this.idx, n = I.beltRatio;
    const Tb = I.beltStiffness * (s.th / n - this.psi) + I.beltDamping * (s.w / n - this.psiV);
    P[WP_PORT.INDEX] += Math.abs(Tb);
    s.integrate(h, -Tb / n);
    const drag = pl.bearingCoulomb + (this.sim.env.paperPresent ? pl.paperDrag : 0);
    const T = Tb - pl.bearingViscous * this.psiV - drag * sat(this.psiV, 0.02);
    this.psiV += (T / pl.inertia) * h;
    this.psi += this.psiV * h;
    if (s.still() && Math.abs(this.psiV) < 1e-4 && Math.abs(s.th / n - this.psi) < 1e-6) {
      if (++this.indexSleep > SLEEP_FRAMES) { this.indexAwake = false; s.w = 0; this.psiV = 0; }
    } else this.indexSleep = 0;
  }

  /** Lift cam: three dwells a turn (one per track), each rise taking the ribbon up a track, then a drop to the first. */
  liftProfile(phi) {
    const L = this.def.ribbonFeed.lift, u = (((phi / TWO_PI) % 1) + 1) % 1;
    const third = Math.floor(u * 3), f = u * 3 - third;
    const rise = smooth((f - (1 - L.transition)) / L.transition);
    return L.trackPitch * (third === 2 ? 2 * (1 - rise) : third + rise);
  }
  liftSlope(phi) {
    const L = this.def.ribbonFeed.lift, u = (((phi / TWO_PI) % 1) + 1) % 1;
    const third = Math.floor(u * 3), f = u * 3 - third;
    const d = (dsmooth((f - (1 - L.transition)) / L.transition) * 3) / (L.transition * TWO_PI);
    return L.trackPitch * (third === 2 ? -2 * d : d);
  }

  stepRibbon(h, P) {
    const R = this.def.ribbonFeed, L = R.lift, s = this.rib;
    const phi = s.th * this.liftPerRad;
    // Follower spring holds the lift arm on its cam; a stiff one-way contact, reacted on the motor shaft.
    let F = -(L.spring + L.rate * this.lift) - L.damping * this.liftV;
    const pen = this.liftProfile(phi) - this.lift;
    let Tload = this.F.ribbon - R.filmDrag * s.w;
    this.F.ribbon = 0;
    if (pen > 0) {
      const Fc = L.camStiffness * pen;
      F += Fc; P[WP_PORT.RIBBON] += Fc;
      Tload -= Fc * this.liftSlope(phi) * this.liftPerRad;
    }
    s.integrate(h, Tload);
    this.liftV += (F / L.mass) * h;
    this.lift += this.liftV * h;
    if (s.still() && Math.abs(this.liftV) < 1e-5) {
      if (++this.ribbonSleep > SLEEP_FRAMES) { this.ribbonAwake = false; s.w = 0; this.liftV = 0; }
    } else this.ribbonSleep = 0;
  }

  /** Follower lift of the paper-handling cam at cam angle a, and its slope, from the per-position table. */
  camProfile(a, table) {
    const K = this.def.cam, n = K.positions, st = this.camStep;
    const u = ((a % TWO_PI) + TWO_PI) % TWO_PI / st, k = Math.floor(u), f = u - k;
    const y0 = table[k % n], y1 = table[(k + 1) % n];
    const t = (f - K.dwell) / (1 - 2 * K.dwell);
    return [y0 + (y1 - y0) * smooth(t), ((y1 - y0) * dsmooth(t)) / ((1 - 2 * K.dwell) * st)];
  }

  stepCam(h, P) {
    const K = this.def.cam, M = K.motor;
    const a = this.camTh / K.ratio;
    // Followers: the feed-roll rocker (paperRelease) and the bail, each sprung onto its cam track.
    let Tcam = 0;
    for (const [key, vKey, Fp] of [['rel', 'relV', K.release], ['bail', 'bailV', K.bail]]) {
      const [y, dy] = this.camProfile(a, Fp.table);
      let T = -(Fp.spring + Fp.rate * this[key]) - Fp.damping * this[vKey];
      const pen = y - this[key];
      if (pen > 0) { const Tc = Fp.camStiffness * pen; T += Tc; Tcam += Tc * dy; P[WP_PORT.CAM] += Tc; }
      this[vKey] += (T / Fp.inertia) * h;
      this[key] += this[vKey] * h;
    }
    // DC motor through a self-locking worm: the followers load it only while it drives, and never drive it back.
    // Switched off, its terminals are shorted, so the back EMF brakes it.
    const i = (this.camVolts - M.ke * this.camW) / M.resistance;
    const dir = this.camVolts !== 0 ? Math.sign(this.camVolts) : Math.sign(this.camW);
    const load = (Tcam / K.ratio) * dir > 0 ? (-Tcam / K.ratio) / K.efficiency : 0;
    const T = M.kt * i + load - M.viscous * this.camW - (M.coulomb + K.wormLock * (this.camVolts === 0 ? 1 : 0)) * sat(this.camW, 0.5);
    this.camW += (T / M.inertia) * h;
    this.camTh += this.camW * h;
    if (this.camVolts === 0 && Math.abs(this.camW) < 1e-3 && Math.abs(this.relV) < 1e-4 && Math.abs(this.bailV) < 1e-4) {
      if (++this.camSleep > SLEEP_FRAMES) { this.camAwake = false; this.camW = 0; this.relV = 0; this.bailV = 0; }
    } else this.camSleep = 0;
  }

  stepCover(h, P) {
    const C = this.def.cover, a = this.cover, w = this.coverV;
    // Gravity closes it, the magnet holds it on its seat, the hinge rubs; the hand opens it.
    let T = this.F.cover - C.gravityTorque * Math.cos(a) - C.viscous * w - C.coulomb * sat(w, 0.05);
    this.F.cover = 0;
    if (a < C.latchAngle) T -= C.latchTorque * (1 - a / C.latchAngle);
    if (a < 0) { const Ts = Math.max(0, -C.stopStiffness * a - C.stopDamping * w); T += Ts; P[WP_PORT.COVER] += Ts; }
    if (a > C.open) T -= Math.max(0, C.stopStiffness * (a - C.open) + C.stopDamping * w);
    const seated = a < 1e-3;
    if (seated !== this.coverSeated) { this.coverSeated = seated; this.sim.ac(WAC.COVER, seated ? 0 : 1, Math.abs(w)); }
    this.coverV = w + (T / C.inertia) * h;
    this.cover = a + this.coverV * h;
    if (Math.abs(this.coverV) < 1e-4 && a < 1e-4) {
      if (++this.coverSleep > SLEEP_FRAMES) { this.coverAwake = false; this.coverV = 0; }
    } else this.coverSleep = 0;
  }

  stepPanel(h, P) {
    const K = this.def.panel;
    for (let i = 0; i < this.kx.length; i++) {
      if (!this.kAwake[i]) continue;
      const x = this.kx[i], v = this.kv[i];
      let F = this.kF[i] - (K.spring + K.rate * (x > 0 ? x : 0)) - K.viscous * v;
      this.kF[i] = 0;
      if (x < 0) { const Fs = Math.max(0, -K.stopStiffness * x - K.stopDamping * v); F += Fs; P[WP_PORT.PANEL] += Fs; }
      if (x > K.travel) {
        const Fs = Math.max(0, K.stopStiffness * (x - K.travel) + K.stopDamping * v); F -= Fs; P[WP_PORT.PANEL] += Fs;
        if (!this.kBot[i]) { this.kBot[i] = 1; this.sim.ac(WAC.PANEL_KEY, i, v); }
      } else if (x < 0.7 * K.travel) this.kBot[i] = 0;
      this.kv[i] = v + (F / K.mass) * h;
      this.kx[i] = x + this.kv[i] * h;
      if (Math.abs(this.kv[i]) < 1e-4 && x < 1e-5 && x > -1e-4) {
        if (++this.kSleep[i] > SLEEP_FRAMES) { this.kAwake[i] = 0; this.kv[i] = 0; }
      } else this.kSleep[i] = 0;
    }
  }

  stepPower(h) {
    const R = this.def.power, a = this.power, w = this.powerV;
    // Over-centre spring: two stable ends, a hump between them.
    let T = this.F.power - R.snapTorque * Math.sin((TWO_PI * a) / R.travel) - R.viscous * w;
    this.F.power = 0;
    if (a < 0) T += Math.max(0, -R.stopStiffness * a - R.stopDamping * w);
    if (a > R.travel) T -= Math.max(0, R.stopStiffness * (a - R.travel) + R.stopDamping * w);
    this.powerV = w + (T / R.inertia) * h;
    this.power = a + this.powerV * h;
    if (Math.abs(this.powerV) < 1e-3 && (a < 1e-3 || Math.abs(a - R.travel) < 1e-3)) {
      if (++this.powerSleep > SLEEP_FRAMES) { this.powerAwake = false; this.powerV = 0; }
    } else this.powerSleep = 0;
  }

  stepFan(h) {
    const F = this.def.fan;
    const on = this.powered();
    if (!on && this.fan === 0) return;
    // Shaded-pole motor on the line: torque falls to zero at synchronous speed; air drag goes with speed squared.
    const T = (on ? F.stallTorque * (1 - this.fan / F.syncOmega) : 0) - F.drag * this.fan * this.fan - F.coulomb * sat(this.fan, 1);
    this.fan += (T / F.inertia) * h;
    if (!on && this.fan < 0.05) this.fan = 0;
  }

  // ---- state transfer ----------------------------------------------------------------------------------------
  // Sleep flags and counters travel too: a body asleep in one copy and integrating in the other would drift apart.
  exportState() {
    const keys = ['xc', 'vc', 'enc', 'stopOn', 'wd', 'pick', 'xa', 'va', 'coil', 'coilCmd', 'onStop', 'rebound', 'petalPush', 'pushPetal', 'engaged', 'contact', 'contactF', 'cPetal', 'tBegin', 'vIn', 'peakF', 'maxD',
      'peakX', 'peakPsi', 'peakLift', 'selErr', 'traceN', 'traceC', 'strikes', 'psi', 'psiV', 'lift', 'liftV', 'camTh', 'camW', 'camVolts', 'rel', 'relV', 'bail', 'bailV',
      'cover', 'coverV', 'coverSeated', 'power', 'powerV', 'fan'];
    for (const g of ['carrier', 'wheel', 'hammer', 'index', 'ribbon', 'cam', 'cover', 'power']) keys.push(g + 'Awake', g + 'Sleep');
    const s = {};
    for (const k of keys) s[k] = this[k];
    Object.assign(s, {
      screw: this.screw.exportState(), sel: this.sel.exportState(), idx: this.idx.exportState(), rib: this.rib.exportState(),
      xp: this.xp.slice(), vp: this.vp.slice(), petalList: this.petalList.slice(),
      traceF: this.traceF.slice(), traceD: this.traceD.slice(), kx: this.kx.slice(), kv: this.kv.slice(), kBot: this.kBot.slice(),
      kAwake: this.kAwake.slice(), kSleep: this.kSleep.slice(),
    });
    return s;
  }

  importState(s) {
    for (const k of Object.keys(s)) if (typeof s[k] === 'number' || typeof s[k] === 'boolean') this[k] = s[k];
    this.screw.importState(s.screw); this.sel.importState(s.sel); this.idx.importState(s.idx); this.rib.importState(s.rib);
    this.xp.set(s.xp); this.vp.set(s.vp); this.traceF.set(s.traceF); this.traceD.set(s.traceD);
    this.kx.set(s.kx); this.kv.set(s.kv); this.kBot.set(s.kBot); this.kAwake.set(s.kAwake); this.kSleep.set(s.kSleep);
    this.petalAwake.fill(0); this.petalList = [];
    for (const p of s.petalList) this.wakePetal(p);
  }
}
