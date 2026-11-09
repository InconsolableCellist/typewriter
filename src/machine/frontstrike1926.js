// A generic open-frame front-strike manual, c. 1926. No specific make or model.
// SI units throughout. Coordinates: x right, y up, z toward the typist, origin at desk level
// under the machine centre. Every number the simulation or renderer uses lives here so a new
// machine is a new definition file, not new code.
const deg = Math.PI / 180;

export default {
  id: 'frontstrike1926',
  name: 'Open-frame front-strike, c. 1926',
  action: { type: 'typebar-frontstrike', shift: 'carriage' },

  platen: {
    radius: 0.0165, length: 0.24, center: [0, 0.172, -0.062],
    inertia: 1.6e-4,               // kg m^2 including knobs and ratchet
    bearingViscous: 2.5e-4,        // N m s/rad
    bearingCoulomb: 7e-3,          // N m
    rubberE: 3.2e7, rubberNu: 0.47, rubberDepth: 0.006, // hard, aged vulcanised rubber
    huntCrossleyAlpha: 0.55,       // s/m, rubber hysteresis
    detentNotches: 24, detentTorque: 0.075, // star wheel and roller, N m peak
    ratchetTeeth: 24, knobRadius: 0.024, knobOffset: 0.018,
    surfaceFriction: 0.85,
  },

  // Where the slug meets the platen: beta above horizontal, on the front of the cylinder.
  printPoint: { beta: 30 * deg },

  typebars: {
    length: 0.092, arcHalfAngle: 62 * deg,
    restPitch: -3 * deg,           // bar elevation at rest, centre bar
    barMass: 0.0095, slugMass: 0.0032, barWidth: 0.0028, barThickness: 0.0019,
    bearingCoulomb: 2.6e-3, bearingViscous: 6e-5,
    returnSpringTorque: 0.012, returnSpringRate: 0.005,   // N m, N m/rad
    restPadStiffness: 450, restPadDamping: 0.09,          // N m/rad, N m s/rad (felt)
    flex: { f1: 610, f2: 1830, q: 90 },                   // Hz, flexural ringing of the bar
    typeGuide: { engageBefore: 3.5 * deg, stiffness: 2.2e4, width: 0.0034, friction: 0.18 },
    // Sideways the bar is a tapered steel blade, deep at the root: about 200 Hz first lateral mode with the slug.
    lateralStiffness: 1.0e4, lateralQ: 18,
    // Lateral load on the tip racks the wire pivot in its bearing: arm ~ mu * (L / bearing width) * pin radius.
    pivotBindArm: 1.2e-2,
  },

  slug: {
    faceHeight: 0.0088, faceWidth: 0.0032, reliefDepth: 0.00035,
    caseOffset: 0.0042,            // distance between lower and upper case glyphs on the slug
    faceRadius: 0.0172,            // face ground concave to about the platen radius
    steelE: 2.0e11,
    foundationKPerM2: 4.0e11,      // Winkler stiffness of the ribbon/paper/rubber stack, N/m^3 (calibrated)
    bodyWidth: 0.0024,             // slug body behind the face, narrower than the type face (contacts between bars)
    noseRatio: 1.6,                // bevel length over half width of the slug body: 1 is round, larger is more pointed
  },

  linkage: {
    keyTravel: 0.018,
    // theta = thetaTravel * (coupled fraction) * shape(x / keyTravel). The bar is pulled by a
    // one-way link, so past `coupledFraction` of its arc it flies free and strikes ballistically.
    coupledFraction: 0.86, accelShape: 1.7, shapeLinear: 0.42,
    linkStiffness: 1.2e6, linkDamping: 1400,     // N/m and N s/m, referred to the key
    reboundBuffer: 2.5e-3, reboundLostMotion: 0.09, // N m s/rad, rad: leather buffer that stops a rebounding bar on a held key
  },

  // Key feel, measured on the integrated mechanism (tests/mech.test.js). 18 mm travel.
  //   travel    0.02  0.10  0.25  0.40  0.55  0.70  0.85  0.97
  //   down, N    5.7   6.3   7.7   8.6   9.5  13.2  15.0  14.7   (slow press, grab damping removed)
  //   up, N      4.6   5.1   6.4   7.2  10.1  11.6  12.5  10.5   (what the key pushes back with while returning)
  //   reflected mass at the key: 0.10 kg at rest, 0.35 at 25 %, 0.59 at 50 %, 0.84 at 75 %, 1.10 kg at the end
  // A finger force below about 20 N does not throw the bar to the platen. 22 N is a light stroke, 28 N is ordinary,
  // 40 N is a firm hit. The force is applied over the stroke, so a press must be held for about 90 ms.
  keys: {
    mass: 0.034, returnForce: 4.2, returnRate: 170, coulomb: 0.7, felt: { k: 3.0e5, c: 42 }, topRadius: 0.0078,
    stemHeight: 0.024, leverPivot: [0, 0.058, -0.012],
    rows: [
      { y: 0.133, z: 0.112, x0: -0.113, pitch: 0.0205, keys: ['2"','3#','4$','5%','6_','7&',"8'",'9(','0)','-*','=+'] },
      { y: 0.119, z: 0.134, x0: -0.103, pitch: 0.0205, keys: ['qQ','wW','eE','rR','tT','yY','uU','iI','oO','pP','/?'] },
      { y: 0.105, z: 0.156, x0: -0.098, pitch: 0.0205, keys: ['aA','sS','dD','fF','gG','hH','jJ','kK','lL',';:'] },
      { y: 0.091, z: 0.178, x0: -0.088, pitch: 0.0205, keys: ['zZ','xX','cC','vV','bB','nN','mM',',,','..'] },
    ],
    controls: [
      { id: 'space',         pos: [0.000, 0.078, 0.204], width: 0.150, travel: 0.010 },
      { id: 'shiftL',        pos: [-0.135, 0.092, 0.180], width: 0.030, travel: 0.016, returnForce: 9 },
      { id: 'shiftR',        pos: [0.135, 0.092, 0.180], width: 0.030, travel: 0.016, returnForce: 9 },
      { id: 'shiftLock',     pos: [-0.138, 0.106, 0.158], width: 0.022, travel: 0.016 },
      { id: 'backspace',     pos: [0.133, 0.133, 0.112], width: 0.022, travel: 0.013 },
      { id: 'marginRelease', pos: [-0.135, 0.133, 0.112], width: 0.022, travel: 0.010 },
    ],
  },

  universalBar: { mass: 0.018, spring: 2.6, springRate: 90, tripAtKeyFraction: 0.55 },

  escapement: {
    pitch: 0.00254,                // 10 characters per inch
    toothDepth: 0.0011,
    // Rocker position (0 rest, 1 full) where each dog crosses the rack. loose engages before
    // fixed leaves, so the carriage is always held unless the machine is out of adjustment.
    looseEngageAt: 0.38, fixedReleaseAt: 0.62,
    looseSlack: 0.00035, looseSpring: 180,
    dogMass: 0.0009, dogSpring: 520, dogStop: 3.0e6, toothStiffness: 1.1e7, toothDamping: 2600,
  },

  carriage: {
    mass: 2.05, travel: 0.235, startX: 0.095,   // positive x means the carriage is right of centre; typing decreases x
    railViscous: 2.2, railCoulomb: 0.55, releaseBrake: 9,
    typingDirection: -1,             // x moves this way as the carriage escapes; line start is x = startX
    marginLeftX: 0.0955, marginRightX: -0.0955,
    drawbandPreload: 4.6, drawbandRate: 9.5,    // N, N/m: the mainspring through its drawband
    stopStiffness: 1.8e6, stopDamping: 480,
    shiftTravel: 0.0042, shiftSpring: 11, shiftSpringRate: 240,
  },

  lineSpace: {
    leverLength: 0.086, travel: 26 * deg, inertia: 3.2e-5, spring: 0.05, springRate: 0.09,
    pawlTeethPerSpace: [1, 2, 3], defaultSpace: 1,
  },

  bell: { ringsBeforeRightMargin: 0.0165, hammerInertia: 4e-6, hammerSpring: 0.018, f0: 2730 },

  paper: {
    width: 0.2159, height: 0.2794, thickness: 0.0001, grammage: 0.075,
    bendingStiffness: 1.2e-4, feedRollAngle: [-120 * deg, -60 * deg], // measured from the print point, around the platen
    feedRollForce: 7.5, feedRollWidth: 0.05, feedRollX: [-0.068, 0.068], friction: 0.72,
    bailAngle: 60 * deg, bailTravel: 18 * deg, panClearance: 0.0012,   // contact angle past the print point; open/close travel of the bail DOF
    // Soft-body contact parameters (src/soft). Angles are measured from the print point in the feed direction.
    panArc: [-170 * deg, -40 * deg], panThickness: 0.0005, panFriction: 0.14,
    bailForce: 1.1, bailRollerWidth: 0.016, bailLiftAt: 0.12,  // N per roller; bail DOF at which it clears the sheet
    bailRollerRadius: 0.0052, bailRodRadius: 0.0032, bailGuideGap: 0.0004,  // m: rollers ride the sheet; apron gap ahead of the bail
    nipOpenAt: 0.35,               // paperRelease DOF value at which the feed rolls lift off the platen (0 closed)
    nipWedgeFraction: 0.18,        // fraction of nip force acting on a sheet edge that has only reached the wedge
    maxSheetSpeed: 2.0,            // m/s: fastest the nip band can carry the sheet; beyond it the rolls slip
    tableLength: 0.22, tableWidth: 0.25, tableFriction: 0.28, deskFriction: 0.34,
    perforationPressure: 1.58e8,   // Pa: local face pressure that punches through the sheet (fibre scatter +-5 %)
    inkHalfPressure: 3.6e7, inkPressureExponent: 2, perforationForce: 780,        // Pa: pressure giving half of the maximum ink transfer
    embossHalfPressure: 1.0e8,     // Pa
    fibreScale: 0.13,              // relative depth of paper fibre noise in the ink coverage
  },

  ribbon: {
    ink: 1,                        // multiplier on ink available across the ribbon (1 = fresh)
    width: 0.0127, thickness: 0.00011, length: 5.0,
    spoolX: 0.088, spoolY: 0.156, spoolZ: 0.0, spoolRadiusEmpty: 0.012, spoolWidth: 0.018,
    linearDensity: 0.0009, feedPerKey: 0.00042,
    vibrator: { restDrop: 0.0115, fullLift: 0.0115, liftStartKeyFraction: 0.18 },
    colourBands: ['black', 'red'],
    // Soft-body parameters (src/soft).
    guidePostX: 0.033, guidePostRadius: 0.0022, guidePostForward: 0.0065, forkCatch: { below: 0.0035, above: 0.008, halfWidth: 0.0055, maxSlack: 0.007 },
    standoff: 0.0009, axialStiffness: 420,         // N per unit strain
    spoolBrakeTorque: 0.0011, spoolDrag: 3.5,       // N m, N/(m/s) referred to the rim
    pawlFeedScale: 1,                               // ribbon metres per unit of ribbonPawlTravel
    depletionPerStrike: 0.075,      // fractional loss of ink at a texel for a nominal strike
    weaveThreadPitch: 0.00062,
  },

  // Calibrated Hill-type finger: peak force is reached at bottom-out (stationary), velocity-limited above.
  finger: { vMax: 0.7, hillB: 0.8, attack: 0.008, release: 0.014 },

  condition: { seed: 1926, barSkewSigma: 0.35 * deg, barOffsetSigma: 0.00006, leverageSigma: 0.035 },
};
