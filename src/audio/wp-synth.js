// The word processor's voices (architecture.md 10.2). No recordings of this machine exist, so every sound is made
// here from what the mechanism is doing: contact forces and motor torques excite small modal bodies (petal, platen,
// carrier, frame, cabinet; the drive chassis and its lever), and rotor and air speeds set the level and pitch of the
// motors, fans and air noise. Nothing is triggered by intent: a steady load is silent, a force that changes rings the
// structure it acts on, and a motor that is not turning makes no tone. The keyboard's click and beep are voiced
// elsewhere (wp-speaker.js).
//
// The engine captures one probe frame per audio sample while it steps the mechanism (`capture`), then renders the
// block (`render`), so the cost of the voices can be measured apart from the mechanism's.
import { Bank } from './modal.js';
import { Limiter } from './room.js';
import { WP_PORT } from '../sim/wp/ports.js';

const TAU = 2 * Math.PI;

// ---- probe frame: what is read from the mechanism each sample ------------------------------------------------------
// Forces and torques are read as the block average over the sample's substeps (ports) or at the sample (torques).
export const PR = {
  HAMMER: 0,      // petal face on ribbon, paper and platen (N)
  ARMATURE: 1,    // hammer nose on the petal (N)
  BACKSTOP: 2,    // armature on its backstop (N)
  FOLLOWER: 3,    // leadscrew follower (N)
  CSTOP: 4,       // carrier on an end stop (N)
  SEL_T: 5,       // selection motor torque, signed (N m): its reaction rings the carrier
  SEL_W: 6,       // wheel speed (rad/s)
  SCREW_T: 7,     // escapement motor torque, signed (N m): its reaction rings the frame
  CARRIER_V: 8,   // carrier speed (m/s)
  INDEX_T: 9,     // index motor torque, signed (N m)
  BELT: 10,       // timing belt torque at the platen (N m)
  RIBBON_T: 11,   // ribbon motor torque, signed (N m)
  LIFT: 12,       // ribbon lift follower on its cam (N)
  CAM_W: 13,      // paper cam motor speed (rad/s)
  CAM: 14,        // cam followers, feed-roll rocker and bail (N m)
  CASE: 15,       // cover on its seat and panel keys on their stops (N m and N)
  HEAD_STOP: 16,  // head pulleys on their stop pins, both drives (N m)
  PAD: 17,        // head-load pads on the diskettes (N)
  LEVER: 18,      // levers on their stops and diskettes on their end stops (N m and N)
  HEAD_T: 19,     // head steppers' torque, signed, both drives (N m)
  CLAMP: 20,      // collet clamp forces, both drives (N)
  COUNT: 21,
};

// ---- levels ---------------------------------------------------------------------------------------------------------
// Set, one source at a time, so that at the operator's chair printing prose peaks near -14 dBFS with the strikes
// (hammer on petal near -18, petal face near -20) and runs near -33 dBFS RMS, the carrier's whine near -40 and the
// selection near -45; a 16-step line feed near -34 RMS; a recalibrate buzz near -32 and a head-load clunk near -32
// peak; a lever closing near -28 peak; the paper cam's whirr near -48; and at idle the whole machine near -50 dBFS RMS
// (drive hum -56, station fan -56, printer fan -60, drive air -60). Assumed: there is no recording and no dB figure
// (PR 10, HW 1.9).
export const LEVEL = {
  // Bodies: output gain per unit of modal response.
  petal: 1e-3, platen: 1e-3, carrier: 1e-3, frame: 1e-3, cabinet: 1e-3, chassis: 1e-3, lever: 1e-3,
  // How hard each source drives the bodies (dimensionless couplings of N, or N m over the mounting radius).
  hammer: 3.6, backstop: 0.3, impact: 0.135, selection: 0.7, escapement: 1.0, index: 1.6, ribbon: 2.5, follower: 1, cam: 3, carrierStop: 1,
  caseClick: 0.6, headStep: 38, headStop: 30, headLoad: 18, collet: 200, leverClick: 70,
  // Sources heard directly, full scale at their reference speed.
  impactClick: 1.5e-3, wheelWhir: 0.25, rumble: 0.054, camWhirr: 0.018, printerFan: 0.011, printerHum: 9.6e-4,
  motorRotor: 1.4e-3, motorHum: 1.9e-3, motorAir: 4.8e-3, rub: 7.8e-3, stationFan: 0.014, stationHum: 1.2e-3, crtWhine: 4e-5,
};

