// The diskette unit's two drives (architecture.md 8.3; HW 3): every DOF integrated from forces at the host's substep.
// Per drive: the AC motor, always running while the station is powered, turns the hub through a belt; the collet,
// driven from the lever through the actuator rod and flat spring, clamps the diskette to the hub by friction, so the
// diskette spins up because the hub drags it; the head carriage rides a steel band on a stepper with a stop pin
// behind track 00; the head-load solenoid pulls the bail and the arm presses the pad and diskette onto the head;
// the diskette slides in its guide against friction and an end stop, and the lever cannot sweep through it.
// The adapter (diskette-ctl.js) reaches this only through `io`: phase commands, the solenoid, and sensors (the index
// phototransistor, the lever switch, the media-type LED, and the read channel's ID fields). Sector bytes never come
// here: an ID field carries the address of the sector passing under the head, nothing else.
import { clone } from '../clone.js';
import { Stepper2Phase } from './stepper.js';
import { WP_PORT, WAC } from './ports.js';

const TWO_PI = 2 * Math.PI;
const SLEEP_FRAMES = 384;
const sat = (x, x0) => (x > x0 ? 1 : x < -x0 ? -1 : x / x0);

export class DisketteMech {
  /** sim: the host (t, ports, ac); def: machine.diskettes. */
  constructor(sim, def, { warm = true } = {}) {
    this.sim = sim; this.def = def;
    this.irq = null;           // the adapter's sensor interrupts, set by the host
    this.powered = true;       // the station's power: the motors run whenever it is on (HW 3.5)
    this.st = [0, 1].map(() => new Stepper2Phase(this.stepperParams()));
    this.derive();
    this.drives = [0, 1].map(() => this.blank());
    if (warm) for (const d of this.drives) this.steady(d);
  }

  stepperParams() {
    const H = this.def.head;
    return { ...H, rotorInertia: H.rotorInertia + H.carriageMass * H.pulleyRadius ** 2 };
  }

  /** Constants derived from the definition (again after setParam). */
  derive() {
    const D = this.def;
    for (const s of this.st) s.setParams(this.stepperParams());
    this.wNominal = (D.rpm / 60) * TWO_PI;
    this.fanB = D.motor.fanTorqueAtSync / D.motor.syncOmega ** 2;
    this.rh = D.motor.pulleyRadius * D.belt.ratio;          // hub pulley radius
    const S = D.slide;
    this.home = S.length + S.leverPlane + S.homeClearance;   // leading-edge depth with the diskette home
    this.trap = S.length + S.leverPlane + S.leverClearance;  // shallower than this, the diskette spans the lever's plane
    this.kappa = Math.PI / 2 / D.clamp.peakAngle;
    for (const d of this.drives ?? []) this.wakeSpin(d);
  }

  /** One drive with an empty slot, its lever open and its motor at rest. */
  blank() {
    return {
      media: null,                                     // { mediaId, type } of the diskette in the guide
      s: 0, sv: 0, slideAwake: false, slideSleep: 0, slideHome: false, Fs: 0,
      a: 0, av: 0, leverAwake: false, leverSleep: 0, leverEnd: 0, leverSwitch: false, Fl: 0,
      N: 0, z: 0, Tc: 0,
      wm: 0, e: 0, wh: 0, hubAngle: 0, wd: 0, phi: 0,
      y: 0, yv: 0, coil: 0, coilCmd: 0, armAwake: false, armSleep: 0, landed: false, pad: 0,
      headAwake: true, headSleep: 0, onStop: false, sec: -1, readable: false, spinAwake: true, spinSleep: 0,
    };
  }

  // ---- what the kit and the warm start may do ----------------------------------------------------------------
  /**
   * A diskette enters the guide at the slot's mouth, or (media null) one at the mouth is taken away. This is the hand
   * putting it there; from then on it moves only by forces. Returns false when that cannot happen.
   */
  setMedia(i, media) {
    const d = this.drives[i];
    if (media) {
      if (d.media) return false;
      d.media = { mediaId: media.mediaId, type: media.type };
      d.s = 0; d.sv = 0; d.wd = 0; d.phi = 0; d.z = 0;
      this.wakeSlide(d); this.wakeSpin(d);
      return true;
    }
    if (!d.media || d.s > this.def.slide.leverPlane) return false;
    d.media = null; d.s = 0; d.sv = 0; d.wd = 0;
    this.wakeSpin(d);
    return true;
  }

