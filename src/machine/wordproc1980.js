// A dedicated word-processing system of 1980: display station on its electronics module, a separate keyboard, a
// dual 8-inch diskette unit and a printwheel printer. Five bodies on the desk instead of one machine. SI units; world
// axes as the typewriters (x right, y up, z toward the typist, origin at the desk reference point). Each unit has
// local axes the same way round with its origin on the surface it stands on, under its centre.
// Sources: docs/displaywriter/hardware.md (HW) and printer.md (PR); design in docs/displaywriter/architecture.md.
// Units, placements and the desk layout (M0); the printer's mechanism (M5); the diskette unit's drives (M7); the
// station's power and fan (sound). The station's other mechanisms arrive later.
import base from './frontstrike1926.js';
import calibration from './wp-printer-cal.js';

const deg = Math.PI / 180;
const IN = 0.0254;

// Documented sizes (width, height, depth), m, and masses, kg. The printer's size is measured from the photographs
// (docs/displaywriter/models.md, Printer): the paper slot passes 392 mm paper, the rest in proportion.
const SIZE = {
  station: [0.483, 0.178, 0.356],      // electronics module, HW 1.1
  display: [0.381, 0.292, 0.348],      // 25-line display, HW 1.2
  keyboard: [0.538, 0.101, 0.213],     // HW 2.1
  diskette: [0.254, 0.292, 0.398],     // dual unit, HW 3.1
  printer: [0.73, 0.188, 0.645],       // measured from the photographs (models.md, Printer)
};
const GAP = 0.04;                      // between bodies standing side by side
const KEYBOARD_GAP = 0.045;            // module front to keyboard back
const ROW_BACK = -0.44;                // the printer's back edge: its sheet feeder's trays reach 7 cm further, to the desk's rear border
const STATION_X = 0.12;                // module and keyboard right of the desk centre, so the printer fits on the left
const STATION_Z = -0.13;               // module and diskette unit centres: the screen at reading distance, cables behind

// Placements derived from the sizes and gaps, not typed in.
const station = { x: STATION_X, z: STATION_Z };
const diskette = { x: STATION_X + SIZE.station[0] / 2 + GAP + SIZE.diskette[0] / 2, z: STATION_Z };
const printer = { x: STATION_X - SIZE.station[0] / 2 - GAP - SIZE.printer[0] / 2, z: ROW_BACK + SIZE.printer[2] / 2 };
const keyboard = { x: STATION_X, z: STATION_Z + SIZE.station[2] / 2 + KEYBOARD_GAP + SIZE.keyboard[2] / 2 };

export default {
  id: 'wordproc1980',
  name: 'IBM Displaywriter word processor, c. 1980',
  kind: 'system',
  action: { type: 'printwheel-system' },
  audio: { samples: false },

  units: {
    station: { size: SIZE.station, mass: 14, place: station, color: 0xd9d4c7 },
    display: { size: SIZE.display, mass: 6.6, on: 'station', at: [0, SIZE.station[1], -0.004], tilt: [0, 20 * deg], swivel: [-12 * deg, 12 * deg], color: 0xd9d4c7 },
    keyboard: { size: SIZE.keyboard, mass: 5, place: keyboard, slope: 12 * deg, color: 0xd9d4c7 },
    diskette: { size: SIZE.diskette, mass: 16, place: diskette, color: 0xd9d4c7 },
    printer: { size: SIZE.printer, mass: 29, place: printer, color: 0xd9d4c7 },
  },

  deskLayout: {
    extent: { halfX: 1.05, halfZ: 0.75 },      // shadow frustum and contact-shade bounds
    freshStack: { x: -0.76, z: 0.36 },          // in front of the printer
    pagePile: { x: -0.48, z: 0.36 },
    ashtray: { on: 'diskette', at: [0, SIZE.diskette[1], 0.05] },
    disketteHolder: { x: 0.80, z: -0.05 },
    lamp: false,                                // no room for the desk lamp
    cablesOut: 'back',
  },

  cameras: {
    operator: { position: [0.12, 0.64, 1.10], target: [0.12, 0.2, 0.0] },   // a seated typist: the screen and the keyboard
    overview: { position: [0.0, 1.15, 2.45], target: [-0.05, 0.12, -0.05] },
    keyboard: { position: [0.12, 0.48, 0.62], target: [0.12, 0.06, 0.20] },
    printer: { position: [-0.53, 0.62, 1.0], target: [-0.53, 0.14, -0.12] },     // the cabinet, its panel and the feeder
    diskette: { position: [0.62, 0.36, 0.62], target: [0.53, 0.15, 0.07] },
  },
  defaultCamera: 'overview',
  glyphs: 'glyphs_wp',

  printer: printerBlock(),
  diskettes: disketteBlock(),
  station: {
    // The power supply's fan (HW 1.9): a shaded-pole motor on the 60 Hz line (two poles, 3600 rpm synchronous)
    // turning a seven-blade 80 mm impeller, about 3000 rpm against its drag. Assumed but the line frequency.
    mainsHz: 60,
    fan: { inertia: 6e-5, stallTorque: 0.04, syncOmega: 2 * Math.PI * 60, drag: 6.7e-8, coulomb: 1e-4, blades: 7 },
  },
};