// Modal bodies [frequency Hz, T60 s, gain]. Assumed from the parts' sizes and materials.
const PETAL = [[3100, 0.012, 1], [5200, 0.009, 0.8], [7900, 0.007, 0.6], [11200, 0.005, 0.4]];       // moulded spoke and face
const PLATEN = [[620, 0.05, 1], [1480, 0.04, 0.7], [2650, 0.03, 0.5], [4100, 0.025, 0.35]];          // rubber on a steel tube
const CARRIER = [[880, 0.06, 0.8], [1730, 0.05, 1], [2960, 0.04, 0.8], [4450, 0.03, 0.6], [6700, 0.02, 0.4]];   // die-cast carrier, motors
const FRAME = [[410, 0.12, 0.7], [960, 0.10, 1], [1850, 0.08, 0.8], [3300, 0.06, 0.6], [5100, 0.04, 0.4]];      // side frames and shafts
const CABINET = [[145, 0.08, 1], [238, 0.07, 0.8], [395, 0.06, 0.7], [640, 0.05, 0.5], [1050, 0.04, 0.35]];      // lined plastic covers
const CHASSIS = [[530, 0.07, 0.7], [1180, 0.06, 1], [2350, 0.05, 0.8], [3750, 0.04, 0.6], [5600, 0.03, 0.4]];   // cast drive frame
const LEVER = [[310, 0.05, 1], [760, 0.04, 0.7], [1900, 0.03, 0.5], [3600, 0.02, 0.3]];                       // lever and front bezel

const MOUNT_R = 0.02;           // m: a motor's reaction torque reaches its mounting as a force over about this radius
const COVER_LP = [1600, 7000];  // Hz: the covers' and acoustic filter's low pass with the access cover shut and open
const SLOT_LEAK = 0.15;         // the paper slot's share of the mechanism's sound, through the perforated filter
const MOUNT_LP = 300;
const GROMMET_HP = 800;         // Hz: the step motors' resilient mounting passes the step rate, not a start's slow torque           // Hz: what the shock mounts pass of the frame's vibration into the covers
const PETALS = 96;
const COMMUTATIONS = 6;         // the cam motor's commutator segments a turn (three-slot armature); assumed
const ROTOR_BARS = 24;          // the drive motors' rotor slots: the slot harmonic; assumed
const CRT_LINE_HZ = 15720;      // horizontal deflection: not documented (HW 9); off unless machine.audio.crtWhine

// ---- small DSP parts ---------------------------------------------------------------------------------------------
/** xorshift noise in [-1, 1); deterministic, no Math.random in the audio path. */
class Noise {
  constructor(seed) { this.s = seed | 0 || 1; }
  next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x; return (x | 0) / 2147483648; }
}

