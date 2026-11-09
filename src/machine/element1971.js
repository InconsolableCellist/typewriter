// An electric single-element office typewriter of the early 1970s. Fixed platen, a type ball on a carrier that
// walks along it. SI units; coordinates as in frontstrike1926 (x right, y up, z toward the typist, origin under
// the machine centre). No specific make or model.
import base from './frontstrike1926.js';

const deg = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const WIDTH = 0.58, DEPTH = 0.46, HEIGHT = 0.21;
const PITCH = 0.00254;                           // 10 characters per inch
const LINE_PITCH = 0.0042333;                    // six lines per inch
const RATCHET_TEETH = 28;
const PLATEN_RADIUS = (LINE_PITCH * RATCHET_TEETH) / TWO_PI;
const STEP = (360 / 22) * deg;                   // column and band step of the ball
const PLATEN_CENTER = [0, 0.176, -0.092];
const PRINT_BETA = 12 * deg;
const PRINT_POINT = [0, PLATEN_CENTER[1] + Math.sin(PRINT_BETA) * PLATEN_RADIUS, PLATEN_CENTER[2] + Math.cos(PRINT_BETA) * PLATEN_RADIUS];
const BALL_RADIUS = 0.0165;
// The ball rests low and in front of the print line so the line being typed is readable above it.
const BALL_DROP = 0.027;                         // ball centre below the print position, along strikeDown
const BALL_STANDOFF = 0.003;                     // and further off the platen along its normal
const STRIKE_GAP = Math.hypot(BALL_DROP, BALL_STANDOFF);
const BALL_REST_Y = PRINT_POINT[1] + Math.sin(PRINT_BETA) * BALL_RADIUS - BALL_DROP * Math.cos(PRINT_BETA) + BALL_STANDOFF * Math.sin(PRINT_BETA);