// ---- printer (architecture.md 6; research in printer.md, cited PR) ----------------------------------------------
// Machine-shaped: the blocks the soft bodies and face tables read, in printer-unit coordinates, plus the mechanism.
// Values marked "assumed" fill gaps in the research (PR 13); `calibration` holds the numbers chosen by
// tools/wp/calibrate_printer.mjs against the documented 60 cps and flight-time behaviour (6.6).
function printerBlock() {
  const INDEX_STEPS = 180, BELT = 2.8;
  // One index step is 1/96 in at the platen surface (PR 2): this radius makes the belt ratio exactly 2.8.
  const platenRadius = ((IN / 96) * INDEX_STEPS * BELT) / (2 * Math.PI);
  const trackPitch = 0.0116 / 3;
  // The platen under the access cover's rear edge, 40 % of the depth from the front (MIM p.20, PH 5218_2), its rubber
  // 0.71 of the width (MIM p.20); it reaches past the 392 mm paper the slot passes. models.md, Printer.
  const PLATEN = [0, 0.132, 0.064];
  return {
    action: { fixedPlaten: true },
    platen: {
      radius: platenRadius, length: 0.52, center: PLATEN,
      inertia: 2e-4, bearingViscous: 2.5e-4, bearingCoulomb: 7e-3, paperDrag: 0.01,   // assumed; paper drag from the feed rollers
      rubberE: 4.5e7, rubberNu: 0.47, rubberDepth: 0.006, huntCrossleyAlpha: 0.55, surfaceFriction: 0.85,
    },
    printPoint: { beta: 0 },                        // the petal meets the platen on its front, at axle height
    slug: {
      faceHeight: 0.0042, faceWidth: 0.0021, reliefDepth: 0.0004,
      caseOffset: 0, faceRadius: Infinity,           // a moulded petal face is flat
      foundationKPerM2: 4.0e11,                      // ribbon, paper and rubber stack, as the typewriters
    },
    paper: { ...base.paper },                         // Textpack's default letter sheet (SR 7.3)
    ribbon: {
      film: true, width: 0.0116, length: 122, tracks: 3, thickness: 0.00003,   // multi-strike film (PR 6)
      vibrator: { restDrop: trackPitch, fullLift: 2 * trackPitch },          // lift 0, 1 and 2 track pitches
      // The cartridge's two spool lobes either side of the hammer, in front of the wheel (MIM p.57); a full supply
      // spool of 122 m of film is 70 mm across.
      spoolX: 0.066, spoolY: PLATEN[1] - 0.016, spoolZ: PLATEN[2] + 0.064,
      pawlFeedScale: 1, feedPerKey: 0.00037 / 3, colourBands: ['black'],
    },
    carriage: { typingDirection: -1, travel: 0.340 },
    escapement: { pitch: IN / 12 },                   // nominal, for consumers that want one
    calibration,

    carrier: {
      // Escapement stepper on the leadscrew (PR 7): 200 steps/rev, lead 21.16 mm, so 1/240 in a step.
      stepsPerRev: 200, lead: 0.02116, holdingTorque: 0.45, detentTorque: 0.02, tauE: 0.4e-3,
      rotorInertia: 2.4e-5, viscous: 2e-5, coulomb: 4e-3,                     // rotor and screw; assumed
      followerStiffness: 2e5, followerDamping: 150,                            // sprung follower halves; assumed
      mass: 1.2, railViscous: 6, railCoulomb: 1.5,                             // carrier on its shafts; assumed
      home: -0.1675,                                                           // logical 0: left end of the 335 mm writing line
      stops: [-0.170, 0.170], stopStiffness: 2e6, stopDamping: 800,
      printRate: 1440, slewRate: 3000, ramp: 40000,                            // steps/s, steps/s^2 (6.4)
      minCycle: 0.014, minRunUp: 2, settle: 0.003, fireWatch: 0.006,
      homeRate: 300, homeCurrent: 0.4, homeSteps: 60, homeSlip: 1.5, homePoll: 1e-3, homeOffsetSteps: 26,   // homing against the left stop
    },
    wheel: {
      petals: 96, tipRadius: 0.038, order: petalOrder(),
      rotorTeeth: 32, inertia: 3.5e-6, viscous: 1e-4, coulomb: 2e-3,          // wheel 1.0e-6, hub and rotor 2.5e-6; assumed
      damper: { inertia: 1.0e-6, viscous: 1.1e-3 },                            // viscous inertia damper on the shaft; assumed
      petal: { mass: 0.0002, stiffness: 150, damping: 0.05 },                  // a moulded spoke; assumed
      petalFriction: 0.3, noseHalfWidth: 0.0012, pickupDivisions: 8,
    },
    selection: {
      peakTorque: calibration.peakTorque, tauE: 0.25e-3, advance: 0.2e-3,
      loopPeriod: 20e-6, capture: 0.5, servoKp: 2.1, servoKd: 2.2e-3, seatSpeed: 30, seatTime: 0.2e-3,
      seatMargin: 0.3e-3, clearDelay: 0.3e-3,
      holdCurrent: 1, homeRate: 200, homeMoves: 32,                            // 32 three-step moves to find home (MIM p.123)
    },
    hammer: {
      armatureMass: 0.006, freeTravel: 0.0005, petalTravel: 0.0017, overtravel: 0.0008,
      returnSpring: 1.5, returnRate: 300, forceConstant: 3.0,                  // N, N/m, N/A; assumed
      tauOn: 0.3e-3, tauOff: 0.12e-3,                                          // coil current rise and clamp decay; assumed
      backstopStiffness: 2e5, backstopDamping: 25, pickupStiffness: 2e6, pickupDamping: 40, catchDepth: 1e-4,
      reboundSpeed: 0.05, servoGain: 0.35, powerOnError: 0.2, impactWatch: 1e-3,
      // Force groups (MIM p.117-118, p.189): low, medium and high. The OCR lost three of the five low characters;
      // characters the manual does not list join the group whose median face area is nearest (calibration).
      groups: [".,-:'", 'anrcslf)LIJ(/17+?=xvzjyitoe', 'mdhkVGUFBZHPRSNCTDEAOMYW9K3X2'],
      groupCurrents: [2.2, 2.8, 3.4],                                          // A; assumed
      inkPressureFactor: 1.6,                                                  // median face's peak pressure over paper.inkHalfPressure (6.6)
    },
    index: {
      stepsPerRev: INDEX_STEPS, beltRatio: BELT, holdingTorque: 0.2, detentTorque: 0.008, tauE: 0.6e-3,
      rotorInertia: 3e-6, viscous: 2e-5, coulomb: 2e-3, beltStiffness: 60, beltDamping: 0.15,   // assumed; belt and bearing losses
      rate: 400, startRate: 250, ramp: 25000, settle: 0.004, runCurrent: 1, holdCurrent: 1,
    },
    ribbonFeed: {
      stepsPerRev: 48, holdingTorque: 0.1, detentTorque: 0.004, tauE: 0.3e-3, rotorInertia: 3e-7, viscous: 2e-6, coulomb: 3e-4,
      filmDrag: 2e-5, stepsPerChar: 4, feedPerStep: 0.00037 / 12, rate: 600, holdCurrent: 1, lowWarningChars: 200,
      // Lift cam geared to the feed: one track per character, three tracks a turn (PR 6 inferred).
      lift: { stepsPerRev: 12, trackPitch, transition: 0.9, mass: 0.004, spring: 3, rate: 400, damping: 2, camStiffness: 2e4 },
    },
    cam: {
      // DC motor through a self-locking worm; five positions sensed by two reed switches (MIM p.186, p.124).
      motor: { resistance: 12, kt: 0.06, ke: 0.06, inertia: 4e-6, viscous: 1e-6, coulomb: 2e-3 },
      volts: 24, ratio: 40, efficiency: 0.4, wormLock: 0.01, positions: 5, dwell: 0.3, reedWindow: 6 * deg,
      pollPeriod: 0.5e-3, timeout: 1.0,
      // Followers: lift per position (1 home, 2 tractor, 3 rear feed roller, 4 paper release, 5 bail open).
      release: { table: [0, 0.5, 0.2, 1.0, 0], inertia: 1.2e-5, spring: 0.05, rate: 0.1, damping: 2e-3, camStiffness: 40 },
      bail: { table: [0, 0, 0, 18 * deg, 18 * deg], inertia: 2.5e-5, spring: 0.03, rate: 0.08, damping: 2e-3, camStiffness: 40 },
    },
    // The covers and the sheet feeder as the soft bodies meet them (printer-unit coordinates, m; the shapes are built by
    // tools/blender/build_wp_printer.py from the same numbers). The access cover stands 18 mm proud of the cabinet's top
    // (PH 5218_1) and hinges on its rear top edge, just in front of the paper slot; the slot runs from there back over
    // the platen to the acoustic filter. The sheet feeder stands over the slot: its stacker plate is the paper table,
    // its front leans back clear of the opened cover.
    cabinet: {
      top: 0.170, coverTop: 0.188, hinge: [0.186, 0.094], slot: [0.012, 0.094], slotHalfWidth: 0.212, filterFoot: [0.160, 0.028],
      feeder: { halfWidth: 0.278, top: 0.525, opening: [0.170, 0.430], openingHalfWidth: 0.215, front: 0.072, lean: 0.30,
        topBack: -0.135, rearTop: 0.345, rearTopFront: -0.155, back: -0.315, trayBack: -0.39 },
    },
    paperFeed: { chunk: 16, loadMaxSteps: 96 * 5, ejectMaxSteps: 96 * 13 },
    cover: {
      inertia: 0.012, gravityTorque: 0.35, latchTorque: 0.6, latchAngle: 2 * deg, open: 100 * deg,   // past upright: it rests open on its stop
      viscous: 0.01, coulomb: 0.01, stopStiffness: 60, stopDamping: 0.5, interlockAngle: 3 * deg,
    },
    panel: {
      keys: ['start', 'stop', 'printTest', 'cancel', 'load', 'release', 'paperUp', 'paperDown'],
      travel: 0.003, mass: 0.004, spring: 2.0, rate: 300, viscous: 0.3, make: 0.6, stopStiffness: 3e5, stopDamping: 15,
      scanPeriod: 0.002,
      paperKey: { first: 2, holdAfter: 0.25, more: 14, repeatAfter: 0.35, repeatSteps: 16, repeatPeriod: 0.066 },   // MIM p.181
      // a-z, A-Z, 0-9 forward, then the symbols in reverse (MIM p.131)
      printTestOrder: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' + [...'°±!@#$%¢&*()_-+=¼½[]:;"\'³²¶§,.?/'].reverse().join(''),
      printTestPitch: 20,
    },
    power: { travel: 20 * deg, inertia: 2e-6, snapTorque: 0.02, viscous: 1e-5, stopStiffness: 5, stopDamping: 5e-3, checksTime: 14.8 },
    fan: { inertia: 4e-5, stallTorque: 0.03, syncOmega: 2 * Math.PI * 50, drag: 1e-7, coulomb: 1e-4, blades: 5 },   // blades: assumed
  };
}