/** Two-pole filter, transposed direct form II (RBJ coefficients). */
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(kind, f, Q, sr) {
    const w = (TAU * Math.min(f, 0.45 * sr)) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al;
    if (kind === 'lp') { this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; }
    else { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }   // band pass, 0 dB at the centre
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  tick(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Sine by rotation: frequency set per block, sin 2x and sin 3x come from the same state for free. */
class Osc {
  constructor() { this.c = 1; this.s = 0; this.kc = 1; this.ks = 0; }
  set(f, sr) {
    const w = (TAU * f) / sr;
    this.kc = Math.cos(w); this.ks = Math.sin(w);
    const m = 1 / Math.hypot(this.c, this.s);
    this.c *= m; this.s *= m;
  }
  tick() { const c = this.c * this.kc - this.s * this.ks; this.s = this.s * this.kc + this.c * this.ks; this.c = c; return this.s; }
}

/** A modal body that sleeps when nothing drives it and its ringing has died away. */
class Body {
  constructor(modes, sr, gain) {
    this.bank = new Bank(modes, sr, gain);
    let g = 0;
    for (let i = 0; i < this.bank.n; i++) g = Math.max(g, Math.abs(this.bank.g[i]));
    this.eps = 1e-8 / Math.max(g, 1e-30);     // -160 dB at the output
    this.awake = false; this.quiet = 0;
  }
  tick(x) {
    if (x === 0) {
      if (!this.awake) return 0;
      const y = this.bank.tick(0, 0);
      if (this.bank.level < this.eps && ++this.quiet > 32) { this.awake = false; this.bank.reset(); }
      return y;
    }
    this.awake = true; this.quiet = 0;
    return this.bank.tick(0, x);
  }
}

/** Triangle in [-1, 1] from a phase in turns: a pulse train's first few harmonics with little aliasing. */
const tri = (u) => 4 * Math.abs(u - Math.floor(u) - 0.5) - 1;

/** Linked stereo version of the engine's limiter: one gain from the louder channel, both delayed alike. */
export class StereoLimiter extends Limiter {
  constructor(sr, opts) {
    super(sr, opts);
    this.bufR = new Float32Array(this.L);
    this.l = 0; this.r = 0;
    this.nLow = 0;              // entries of need[] under 1: below the knee none are, and the minimum is 1
  }
  tick2(xl, xr) {
    const a = Math.max(xl < 0 ? -xl : xl, xr < 0 ? -xr : xr), p = this.pos;
    const dl = this.buf[p], dr = this.bufR[p];
    this.buf[p] = xl; this.bufR[p] = xr;
    const w = a <= this.knee ? 1 : this.want(a);
    this.nLow += (w < 1 ? 1 : 0) - (this.need[p] < 1 ? 1 : 0);
    this.need[p] = w;
    this.pos = (p + 1) % this.L;
    let m = 1;
    if (this.nLow > 0) for (let i = 0; i < this.L; i++) if (this.need[i] < m) m = this.need[i];
    this.g = m < this.g ? m : m + (this.g - m) * this.rel;
    const g = this.g, yl = dl * g, yr = dr * g;
    this.l = yl > 1 ? 1 : (yl < -1 ? -1 : yl);
    this.r = yr > 1 ? 1 : (yr < -1 ? -1 : yr);
  }
}

// ---- the printer ----------------------------------------------------------------------------------------------------
/**
 * The mechanism on its shock mounts inside lined covers. The hammer's force rings the petal and the platen and, through
 * the carrier, the frame; the motors' reaction torques ring the bodies they are bolted to (selection and ribbon motors
 * on the carrier, escapement and index motors on the frame), so the carrier's step rate is heard as its whine and a
 * wheel move as a short buzz. Air: the petals passing the card holder whir with wheel speed, the leadscrew and its
 * follower rumble with carrier speed, the cam motor whirrs with its speed. All of it reaches the room through the
 * covers (a low pass that opens with the access cover), the slot's acoustic filter, and, below the shock mounts'
 * corner, the covers' own modes. The fan blows through its grille outside all that.
 */
class PrinterVoice {
  constructor(def, sr, levels) {
    this.sr = sr; this.def = def; this.L = levels;
    this.petal = new Body(PETAL, sr, levels.petal);
    this.platen = new Body(PLATEN, sr, levels.platen);
    this.carrier = new Body(CARRIER, sr, levels.carrier);
    this.frame = new Body(FRAME, sr, levels.frame);
    this.cabinet = new Body(CABINET, sr, levels.cabinet);
    this.noise = new Noise(0x5218);
    this.rumbleBp = new Biquad().set('bp', 240, 0.8, sr);
    this.whirLp = new Biquad().set('lp', 6000, 0.7, sr);
    this.camBp = new Biquad().set('bp', 900, 0.7, sr);
    this.fanBp = new Biquad().set('bp', 1100, 0.45, sr);
    this.fanTone = new Biquad().set('lp', 900, 0.7, sr);
    this.cover = new Biquad().set('lp', COVER_LP[0], 0.6, sr);
    this.coverGain = 1;
    this.slot = 0; this.slotA = 1 - Math.exp((-TAU * 6000) / sr);
    this.mount = 0; this.mountA = 1 - Math.exp((-TAU * MOUNT_LP) / sr);
    this.whirPh = 0; this.camPh = 0; this.bladePh = 0;
    this.prev = new Float64Array(PR.COUNT);
    this.fanAmp = 0; this.fanBlade = 0; this.hum = 0; this.bladeInc = 0;
    this.coverOpen = -1;
    this.screwLp = 0; this.gromA = 1 - Math.exp((-TAU * GROMMET_HP) / sr);
  }

  /** Slow quantities, once a block: fan speed, power, the access cover. */
  block(sim) {
    const p = sim.printer, F = this.def.fan, wf = p.fan / F.syncOmega, L = this.L;
    this.fanAmp = L.printerFan * Math.pow(Math.max(0, wf), 2.5);
    this.fanBlade = 0.35 * this.fanAmp;
    this.bladeInc = (F.blades * p.fan) / TAU / this.sr;
    this.hum = p.powered() ? L.printerHum : 0;
    const open = Math.max(0, Math.min(1, p.cover / this.def.cover.open));
    if (Math.abs(open - this.coverOpen) > 1e-3) {
      this.coverOpen = open;
      this.cover.set('lp', COVER_LP[0] + (COVER_LP[1] - COVER_LP[0]) * open, 0.6, this.sr);
      this.coverGain = 1 + open;                    // +6 dB with the cover open (10.2)
    }
  }

  tick(f, o, hum) {
    const q = this.prev, L = this.L;
    const F = f[o + PR.HAMMER] * L.impact;                       // petal face on ribbon, paper, platen: soft, slow
    const dArm = (f[o + PR.ARMATURE] - q[PR.ARMATURE]) * L.hammer; // hammer nose on the petal: hard
    const dBack = (f[o + PR.BACKSTOP] - q[PR.BACKSTOP]) * L.backstop;   // armature home on its faced stop
    const dSel = ((f[o + PR.SEL_T] - q[PR.SEL_T]) / MOUNT_R) * L.selection;
    const dRib = ((f[o + PR.RIBBON_T] - q[PR.RIBBON_T]) / MOUNT_R + 0.2 * (f[o + PR.LIFT] - q[PR.LIFT])) * L.ribbon;
    const dFol = (f[o + PR.FOLLOWER] - q[PR.FOLLOWER]) * L.follower;
    // The step motors sit in resilient grommets: they pass the step-rate ripple to the frame but little of the slow
    // torque of a start or a stop (a first-order high pass).
    const xScrew = ((f[o + PR.SCREW_T] - q[PR.SCREW_T]) / MOUNT_R) * L.escapement;
    let lp = this.screwLp + (xScrew - this.screwLp) * this.gromA;
    if (lp < 1e-12 && lp > -1e-12) lp = 0;          // flushed, so a frame at rest can sleep
    this.screwLp = lp;
    const dScrew = xScrew - lp;
    const dStop = (f[o + PR.CSTOP] - q[PR.CSTOP]) * L.carrierStop;
    const dIdx = ((f[o + PR.INDEX_T] - q[PR.INDEX_T]) / MOUNT_R + (f[o + PR.BELT] - q[PR.BELT]) / MOUNT_R) * L.index;
    const dCam = ((f[o + PR.CAM] - q[PR.CAM]) / MOUNT_R) * L.cam;
    const dCase = (f[o + PR.CASE] - q[PR.CASE]) * L.caseClick;
    const dF = F - q[PR.HAMMER] * L.impact;
    for (let k = 0; k < PR.HEAD_STOP; k++) q[k] = f[o + k];
    // Structure: the hammer's head and the petal; the platen; carrier-borne and frame-borne excitation.
    const exCarrier = F * 0.5 + dSel + dRib + dFol + dArm * 0.5 + dBack;
    const exFrame = F * 0.25 + dScrew + dStop + dIdx + dCam + dFol + dArm * 0.25 + dBack * 0.5;
    let m = this.petal.tick(dArm + 0.2 * F) + this.platen.tick(F + dIdx * 0.2) + this.carrier.tick(exCarrier) + this.frame.tick(exFrame);
    m += L.impactClick * dF;
    // Air: petals past the card holder, leadscrew and follower, cam motor.
    const ws = f[o + PR.SEL_W], aw = ws < 0 ? -ws : ws;
    if (aw > 1) {
      this.whirPh += (PETALS * aw) / TAU / this.sr;
      const s = aw * (1 / 400);
      m += L.wheelWhir * s * s * this.whirLp.tick(tri(this.whirPh) + 0.5 * this.noise.next());
    }
    const vc = f[o + PR.CARRIER_V], av = vc < 0 ? -vc : vc;
    if (av > 1e-4) m += L.rumble * (av / 0.15) * this.rumbleBp.tick(this.noise.next());
    const cw = f[o + PR.CAM_W], ac = cw < 0 ? -cw : cw;
    if (ac > 0.5) {
      this.camPh += (COMMUTATIONS * ac) / TAU / this.sr;
      m += L.camWhirr * (ac / 400) * (0.6 * tri(this.camPh) + this.camBp.tick(this.noise.next()));
    }
    // Through the covers, the slot and the shock mounts.
    this.slot += (m - this.slot) * this.slotA;
    let mt = this.mount + (exFrame - this.mount) * this.mountA;
    if (mt < 1e-12 && mt > -1e-12) mt = 0;
    this.mount = mt;
    let y = this.coverGain * this.cover.tick(m + 1e-20) + SLOT_LEAK * this.slot + this.cabinet.tick(this.mount + dCase);
    // The fan, outside the mechanism: air noise and blade pass with speed, the shaded pole's hum while powered.
    if (this.fanAmp > 1e-7) {
      this.bladePh += this.bladeInc;
      y += this.fanAmp * this.fanBp.tick(this.noise.next()) + this.fanBlade * this.fanTone.tick(tri(this.bladePh));
    }
    return y + this.hum * hum;
  }
}

// ---- the diskette unit ----------------------------------------------------------------------------------------------
/**
 * Two drives in one case. Each AC motor hums at twice the line frequency while powered (louder with slip, as its current
 * is), turns at its own speed with an unbalance partial and a rotor-slot harmonic, and drives a pulley fan and a belt:
 * air noise with speed, fluttering at the belt's pass rate. A clamped diskette rubs its liner, more with the head loaded.
 * The head steppers' reaction rings the cast chassis at each step, so seeks tick and a recalibrate buzzes, and the
 * pulley hitting its stop pin knocks; the pad landing is the head-load clunk; the collet and the lever and the diskette
 * on its stop click on the chassis and the lever.
 */
class DisketteVoice {
  constructor(def, sr, levels) {
    this.sr = sr; this.def = def; this.L = levels;
    this.chassis = new Body(CHASSIS, sr, levels.chassis);
    this.lever = new Body(LEVER, sr, levels.lever);
    this.noise = new Noise(0x3740);
    this.airBp = new Biquad().set('bp', 850, 0.6, sr);
    this.rubBp = new Biquad().set('bp', 3600, 0.9, sr);
    this.rotor = [new Osc(), new Osc()];
    this.slotOsc = [new Osc(), new Osc()];
    this.prev = new Float64Array(PR.COUNT);
    this.rotorAmp = new Float64Array(2); this.slotAmp = new Float64Array(2);
    this.airAmp = 0; this.rubAmp = 0; this.humAmp = 0; this.beltPh = 0; this.beltInc = 0;
  }

  block(sim) {
    const D = sim.diskette, M = this.def.motor, L = this.L, sr = this.sr;
    let air = 0, rub = 0, hum = 0;
    for (let i = 0; i < 2; i++) {
      const d = D.drives[i], u = d.wm / M.syncOmega;
      this.rotor[i].set(d.wm / TAU, sr); this.slotOsc[i].set((ROTOR_BARS * d.wm) / TAU, sr);
      this.rotorAmp[i] = L.motorRotor * u * u;
      this.slotAmp[i] = 0.25 * L.motorRotor * u * u;
      air += Math.pow(Math.max(0, u), 2.5);
      if (D.powered) hum += 1 + 2 * Math.max(0, 1 - u);          // the stator current: more with slip
      if (d.media && d.N > 0) rub += (d.wd / D.wNominal) * (0.25 + Math.min(2, d.pad));
    }
    this.airAmp = L.motorAir * air; this.rubAmp = L.rub * rub; this.humAmp = L.motorHum * hum;
    const wm = D.drives[0].wm;
    this.beltInc = (M.pulleyRadius * wm) / 0.32 / sr;              // a 320 mm belt
  }

  tick(f, o, hum, hum2) {
    const q = this.prev, L = this.L;
    const dStep = ((f[o + PR.HEAD_T] - q[PR.HEAD_T]) / MOUNT_R) * L.headStep;
    const dStop = ((f[o + PR.HEAD_STOP] - q[PR.HEAD_STOP]) / MOUNT_R) * L.headStop;
    const dPad = (f[o + PR.PAD] - q[PR.PAD]) * L.headLoad;
    const dLever = (f[o + PR.LEVER] - q[PR.LEVER]) * L.leverClick;
    const dClamp = (f[o + PR.CLAMP] - q[PR.CLAMP]) * L.collet;
    for (let k = PR.HEAD_STOP; k < PR.COUNT; k++) q[k] = f[o + k];
    let y = this.chassis.tick(dStep + dStop + dPad + 0.3 * dClamp + 0.5 * dLever) + this.lever.tick(dLever + 0.2 * dClamp);
    for (let i = 0; i < 2; i++) {
      const s = this.rotor[i].tick(), c = this.rotor[i].c;
      y += this.rotorAmp[i] * (s + 0.8 * s * c) + this.slotAmp[i] * this.slotOsc[i].tick();   // 1x and 2x, slot harmonic
    }
    this.beltPh += this.beltInc;
    const n = this.noise.next();
    y += this.airAmp * (1 + 0.3 * tri(this.beltPh)) * this.airBp.tick(n);
    if (this.rubAmp > 0) y += this.rubAmp * this.rubBp.tick(this.noise.next());
    return y + this.humAmp * (hum + 0.35 * hum2);
  }
}

// ---- the station -----------------------------------------------------------------------------------------------------
/** The power supply's fan (air noise and blade pass with its speed, its motor's hum while powered); an optional faint
 * line whistle from the display, which is off by default (10.2: the line frequency is not documented). */
class StationVoice {
  constructor(def, sr, levels, crt) {
    this.sr = sr; this.def = def; this.L = levels;
    this.noise = new Noise(0x1980);
    this.bp = new Biquad().set('bp', 700, 0.5, sr);
    this.tone = new Biquad().set('lp', 800, 0.7, sr);
    this.crt = new Osc(); this.crt.set(CRT_LINE_HZ, sr);
    this.crtLevel = crt ? levels.crtWhine * crt : 0;
    this.amp = 0; this.blade = 0; this.ph = 0; this.inc = 0; this.hum = 0; this.whine = 0;
  }
  block(sim) {
    const S = sim.station, F = this.def.fan, u = S.fan / F.syncOmega;
    this.amp = this.L.stationFan * Math.pow(Math.max(0, u), 2.5);
    this.blade = 0.3 * this.amp;
    this.inc = (F.blades * S.fan) / TAU / this.sr;
    this.hum = S.powered() ? this.L.stationHum : 0;
    this.whine = S.powered() ? this.crtLevel : 0;
  }
  tick(hum) {
    let y = this.hum * hum;
    if (this.amp > 1e-7) { this.ph += this.inc; y += this.amp * this.bp.tick(this.noise.next()) + this.blade * this.tone.tick(tri(this.ph)); }
    if (this.whine > 0) y += this.whine * this.crt.tick();
    return y;
  }
}

// ---- all three, panned -----------------------------------------------------------------------------------------------
/** Constant-power pan of a unit by its bearing from the operator's chair: -1 left at 45 degrees or more, +1 right. */
export function unitPan(machine, geometry, unit) {
  const u = geometry.units?.[unit], ear = machine.cameras?.operator?.position;
  if (!u || !ear) return 0;
  const az = Math.atan2(u.origin[0] - ear[0], ear[2] - u.origin[2]);
  return Math.max(-1, Math.min(1, az / (Math.PI / 4)));
}
const panGains = (p) => { const th = ((p + 1) * Math.PI) / 4; return [Math.cos(th), Math.sin(th)]; };

export class WpSynth {
  /** sim: a WordprocSim; levels: LEVEL overrides (calibration, tests). */
  constructor(sim, sampleRate, { levels } = {}) {
    this.sim = sim; this.sr = sampleRate;
    const m = sim.m, L = { ...LEVEL, ...levels };
    this.levels = L;
    this.printer = new PrinterVoice(m.printer, sampleRate, L);
    this.diskette = sim.diskette ? new DisketteVoice(m.diskettes, sampleRate, L) : null;
    this.station = sim.station ? new StationVoice(m.station, sampleRate, L, m.audio?.crtWhine ?? 0) : null;
    this.pan = { printer: unitPan(m, sim.g, 'printer'), station: unitPan(m, sim.g, 'station'), diskette: unitPan(m, sim.g, 'diskette') };
    [this.pL, this.pR] = panGains(this.pan.printer);
    [this.sL, this.sR] = panGains(this.pan.station);
    [this.dL, this.dR] = panGains(this.pan.diskette);
    this.mains = new Osc(); this.mains.set(2 * (m.station?.mainsHz ?? 60), sampleRate);   // magnetostriction: twice the line
    this.frame = new Float64Array(PR.COUNT * 128);
    this.primed = false;
    this.bus = new Float64Array(3);           // the last sample of each bus, for tests
  }

  ensure(n) { if (this.frame.length < PR.COUNT * n) this.frame = new Float64Array(PR.COUNT * n); }

  /** Read sample i's probe frame from the mechanism (ports already averaged over the sample's substeps). */
  capture(i) {
    const s = this.sim, p = s.printer, P = s.ports, f = this.frame, o = i * PR.COUNT;
    f[o + PR.HAMMER] = P[WP_PORT.HAMMER];
    const back = p.xa < 0;      // the port carries the backstop with the armature home, the petal pickup otherwise
    f[o + PR.ARMATURE] = back ? 0 : P[WP_PORT.ARMATURE];
    f[o + PR.BACKSTOP] = back ? P[WP_PORT.ARMATURE] : 0;
    f[o + PR.FOLLOWER] = P[WP_PORT.FOLLOWER];
    f[o + PR.CSTOP] = P[WP_PORT.CARRIER_STOP];
    f[o + PR.SEL_T] = p.sel.Te; f[o + PR.SEL_W] = p.sel.w;
    f[o + PR.SCREW_T] = p.screw.Te; f[o + PR.CARRIER_V] = p.vc;
    f[o + PR.INDEX_T] = p.idx.Te; f[o + PR.BELT] = P[WP_PORT.INDEX];
    f[o + PR.RIBBON_T] = p.rib.Te; f[o + PR.LIFT] = P[WP_PORT.RIBBON];
    f[o + PR.CAM_W] = p.camW; f[o + PR.CAM] = P[WP_PORT.CAM];
    f[o + PR.CASE] = P[WP_PORT.COVER] + P[WP_PORT.PANEL];
    const D = s.diskette;
    if (D) {
      f[o + PR.HEAD_STOP] = P[WP_PORT.DISK_HEAD_STOP];
      f[o + PR.PAD] = P[WP_PORT.DISK_PAD];
      f[o + PR.LEVER] = P[WP_PORT.DISK_LEVER] + P[WP_PORT.DISK_SLIDE];
      f[o + PR.HEAD_T] = D.st[0].Te + D.st[1].Te;
      f[o + PR.CLAMP] = D.drives[0].N + D.drives[1].N;
    }
  }

  /**
   * Render n samples from the captured frames into L and R (R null: the mono sum into L). Returns nothing; the engine
   * runs the room, radiation filter and limiter.
   */
  render(n, outL, outR) {
    const f = this.frame, C = PR.COUNT, sim = this.sim, pv = this.printer, dv = this.diskette, sv = this.station;
    if (!this.primed) {           // first block after silence: no jump from stale values
      this.primed = true;
      for (let k = 0; k < C; k++) { pv.prev[k] = f[k]; if (dv) dv.prev[k] = f[k]; }
    }
    pv.block(sim); dv?.block(sim); sv?.block(sim);
    this.mains.set(2 * (sim.m.station?.mainsHz ?? 60), this.sr);
    const { pL, pR, sL, sR, dL, dR } = this;
    let yp = 0, yd = 0, ys = 0;
    for (let i = 0; i < n; i++) {
      const o = i * C, hum = this.mains.tick(), hum2 = 2 * hum * this.mains.c;   // 120 Hz and 240 Hz
      yp = pv.tick(f, o, hum);
      yd = dv ? dv.tick(f, o, hum, hum2) : 0;
      ys = sv ? sv.tick(hum) : 0;
      outL[i] = pL * yp + sL * ys + dL * yd;
      outR[i] = pR * yp + sR * ys + dR * yd;
    }
    this.bus[0] = yp; this.bus[1] = ys; this.bus[2] = yd;
  }
}