export default {
  id: 'element1971',
  name: 'Electric single-element office machine, c. 1971',
  action: { type: 'single-element', shift: 'element-rotate', fixedPlaten: true, powerReturn: true },
  body: { width: WIDTH, depth: DEPTH, height: HEIGHT },
  audio: { samples: 'samples_element' },
  defaultCamera: { position: [0, 0.66, 1.34], target: [0, 0.13, -0.04] },
  desk: { mass: 30, frequencyHz: 6.5, dampingRatio: 0.05 },   // a typing table: the part of its weight and the machine's that sways, and its lateral mode
  deskSpread: 0.11,            // m the desk props stand further out than beside the narrower manual machines
  // Height field the sheet can rest on: rear deck, open slot around the platen, hood, keyboard slope.
  bodyProxy: {
    halfWidth: 0.29, zMin: -0.256, zMax: 0.204, topMax: 0.21,
    profile: [[-0.256, 0.195], [-0.18, 0.195], [-0.175, 0.12], [-0.03, 0.12], [-0.025, 0.205], [0.02, 0.21], [0.03, 0.125], [0.204, 0.06]],
  },

  platen: {
    radius: PLATEN_RADIUS, length: 0.40, center: PLATEN_CENTER,
    inertia: 2.2e-4,
    bearingViscous: 2.5e-4, bearingCoulomb: 7e-3,
    rubberE: 3.8e7, rubberNu: 0.47, rubberDepth: 0.006,
    huntCrossleyAlpha: 0.55,
    detentNotches: RATCHET_TEETH, detentTorque: 0.075,
    ratchetTeeth: RATCHET_TEETH, knobRadius: 0.031, knobOffset: 0.080,
    surfaceFriction: 0.85,
  },
  printPoint: { beta: PRINT_BETA },                 // ball face meets the platen just above the horizontal

  // The ball has no bars; these are only here for code that reads machine.typebars when probing a generic machine.
  typebars: base.typebars,

  // The ball's faces are the "slugs". There is no case offset: the other case is on the opposite hemisphere.
  slug: {
    faceHeight: 0.0058, faceWidth: 0.0028, reliefDepth: 0.00035,
    caseOffset: 0,
    faceRadius: PLATEN_RADIUS * 1.04,             // formed concave to about the platen radius
    steelE: 7e10,                                 // plated injection-moulded ball, softer than a steel slug
    foundationKPerM2: 4.0e11,
    bodyWidth: 0.0024, noseRatio: 1.6,
  },

  linkage: {                                      // key lever to its interposer, light and short
    keyTravel: 0.0052, coupledFraction: 0, accelShape: 1, shapeLinear: 1, linkStiffness: 0, linkDamping: 0,
  },

  keys: {
    strokeS: 0.05, holdDelayS: 0.3, mass: 0.012, returnForce: 0.55, returnRate: 45, coulomb: 0.03, felt: { k: 9e4, c: 16 }, topRadius: 0.0078,
    stemHeight: 0.012, leverPivot: [0, 0.05, 0.01],
    rows: [
      { y: 0.1215, z: 0.082, x0: -0.1065, pitch: 0.019, keys: ['1!','2@','3#','4$','5%','6^','7&','8*','9(','0)','-_','=+'] },
      { y: 0.1125, z: 0.100, x0: -0.0970, pitch: 0.019, keys: ['qQ','wW','eE','rR','tT','yY','uU','iI','oO','pP','[]'] },
      { y: 0.1035, z: 0.118, x0: -0.0922, pitch: 0.019, keys: ['aA','sS','dD','fF','gG','hH','jJ','kK','lL',';:',`'"`] },
      { y: 0.0945, z: 0.136, x0: -0.0827, pitch: 0.019, keys: ['zZ','xX','cC','vV','bB','nN','mM',',,','..','/?'] },
    ],
    controls: [
      { id: 'space',         pos: [0.0000, 0.0855, 0.161], width: 0.180, travel: 0.0048, returnForce: 0.7 },
      { id: 'shiftL',        pos: [-0.1285, 0.0945, 0.136], width: 0.040, travel: 0.0052, returnForce: 0.9 },
      { id: 'shiftR',        pos: [0.1210, 0.0945, 0.136], width: 0.038, travel: 0.0052, returnForce: 0.9 },
      { id: 'shiftLock',     pos: [-0.1290, 0.1035, 0.118], width: 0.032, travel: 0.0052, returnForce: 0.9 },
      { id: 'tab',           pos: [-0.1270, 0.1125, 0.100], width: 0.036, travel: 0.0052, returnForce: 0.9 },
      { id: 'backspace',     pos: [0.1215, 0.1215, 0.082], width: 0.026, travel: 0.0052, returnForce: 0.9 },
      { id: 'return',        pos: [0.1230, 0.1080, 0.109], width: 0.034, travel: 0.0052, returnForce: 1.0 },
      { id: 'index',         pos: [0.1500, 0.1215, 0.082], width: 0.019, travel: 0.0048, returnForce: 0.9 },
      { id: 'correct',       pos: [0.1560, 0.0920, 0.148], width: 0.019, travel: 0.0048, returnForce: 0.9 },
      { id: 'marginRelease', pos: [-0.1620, 0.1215, 0.082], width: 0.019, travel: 0.0048, returnForce: 0.9 },
      { id: 'tabClear',      pos: [-0.1615, 0.1125, 0.103], width: 0.020, travel: 0.0044, returnForce: 0.9 },
      { id: 'tabSet',        pos: [-0.1615, 0.0980, 0.127], width: 0.020, travel: 0.0044, returnForce: 0.9 },
      { id: 'onOff',         pos: [0.1570, 0.1060, 0.116], width: 0.022, travel: 0.0048, returnForce: 1.2 },
    ],
  },

  // Print ball, selection, drive. Consumed by src/sim/element-action.js and deriveGeometry.
  element: {
    // English letter frequency: the most used keys get the smallest tilt and rotate moves.
    frequency: "etaoinshrdlcumwfgypb,.vk-'xj;qz/0123456789=[",
    ball: { radius: BALL_RADIUS, mass: 0.015, bands: 4, columns: 22, bandStep: STEP, columnStep: STEP },
    rest: { drop: BALL_DROP, standoff: BALL_STANDOFF },
    strikeGap: STRIKE_GAP,                        // rest position to platen contact, along strikeDir (see geometry), m

    motor: {
      syncOmega: TWO_PI * 60,                     // two-pole on 60 Hz
      breakdownTorque: 0.28, breakdownSlip: 0.22,   // N m, Kloss curve
      inertia: 1.5e-4,                            // rotor, pulley and fan
      fanTorqueAtRated: 0.092, frictionTorque: 0.012, ratedOmega: 3450 * TWO_PI / 60,
      startOn: true,
    },
    drive: { shaftRatio: 3.71 },                  // motor to print shaft: 3450 rpm to 930 rpm, 15.5 cycles/s

    cycleShaft: {
      inertia: 3.8e-5, bearingViscous: 1.8e-5, bearingCoulomb: 0.004,
      clutchStiffness: 500, clutchDamping: 0.08, clutchMaxTorque: 3.5,
      latchPhase: 0.94,                           // fraction of a turn at which the latch catches the clutch tang
      stopStiffness: 300, stopDamping: 0.12, stopAngle: 0,   // N m/rad, N m s/rad, rad offset from one full turn
    },
    opShaft: {                                    // operational cams: space, backspace, tab, index, return
      inertia: 3.0e-5, bearingViscous: 1.8e-5, bearingCoulomb: 0.004,
      clutchStiffness: 420, clutchDamping: 0.07, clutchMaxTorque: 2.2,
      latchPhase: 0.94, stopStiffness: 300, stopDamping: 0.11, stopAngle: 0,
      motorRatio: 3.71,
    },
    shiftShaft: {                                 // half-turn shift cam, one half revolution per case change
      inertia: 1.1e-5, bearingViscous: 8e-6, bearingCoulomb: 0.003,
      clutchStiffness: 250, clutchDamping: 0.04, clutchMaxTorque: 1.4,
      latchPhase: 0.94, stopStiffness: 200, stopDamping: 0.07, stopAngle: 0,
      motorRatio: 3.2,
    },

    cams: {                                       // [rise start, rise end, fall start, fall end] as fractions of a turn
      select: [0.02, 0.22, 0.68, 0.96],
      detent: [0.22, 0.28, 0.63, 0.68],
      ribbon: [0.18, 0.48, 0.64, 0.88],
      print:  [0.12, 0.60, 0.64, 0.92],            // the rise start is set by the impression control; constant acceleration to the end of the rise
      escape: [0.64, 0.74, 0.76, 0.88],
      correct: [0.18, 0.48, 0.64, 0.88],           // lifts the correction tape instead of the ribbon on a correcting stroke
      correctFeed: [0.66, 0.86, 2, 2],             // pawl indexing the correction tape once, on that stroke
      restore: 0.30,                               // interposer restored by the bail at this fraction of the cycle
    },
    opCams: {
      space:     [0.08, 0.30, 0.36, 0.62],
      backspace: [0.08, 0.40, 0.50, 0.72],
      index:     [0.04, 0.46, 0.58, 0.92],
    },

    tilt: {
      inertia: 3.2e-6, tapeStiffness: 13, tapeDamping: 1.6e-3, viscous: 1.8e-4, bearingCoulomb: 4e-4,
      detentStiffness: 60, detentMaxTorque: 2.2, step: STEP, stopStiffness: 300, stopDamping: 0.1,
    },
    rotate: {
      inertia: 3.3e-6, tapeStiffness: 13, tapeDamping: 1.6e-3, viscous: 1.8e-4, bearingCoulomb: 4e-4,
      detentStiffness: 60, detentMaxTorque: 2.2, step: STEP, stopStiffness: 300, stopDamping: 0.1,
    },
    hemisphere: {
      inertia: 3.3e-6, tapeStiffness: 8, tapeDamping: 1.6e-3, viscous: 1.8e-4, bearingCoulomb: 4e-4,
      detentStiffness: 80, detentMaxTorque: 2.5,
    },

    // Rotate adder weights: R1 + 2 R2 + 2 R2A - 5 R5 spans -5 .. +5; tilt T1 + 2 T2 spans 0 .. 3.
    latches: { rotate: { R1: 1, R2: 2, R2A: 2, R5: -5 }, tilt: { T1: 1, T2: 2 } },

    rocker: {
      mass: 0.024,                                // ball, sleeve and rocker reflected at the ball
      returnSpring: 2.4, returnRate: 110, damping: 0.5,
      camStiffness: 6e4, camDamping: 55, restStopK: 8e4, restStopC: 24,
    },
    impression: { setting: 0.5, strokeFraction: 0.95, riseMax: 0.50, riseMin: 0.32 },   // 0..1 shortens the cam rise (fractions of a turn) and so raises the throw speed

    interposer: {
      latchFraction: 0.58, rearmFraction: 0.22, blockFraction: 0.48, repeatFraction: 0.82,
      humpForce: 0.9, blockStiffness: 2.2e5, blockDamping: 25,
    },

    return: {
      targetSpeed: 1.05, maxForce: 24, gain: 90,   // m/s, N, N per (m/s)
      cushionZone: 0.014, cushionMinSpeed: 0.28,   // m from the margin over which the winding slows
      latchPhase: 0.12,                            // fraction of the op cycle after which the drive starts winding
      arrivalTolerance: 0.0008, arrivalSpeed: 0.05,
    },
    correction: {
      // Lift-off tape on the carrier: supply spool left of the ball, take-up right, carrier frame at carriageX = 0.
      supply: { x: -0.065, y: BALL_REST_Y + 0.010, z: -0.058, radiusFull: 0.013, radiusEmpty: 0.006 },
      takeup: { x: 0.062, y: BALL_REST_Y + 0.002, z: -0.058, radiusEmpty: 0.006 },
      tapeWidth: 0.0127, thickness: 0.00008, feedPerCorrection: 0.0015,
      restDrop: 0.0125, lift: 0.0125,             // tape centre below the print point at rest; travel of its fork to the print point
      standoff: 0.0012,                           // tape off the paper along the platen normal at the print point
      mass: 0.008, spring0: 1.0, springRate: 90, kCam: 2e4,
    },
    tab: {
      stopStiffness: 1.2e6, stopDamping: 800, arrivalSpeed: 0.04, holdFraction: 0.55,
      defaultStops: [],                            // column numbers
    },
  },

  universalBar: { mass: 0.018, spring: 3.0, springRate: 110, tripAtKeyFraction: 0.55 },

  escapement: {
    pitch: PITCH, toothDepth: 0.0011,
    looseEngageAt: 0.38, fixedReleaseAt: 0.62,
    looseSlack: 0.00035, looseSpring: 180,
    dogMass: 0.0009, dogSpring: 520, dogStop: 3.0e6, toothStiffness: 1.1e7, toothDamping: 2600,
  },

  carriage: {
    // The carrier, in the moving-carriage kinematics: carriageX is minus the carrier's world x offset.
    mass: 0.68, travel: 0.336, startX: 0.095,
    railViscous: 1.3, railCoulomb: 0.32, releaseBrake: 7,
    typingDirection: -1,
    marginLeftX: 0.0955, marginRightX: -0.0955,
    drawbandPreload: 6.2, drawbandRate: 8.5,
    stopStiffness: 1.8e6, stopDamping: 1500,
    shiftTravel: 0.0042, shiftSpring: 11, shiftSpringRate: 240,
  },

  lineSpace: {
    leverLength: 0.086, travel: 26 * deg, inertia: 3.2e-5, spring: 0.05, springRate: 0.09,
    pawlTeethPerSpace: [1, 2, 3], defaultSpace: 1,
  },

  bell: base.bell,

  paper: {
    ...base.paper,
    feedRollX: [-0.09, 0.09],
    tableLength: 0.22, tableWidth: 0.30,
  },

  ribbon: {
    ...base.ribbon,
    spoolX: 0.052, spoolY: 0.160, spoolZ: -0.03, spoolRadiusEmpty: 0.011, spoolWidth: 0.014,
    guidePostX: 0.026,
    vibrator: { restDrop: 0.0165, fullLift: 0.0165, upperBandFraction: 0.806, spring0: 1.2, springRate: 160 },   // ribbon rests below the print line and lifts only for the strike
  },

  finger: { vMax: 0.7, hillB: 0.8, attack: 0.008, release: 0.014 },
  condition: { seed: 1971, barSkewSigma: 0, barOffsetSigma: 0, leverageSigma: 0 },
};
