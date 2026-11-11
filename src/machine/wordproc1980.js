// A dedicated word-processing system of 1980: display station on its electronics module, a separate keyboard, a
// dual 8-inch diskette unit and a printwheel printer. Five bodies on the desk instead of one machine. SI units; world
// axes as the typewriters (x right, y up, z toward the typist, origin at the desk reference point). Each unit has
// local axes the same way round with its origin on the surface it stands on, under its centre.
// Sources: docs/displaywriter/hardware.md (HW) and printer.md (PR); design in docs/displaywriter/architecture.md.
// Units, placements and the desk layout (M0); the printer's mechanism (M5). The other mechanisms arrive later.
import base from './frontstrike1926.js';
import calibration from './wp-printer-cal.js';

const deg = Math.PI / 180;
const IN = 0.0254;

// Documented sizes (width, height, depth), m, and masses, kg. The printer's size is the photo estimate (PR 1).
const SIZE = {
  station: [0.483, 0.178, 0.356],      // electronics module, HW 1.1
  display: [0.381, 0.292, 0.348],      // 25-line display, HW 1.2
  keyboard: [0.538, 0.101, 0.213],     // HW 2.1
  diskette: [0.254, 0.292, 0.398],     // dual unit, HW 3.1
  printer: [0.74, 0.23, 0.58],         // estimated, PR 1
};
const GAP = 0.04;                      // between bodies standing side by side
const KEYBOARD_GAP = 0.045;            // module front to keyboard back
const ROW_BACK = -0.48;                // the printer's back edge, close to the desk's rear border
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
    operator: { position: [0.12, 0.42, 0.66], target: [0.12, 0.30, 0.04] },
    overview: { position: [0.0, 1.15, 2.45], target: [-0.05, 0.12, -0.05] },
    keyboard: { position: [0.12, 0.48, 0.62], target: [0.12, 0.06, 0.20] },
    printer: { position: [-0.53, 0.62, 0.70], target: [-0.53, 0.16, -0.16] },
    diskette: { position: [0.62, 0.36, 0.62], target: [0.53, 0.15, 0.07] },
  },
  defaultCamera: 'overview',
  glyphs: 'glyphs_wp',

  printer: printerBlock(),
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
  return {
    action: { fixedPlaten: true },
    platen: {
      radius: platenRadius, length: 0.415, center: [0, 0.150, -0.060],
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
    paperFeed: { chunk: 16, loadMaxSteps: 96 * 5, ejectMaxSteps: 96 * 13 },
    cover: {
      inertia: 0.012, gravityTorque: 0.35, latchTorque: 0.6, latchAngle: 2 * deg, open: 75 * deg,
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
    fan: { inertia: 4e-5, stallTorque: 0.03, syncOmega: 2 * Math.PI * 50, drag: 1e-7, coulomb: 1e-4 },
  };
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