// ---- diskette unit (architecture.md 8.3; research in hardware.md 3, cited HW) ------------------------------------------
// Two identical drives (HW 3.2). Per drive: an AC motor always running, a belt to the hub, the diskette clamped to the
// hub by the collet's friction, the head carriage on a stepper and steel band, the head-load solenoid and arm, the
// lever and the diskette's slide in its guide. Documented: 360 rpm, 1800 rpm motor, 1.8 degrees a track, 77 tracks,
// 5 ms steps, 35 ms settle, the index window, the stop behind track 00. Everything else is assumed and marked so.
function disketteBlock() {
  const TPI = 48;                                   // 77 tracks at 48 tpi, the 8-inch standard
  const track = IN / TPI;
  const stepsPerRev = 200;                          // 1.8 degrees per track (HW 3.5)
  const D = {
    rpm: 360,                                       // HW 3.5
    motor: {
      // Capacitor start, four poles on 60 Hz (1800 rpm synchronous), Kloss curve; the start winding doubles the torque
      // below the centrifugal switch. Rotor, pulley and fan; assumed.
      syncOmega: 2 * Math.PI * 30, breakdownTorque: 0.12, breakdownSlip: 0.25, startBoost: 2, startSwitch: 0.75,
      inertia: 6e-5, fanTorqueAtSync: 0.006, frictionTorque: 0.002, pulleyRadius: 0.012,
    },
    belt: { stiffness: 4e4, damping: 8 },           // N/m, N s/m; assumed
    hub: { inertia: 1.6e-4, bearingTorque: 0.004, viscous: 2e-5 },   // hub, pulley and spindle; assumed
    disk: {
      // Mylar disk in its jacket: 2.5 g, 8 in; the liner rubs it (assumed). The index hole passes the sensor for
      // 2 ms a turn (1.5 to 3.0 ms, HW 3.5).
      inertia: 1.6e-5, linerTorque: 0.006, viscous: 1e-5, indexWidth: 0.002 * 2 * Math.PI * 6,
      outerTrackRadius: 0.0985, trackPitch: track, readSpeedWindow: 0.04,
    },
    clamp: {
      // The lever drives the collet through the actuator rod and the flat spring (HW 3.3): collet travel is a
      // function of the lever angle, peaking before the lever is closed so the spring holds it closed (over centre).
      colletTravel: 0.006, clearance: 0.002, peakAngle: 80 * deg,   // 2 mm clear with the handle open (HW 3.3)
      springRate: 4000, mu: 0.35, radius: 0.016,                     // N/m; friction radius of the collet ring, m
      stickStiffness: 50, stickDamping: 0.02, centreTolerance: 0.003, // N m/rad, N m s/rad; m of slide off home
    },
    lever: {
      closed: 90 * deg, inertia: 2e-5, snapTorque: 0.02, viscous: 2e-4, coulomb: 0.002,
      stopStiffness: 20, stopDamping: 0.01, tipRadius: 0.025, blockAngle: 30 * deg,
      bailAngle: 70 * deg, switchAngle: 80 * deg,   // the head-load bail is free, and the ready switch made, past these
      contactStiffness: 2e4, contactDamping: 10,
    },
    slide: {
      // Leading-edge depth of the diskette in its guide, from the slot mouth. The lever sweeps a plane 5 mm in.
      mass: 0.035, length: 0.2032, leverPlane: 0.005, leverClearance: 0.0015, homeClearance: 0.003,
      friction: 0.25, viscous: 0.5, stopStiffness: 2e4, stopDamping: 60,
    },
    head: {
      // Stepper and steel band to the carriage (HW 3.5): one full step a track. The carriage's mass is reflected into
      // the rotor. A stop pin on the pulley sits 0.6 of a step behind track 00. Assumed but the step angle.
      stepsPerRev, holdingTorque: 0.12, detentTorque: 0.004, tauE: 0.6e-3, rotorInertia: 1.2e-5,
      carriageMass: 0.06, pulleyRadius: (track * stepsPerRev) / (2 * Math.PI), viscous: 0.01, coulomb: 0.003,
      stop: -0.6, stopStiffness: 200, stopDamping: 0.04, tracks: 77, readWindow: 0.2,
    },
    headLoad: {
      // Solenoid, bail and arm (HW 3.5): the arm presses the pad and diskette onto the head through a dashpot that
      // keeps the head from bouncing. Load time is not documented (HW 3.5); these give about the 40 ms assumed in
      // devices/timing.js. Assumed.
      travel: 0.001, mass: 0.012, forceConstant: 1.5, tauE: 4e-3, spring: 0.5, rate: 300, damper: 26,
      stopStiffness: 2e4, stopDamping: 20, padStiffness: 2e4, padDamping: 20, mu: 0.2, settledSpeed: 0.002,
    },
    // What is recorded on the diskette (HW 3.6): sectors per track, track 00 apart.
    formats: { '1': { sides: 1, spt: 15, track0: 26 }, '2D': { sides: 2, spt: 26, track0: 26 } },
    adapter: {
      stepTime: 0.005, settle: 0.035, recalSteps: 77,      // HW 3.5
      minPeriod: 0.1625, maxPeriod: 0.1709,                // index period accepted (HW 3.5)
      headUnload: 2, retries: 3, searchTurns: 3,           // assumed; three retries (HW 3.5)
    },
  };
  D.belt.ratio = beltRatio(D);
  return D;
}