  /** Warm start: a diskette home, the lever closed and the diskette turning with the hub (architecture decision 9). */
  load(i, media) {
    const d = this.drives[i];
    d.media = { mediaId: media.mediaId, type: media.type };
    d.s = this.home; d.sv = 0; d.slideHome = true;
    d.a = this.def.lever.closed; d.av = 0; d.leverEnd = 1; d.leverSwitch = true;
    d.N = this.clampForce(d.a);
    d.phi = 0;
    this.steady(d);
  }

  /**
   * Warm start: the speeds the running drive settles at, so a warm machine does not first spend a fraction of a second
   * settling. Motor torque on the Kloss curve equals the load (fan, bearings, and with a clamped diskette its liner),
   * the belt does not stretch further, and the collet carries the diskette's drag.
   */
  steady(d) {
    const D = this.def, M = D.motor, H = D.hub, K = D.disk, R = D.belt.ratio, ws = M.syncOmega, sb = M.breakdownSlip;
    const clamped = d.media !== null && this.inPlace(d) && d.N > 0;
    const hubLoad = (wh) => H.bearingTorque + H.viscous * wh + (clamped ? K.linerTorque + K.viscous * wh : 0);
    const excess = (wm) => {
      const s = (ws - wm) / ws;
      return (2 * M.breakdownTorque * s * sb) / (s * s + sb * sb) - this.fanB * wm * wm - M.frictionTorque - hubLoad(wm / R) / R;
    };
    let lo = 0.8 * ws, hi = ws;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (excess(mid) > 0) lo = mid; else hi = mid; }
    d.wm = lo; d.wh = lo / R;
    d.e = hubLoad(d.wh) / this.rh / D.belt.stiffness;
    d.wd = clamped ? d.wh : 0;
    d.z = clamped ? (K.linerTorque + K.viscous * d.wd) / D.clamp.stickStiffness : 0;
    this.wakeSpin(d);
  }

  // ---- what the adapter may touch -------------------------------------------------------------------------------
  /** Head stepper phase state and amplitude. */
  setHead(i, state, amp) {
    const s = this.st[i];
    if (state !== s.state || amp !== s.amp) { s.command(state, amp); this.wakeHead(this.drives[i]); }
  }
  /** Head-load solenoid on or off. */
  setHeadLoad(i, on) {
    const d = this.drives[i], c = on ? 1 : 0;
    if (c !== d.coilCmd) { d.coilCmd = c; this.wakeArm(d); }
  }
  /** Sensors. */
  leverClosed(i) { return this.drives[i].leverSwitch; }
  /** The 2D drive's dual LED sees the diskette's type once it is home (HW 3.5). */
  mediaType(i) { const d = this.drives[i]; return d.media && this.inPlace(d) ? d.media.type : null; }
  /** The index phototransistor: light through the index hole. */
  indexHole(i) { const d = this.drives[i]; return !!d.media && this.inPlace(d) && d.phi < this.def.disk.indexWidth; }

  // ---- derived quantities -----------------------------------------------------------------------------------------
  inPlace(d) { return Math.abs(d.s - this.home) < this.def.clamp.centreTolerance; }
  colletTravel(a) { return this.def.clamp.colletTravel * Math.sin(this.kappa * a); }
  clampForce(a) { const C = this.def.clamp; return C.springRate * Math.max(0, this.colletTravel(a) - C.clearance); }
  headTrack(i) { return this.st[i].th / this.st[i].step; }

  wakeSlide(d) { d.slideAwake = true; d.slideSleep = 0; }
  wakeLever(d) { d.leverAwake = true; d.leverSleep = 0; }
  wakeArm(d) { d.armAwake = true; d.armSleep = 0; }
  wakeHead(d) { d.headAwake = true; d.headSleep = 0; }
  wakeSpin(d) { d.spinAwake = true; d.spinSleep = 0; }
  /** The station's power: the motors run whenever it is on. */
  setPower(on) { if (on !== this.powered) { this.powered = on; for (const d of this.drives) this.wakeSpin(d); } }

  /** Grabbable DOFs, registered with the host's Inputs. */
  registerDofs(inputs) {
    const D = this.def;
    inputs.register('lever', {
      n: 2, pos: (i) => this.drives[i].a, vel: (i) => this.drives[i].av, inertia: () => D.lever.inertia,
      apply: (i, f) => { this.drives[i].Fl += f; }, wake: (i) => this.wakeLever(this.drives[i]),
      k: 2, c: 0.01, maxF: 0.4, hardMax: 1, vHand: 10,
    });
    inputs.register('disketteSlide', {
      n: 2, pos: (i) => this.drives[i].s, vel: (i) => this.drives[i].sv, inertia: () => D.slide.mass,
      apply: (i, f) => { this.drives[i].Fs += f; }, wake: (i) => this.wakeSlide(this.drives[i]),
      k: 400, c: 6, maxF: 10, hardMax: 25, vHand: 0.6,
    });
  }

  // ---- step --------------------------------------------------------------------------------------------------------
  step(h) {
    const P = this.sim.ports;
    for (let i = 0; i < 2; i++) {
      const d = this.drives[i];
      if (d.leverAwake || d.slideAwake) this.stepLeverSlide(i, d, h, P);
      d.Fl = 0; d.Fs = 0;
      if (d.armAwake) this.stepArm(i, d, h, P);
      if (d.headAwake) this.stepHead(i, d, h, P);
      // Anything that changes a load on the spinning parts wakes them; at a steady speed only the angles advance.
      if (d.leverAwake || d.slideAwake || d.armAwake || d.headAwake) this.wakeSpin(d);
      if (d.spinAwake) this.stepSpin(i, d, h); else this.coast(i, d, h);
    }
  }

  /** Lever and slide together: the lever's tip and the diskette's edge can meet in the lever's plane. */
  stepLeverSlide(i, d, h, P) {
    const L = this.def.lever, S = this.def.slide;
    let T = d.Fl, F = d.Fs;
    // Contact: past its blocking angle the lever's tip is in the plane the diskette crosses. The contact pushes back
    // whichever went in less: a half-inserted diskette stops the lever; a closed lever stops a diskette at the mouth
    // or holds one home; a diskette within the tip's chamfer is pushed home.
    let contact = false;
    if (d.media && d.a > L.blockAngle && d.s > S.leverPlane && d.s < this.trap) {
      contact = true;
      const pL = L.tipRadius * (d.a - L.blockAngle), pOut = d.s - S.leverPlane, pIn = this.trap - d.s;
      if (pL <= Math.min(pOut, pIn)) {
        const f = Math.max(0, L.contactStiffness * pL + L.contactDamping * L.tipRadius * d.av);
        T -= f * L.tipRadius; P[WP_PORT.DISK_LEVER] += f * L.tipRadius;
      } else if (pOut < pIn) {
        F -= Math.max(0, L.contactStiffness * pOut + L.contactDamping * d.sv);
      } else {
        F += Math.max(0, L.contactStiffness * pIn - L.contactDamping * d.sv);
      }
    }
    if (d.leverAwake || contact) this.stepLever(i, d, T, h, P);
    if (d.media && (d.slideAwake || contact)) this.stepSlide(i, d, F, h, P);
    else d.slideAwake = false;
  }

  stepLever(i, d, T, h, P) {
    const L = this.def.lever, C = L.closed, a = d.a, w = d.av;
    d.leverAwake = true;
    // Detent: bistable, a pull toward whichever end is nearer. The flat spring's reaction through the collet cam
    // resists closing until the cam passes its peak, then holds the lever closed.
    T -= L.snapTorque * Math.sin((TWO_PI * a) / C);
    d.N = this.clampForce(a);
    T -= d.N * this.def.clamp.colletTravel * this.kappa * Math.cos(this.kappa * a);
    T -= L.viscous * w + L.coulomb * sat(w, 0.05);
    if (a < 0) { const Ts = Math.max(0, -L.stopStiffness * a - L.stopDamping * w); T += Ts; P[WP_PORT.DISK_LEVER] += Ts; }
    if (a > C) { const Ts = Math.max(0, L.stopStiffness * (a - C) + L.stopDamping * w); T -= Ts; P[WP_PORT.DISK_LEVER] += Ts; }
    d.av = w + (T / L.inertia) * h;
    d.a = a + d.av * h;
    const end = d.a > C - 2e-3 ? 1 : d.a < 2e-3 ? -1 : 0;
    if (end !== d.leverEnd) { if (end) this.sim.ac(WAC.LEVER, i, Math.abs(w)); d.leverEnd = end; }
    const sw = d.a > L.switchAngle;
    if (sw !== d.leverSwitch) { d.leverSwitch = sw; this.irq?.lever(i, sw, this.sim.t); }
    if (d.a < L.bailAngle && d.y > 0) this.wakeArm(d);   // the bail lifts the arm as the lever opens
    if (Math.abs(d.av) < 1e-4 && end !== 0) {
      if (++d.leverSleep > SLEEP_FRAMES) { d.leverAwake = false; d.av = 0; }
    } else d.leverSleep = 0;
  }

  stepSlide(i, d, F, h, P) {
    const S = this.def.slide, s = d.s, v = d.sv;
    d.slideAwake = true;
    F -= S.viscous * v;
    if (s < 0) F += Math.max(0, -S.stopStiffness * s - S.stopDamping * v);
    if (s > this.home) { const Fe = Math.max(0, S.stopStiffness * (s - this.home) + S.stopDamping * v); F -= Fe; P[WP_PORT.DISK_SLIDE] += Fe; }
    // Coulomb friction in the guide, and the collet's grip once it clamps the diskette: stick until the other forces
    // overcome it.
    const Ff = S.friction + (this.inPlace(d) ? this.def.clamp.mu * d.N : 0);
    let vn;
    if (v === 0 && Math.abs(F) <= Ff) vn = 0;
    else {
      const dir = v !== 0 ? Math.sign(v) : Math.sign(F);
      vn = v + ((F - Ff * dir) / S.mass) * h;
      if (v !== 0 && vn * v < 0 && Math.abs(F) <= Ff) vn = 0;
    }
    d.sv = vn;
    d.s = s + vn * h;
    const home = d.s > this.home - 1e-4;
    if (home && !d.slideHome) this.sim.ac(WAC.SLIDE_HOME, i, Math.abs(v));
    d.slideHome = home;
    if (vn === 0 && d.Fs === 0) {
      if (++d.slideSleep > SLEEP_FRAMES) d.slideAwake = false;
    } else d.slideSleep = 0;
  }

  stepArm(i, d, h, P) {
    const A = this.def.headLoad, y = d.y, v = d.yv;
    d.coil += (d.coilCmd - d.coil) * (h / A.tauE);
    if (d.coilCmd === 0 && d.coil < 1e-9) d.coil = 0;
    let F = A.forceConstant * d.coil - (A.spring + A.rate * y) - A.damper * v;
    // The lifted stop, and the bail, which holds the arm lifted while the lever is open (HW 3.3).
    if (y < 0) F += Math.max(0, -A.stopStiffness * y - A.stopDamping * v);
    if (d.a < this.def.lever.bailAngle && y > 0) F -= Math.max(0, A.stopStiffness * y + A.stopDamping * v);
    // The pad presses the diskette (or, with none, meets the head).
    d.pad = 0;
    if (y > A.travel) { d.pad = Math.max(0, A.padStiffness * (y - A.travel) + A.padDamping * v); F -= d.pad; P[WP_PORT.DISK_PAD] += d.pad; }
    d.yv = v + (F / A.mass) * h;
    d.y = y + d.yv * h;
    const landed = d.y > A.travel;
    if (landed && !d.landed) this.sim.ac(WAC.HEAD_LAND, i, v);
    d.landed = landed;
    if (Math.abs(d.yv) < 1e-5 && Math.abs(d.coil - d.coilCmd) < 1e-6) {
      if (++d.armSleep > SLEEP_FRAMES) { d.armAwake = false; d.yv = 0; }
    } else d.armSleep = 0;
  }

  stepHead(i, d, h, P) {
    const H = this.def.head, s = this.st[i];
    const stopTh = H.stop * s.step;
    let T = 0;
    const on = s.th < stopTh;
    if (on) { T = Math.max(0, H.stopStiffness * (stopTh - s.th) - H.stopDamping * s.w); P[WP_PORT.DISK_HEAD_STOP] += T; }
    if (on && !d.onStop) this.sim.ac(WAC.HEAD_STOP, i, Math.abs(s.w));
    d.onStop = on;
    s.integrate(h, T);
    P[WP_PORT.DISK_STEPPER] += Math.abs(s.torque());
    if (!on && s.still()) {
      if (++d.headSleep > SLEEP_FRAMES) { d.headAwake = false; s.w = 0; }
    } else d.headSleep = 0;
  }

  /** Motor, belt, hub, collet and diskette; then the index sensor and the read channel. */
  stepSpin(i, d, h) {
    const D = this.def, M = D.motor, K = D.disk, C = D.clamp, rm = M.pulleyRadius, rh = this.rh;
    const ws = M.syncOmega, wm = d.wm, wh = d.wh, wd = d.wd;
    let Tm = 0;
    if (this.powered) {
      const s = (ws - wm) / ws, sb = M.breakdownSlip;
      Tm = (2 * M.breakdownTorque * s * sb) / (s * s + sb * sb);
      if (s < 0) Tm *= 0.5;                      // braking as an induction generator
      if (wm < M.startSwitch * ws) Tm *= M.startBoost;   // start winding in, below the centrifugal switch
    }
    const ed = rm * wm - rh * wh;
    const Fb = D.belt.stiffness * d.e + D.belt.damping * ed;
    // Collet friction: a bristle that sticks up to the clamp's capacity and slips beyond it.
    const inPlace = d.media !== null && this.inPlace(d);
    const cap = inPlace ? C.mu * d.N * C.radius : 0;
    let Tc = 0;
    if (cap > 0) {
      const dw = wh - wd, zMax = cap / C.stickStiffness;
      let z = d.z + dw * h;
      if (z > zMax) z = zMax; else if (z < -zMax) z = -zMax;
      d.z = z;
      Tc = C.stickStiffness * z + C.stickDamping * dw;
      if (Tc > cap) Tc = cap; else if (Tc < -cap) Tc = -cap;
    } else d.z = 0;
    d.Tc = Tc;
    const Tmot = Tm - Fb * rm - this.fanB * wm * Math.abs(wm) - M.frictionTorque * sat(wm, 1);
    const Thub = Fb * rh - Tc - D.hub.bearingTorque * sat(wh, 0.5) - D.hub.viscous * wh;
    d.wm = wm + (Tmot / M.inertia) * h;
    d.wh = wh + (Thub / D.hub.inertia) * h;
    d.e += (rm * d.wm - rh * d.wh) * h;
    if (d.media) {
      // The diskette: the collet drives it, the jacket's liner and the loaded head drag it.
      const r = K.outerTrackRadius - this.headTrack(i) * K.trackPitch;
      const Td = Tc - (K.linerTorque + D.headLoad.mu * d.pad * r) * sat(wd, 0.5) - K.viscous * wd;
      d.wd = wd + (Td / K.inertia) * h;
    }
    // Asleep once every speed has stopped changing (to rounding): the loads are steady until something wakes it.
    if (Math.abs(d.wm - wm) + Math.abs(d.wh - wh) + Math.abs(d.wd - wd) < 1e-9) {
      if (++d.spinSleep > 4 * SLEEP_FRAMES) d.spinAwake = false;
    } else d.spinSleep = 0;
    this.coast(i, d, h);
  }

  /** The angles, the index sensor and the read channel. */
  coast(i, d, h) {
    const D = this.def, K = D.disk;
    d.hubAngle += d.wh * h;
    if (d.hubAngle >= TWO_PI) d.hubAngle -= TWO_PI; else if (d.hubAngle < 0) d.hubAngle += TWO_PI;
    if (!d.media) { d.readable = false; d.sec = -1; return; }
    d.phi += d.wd * h;
    if (d.phi >= TWO_PI) { d.phi -= TWO_PI; if (this.inPlace(d)) this.irq?.index(i, this.sim.t); } else if (d.phi < 0) d.phi += TWO_PI;
    // Read channel: ID fields are read with the head loaded and settled on a track centre, at speed.
    if (!d.landed) { d.readable = false; d.sec = -1; return; }
    const x = this.headTrack(i), trk = Math.round(x);
    const readable = this.inPlace(d) && d.N > 0 && Math.abs(d.yv) < D.headLoad.settledSpeed && Math.abs(x - trk) < D.head.readWindow
      && trk >= 0 && trk < D.head.tracks && Math.abs(d.wd - this.wNominal) < K.readSpeedWindow * this.wNominal;
    d.readable = readable;
    if (!readable) { d.sec = -1; return; }
    const f = D.formats[d.media.type], spt = trk === 0 ? f.track0 : f.spt;
    const k = Math.floor((d.phi / TWO_PI) * spt);
    if (d.sec >= 0 && k !== d.sec) this.irq?.idField(i, trk, k + 1, this.sim.t);
    d.sec = k;
  }

  // ---- state transfer -----------------------------------------------------------------------------------------
  exportState() {
    return { powered: this.powered, drives: clone(this.drives), st: this.st.map((s) => s.exportState()) };
  }

  importState(s) {
    this.powered = s.powered;
    this.drives = clone(s.drives);
    s.st.forEach((x, i) => this.st[i].importState(x));
  }
}