/**
 * Pulley ratio that gives 360 rpm under load (the head loaded on a middle track): the documented 1800 / 360 = 5 is
 * the synchronous ratio, and an induction motor runs a little below synchronous speed.
 */
function beltRatio(D) {
  const M = D.motor, H = D.hub, K = D.disk, L = D.headLoad;
  const wd = (D.rpm / 60) * 2 * Math.PI;
  const pad = L.forceConstant - L.spring - L.rate * L.travel;
  const Tdisk = K.linerTorque + K.viscous * wd + L.mu * pad * (K.outerTrackRadius - 37 * K.trackPitch);
  let R = M.syncOmega / wd;
  for (let i = 0; i < 20; i++) {
    const wm = R * wd;
    const T = M.fanTorqueAtSync * (wm / M.syncOmega) ** 2 + M.frictionTorque + (H.bearingTorque + H.viscous * wd + Tdisk) / R;
    const s = (M.breakdownSlip * (M.breakdownTorque - Math.sqrt(M.breakdownTorque ** 2 - T * T))) / T;
    R = (M.syncOmega * (1 - s)) / wd;
  }
  return R;
}

/**
 * Petal order: home (index 0) is lowercase a (PR 4); the rest by English frequency, alternately either side of
 * home, so common letters need short moves. The 96 petals carry the 96-character keyboard's characters (HW 2.6):
 * 94 distinct, with the comma and the period, which print the same in both cases, on two petals each.
 */
function petalOrder() {
  const freq = 'aetoinshrdlcumwfgypb,.vkTIAS-\'CM"BWHPRDEN10LFGO2()J9Y354867:;?xjqz!/KUVQXZ&%$#@*+=_¢°±¼½[]³²¶§,.';
  const order = new Array(96);
  [...freq].forEach((c, k) => { order[k % 2 ? (k + 1) / 2 : (96 - k / 2) % 96] = c; });
  return order.join('');
}
