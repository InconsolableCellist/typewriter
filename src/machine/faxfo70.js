// The Sharp FO-70 facsimile of about 1999: a small Group 3 machine with a contact-image-sensor scanner fed from a
// five-sheet document table, a thermal head printing on a paper roll, an automatic cutter, a handset on the left and a
// telephone line. docs/fax/plan.md, docs/fax/research.md 8 and docs/fax/architecture.md.
//
// SI units; world axes as the other machines (x right, y up, z toward the operator, origin at the desk reference
// point). The body's local axes are the same way round, with the origin on the desk under the body's centre.
//
// Every value carries a mark, as the plan's (docs/fax/plan.md, "The one large caveat"):
//   [S] documented: a search summary that quoted a named document (research.md 2 and 8);
//   [M] typical: memory of machines of this class, not checked;
//   [A] assumed: a design default of ours.
// Nothing here is yet read at source: milestone M0 replaces each mark with a page of the service manual (S-70). Values
// derived from others say so and carry no mark of their own.
const deg = Math.PI / 180;
const MM = 0.001;

// ---- the body ------------------------------------------------------------------------------------------------------
// 304 W x 236 D x 122 H mm, about 2.6 kg [S: S-50-ZA for the FO-50, S-71 for the FO-51; the FO-70 with its cutter may
// differ by a few millimetres, A]. The handset lies along the left side on a moulded cradle, earpiece to the rear
// (the owner's photograph docs/fax/refs/owner/sharp_fo70_top.png); the overall height is the handset's top [A].
const SIZE = [0.304, 0.122, 0.236];
const HANDSET = [0.054, 0.042, 0.218];      // [A] from the photograph's proportions: about 18 % of the width
const CRADLE_H = SIZE[1] - HANDSET[1];       // the handset's top is the machine's top
// The colours of the owner's photograph: a lilac grey moulding and a cream panel overlay [A: photograph, faded].
const LILAC = 0xa7a2b6, CREAM = 0xd9d1b4;

export default {
  id: 'faxfo70',
  name: 'Sharp FO-70 facsimile, c. 1999',
  kind: 'fax',
  action: { type: 'thermal-fax' },
  // No recordings yet (plan 6): the mechanism's voices are synthesised placeholders (src/audio/fax-engine.js); no
  // sprite is fetched. No type slugs either.
  audio: { samples: false },
  glyphs: false,

  units: {
    body: { size: SIZE, mass: 2.6, place: { x: 0, z: -0.07 }, color: LILAC },
    // The handset on its cradle at the body's left, in the body's frame (origin on the cradle's top under its centre).
    handset: { size: HANDSET, mass: 0.17, on: 'body', at: [-SIZE[0] / 2 + HANDSET[0] / 2 + 0.006, CRADLE_H, 0.002], color: LILAC },
  },

  // The block-out (M0): named boxes in the body's frame, [min, max] in m, what src/kits/fax/blockout.js builds and the
  // views fall back on until the real model (src/render/fax/fo70-view.js) replaces them. All [A] from the photograph:
  // the cradle at the left, the cabinet with its sloping panel at the front right, the document table rising at the
  // rear, the paper compartment under the panel, which lifts to load the roll (research.md 8.5, [M]).
  blockout: {
    colors: { body: LILAC, panel: CREAM, handset: LILAC, display: 0x6f7a62, slot: 0x2a2830 },
    cradle: [[-0.152, 0, -0.118], [-0.090, CRADLE_H, 0.118]],
    cabinet: [[-0.090, 0, -0.118], [0.152, 0.082, 0.118]],
    panel: [[-0.086, 0.082, -0.030], [0.150, 0.096, 0.116]],          // the panel overlay, lifting with the cover
    display: [[-0.070, 0.096, -0.020], [0.020, 0.098, 0.004]],         // the 16-character LCD window [S: 16 digits]
    documentTable: [[-0.070, 0.082, -0.118], [0.140, 0.110, -0.040]],  // the sloping table and its guides at the rear
    documentSlot: [[-0.060, 0.084, -0.042], [0.130, 0.092, -0.030]],
    paperExit: [[-0.060, 0.050, 0.116], [0.130, 0.058, 0.120]],        // the printed strip leaves at the front [A]
    documentExit: [[-0.060, 0.012, 0.116], [0.130, 0.020, 0.120]],     // the scanned sheet below it [A]
    rollBay: [[-0.070, 0.020, -0.030], [0.140, 0.080, 0.100]],         // the roll lies loose under the panel [M]
    rear: [[-0.152, 0.010, -0.118], [0.152, 0.060, -0.114]],           // the jacks: LINE and TEL [S: TEL/LIU board]
  },

  deskLayout: {
    extent: { halfX: 0.75, halfZ: 0.55 },        // shadow frustum and contact-shade bounds
    // The cut pages fall in front of the machine, which has no tray [A]; they collect here, curled.
    receivedPile: { x: 0.05, z: 0.235 },
    // The documents to send, in a folder right of the machine (plan 5).
    documents: { x: 0.43, z: 0.10, yaw: -0.08 },
    // The card index of the correspondents' numbers (plan 3.2), left of the handset.
    cardIndex: { x: -0.40, z: 0.12, yaw: 0.12 },
    // The boxed 30 m spare roll behind the documents [S: FO-20PR, 30 m].
    spareRoll: { x: 0.40, z: -0.24 },
    // The telephone socket on the wall behind the desk, and the line cord to it.
    wallSocket: { x: -0.30, z: -0.56 },
    // The typewriters' banker's lamp, left behind the card index (decision 22).
    lamp: { x: -0.52, z: -0.30 },
    desk: { min: [-1, -0.74, -0.56], max: [1, 0, 0.64] },
    cablesOut: 'back',
  },

  cameras: {
    overview: { position: [0.0, 0.95, 1.55], target: [0.0, 0.06, -0.02] },
    operator: { position: [0.0, 0.52, 0.62], target: [0.0, 0.08, -0.04] },
  },
  defaultCamera: 'overview',

  // What the protocol stack is told the machine can do (plan, "Changes for the protocol work"; src/fax/t30/). The
  // firmware hands this table in; nothing in src/fax/ knows the FO-70.
  capabilities: {
    rates: [9600, 7200, 4800, 2400],             // [S] 9600 with fallback; V.29 and V.27ter [A: the standard mapping]
    coding: ['MH', 'MR'],                        // [S] MR, MH and Sharp's H2, which is not built
    resolutions: { standard: 3.85, fine: 7.7, superfine: 15.4 },   // lines/mm [S]
    halftoneLevels: 64,                          // [S]
    ecm: false, memory: false,                   // [A] none found (plan P10, risk 18)
  },

  mech: mechanism(),
};

// ---- the mechanism (docs/fax/architecture.md 3; plan 2) --------------------------------------------------------------
// One block per block of the service manual's mechanism chapter [S: S-70 contents]: the scanner frame (document feed),
// the drive unit (cutter model), the head frame unit with the platen and the roll, the cutter, the TEL/LIU board's
// relays and hook switch, and the operation panel.
function mechanism() {
  // Line pitches [S: 3.85, 7.7 and 15.4 lines/mm]. One motor step moves the document, or the paper, half a super-fine
  // line, so every resolution is a whole number of steps [A]: 8, 4 and 2 steps a line.
  const LINES_PER_MM = { standard: 3.85, fine: 7.7, superfine: 15.4 };
  const STEPS_PER_LINE = { standard: 8, fine: 4, superfine: 2 };
  const advancePerStep = MM / (LINES_PER_MM.superfine * STEPS_PER_LINE.superfine);   // m of paper per motor step

  // The drive motor: a small permanent-magnet can-stack stepper, 7.5 degrees a step [M]. Torques and inertias [A].
  const motor = {
    stepsPerRev: 48, holdingTorque: 0.04, detentTorque: 0.002, tauE: 0.8e-3,
    rotorInertia: 4e-7, viscous: 1.2e-4, coulomb: 5e-4,          // viscous: eddy and winding losses, ~0.15 of critical
  };
  const stepAngle = (2 * Math.PI) / motor.stepsPerRev;

  // Rollers [A]. The platen is the rubber roller under the head; the feed roller presses the document on the CIS glass;
  // the separation roller turns on a one-way clutch, so it can push a sheet but never hold one back [M].
  const platenRadius = 0.006, feedRadius = 0.008, separationRadius = 0.009;
  // Train ratios, motor turns per roller turn, derived so that one motor step is `advancePerStep` at the roller.
  const ratio = (R) => (R * stepAngle) / advancePerStep;

  const drive = {
    // The drive unit's layout. 'single-planetary': ONE stepper; a swing (planetary) gear on the motor pinion drops into
    // the scanning train when the motor turns forward and into the recording train when it turns back, so copy mode
    // cannot scan and print at once [M: the plan's hypothesis, research.md 8.5; ASSUMED until S-70's drive unit pages
    // are read]. Everything that depends on it lives in drive-mech.js and drive-ctl.js and reads it from here.
    layout: 'single-planetary',
    motor,
    stepsPerLine: STEPS_PER_LINE, linesPerMm: LINES_PER_MM, advancePerStep,
    planet: {
      // The swing arm: travel either side of centre, its inertia, the friction torque that drags it round with the
      // pinion, and its end stops, where the planet meshes [A].
      travel: 12 * deg, inertia: 3e-8, drag: 3e-4, dragSpeed: 5, viscous: 1e-7,
      stopStiffness: 4, stopDamping: 2e-4,
      // In mesh within meshWindow of a stop; once in, the teeth stay engaged until the arm has backed off meshRelease
      // (a tooth's depth), so the motor's ring at the end of a move does not lift the planet out [A].
      meshWindow: 2.5 * deg, meshRelease: 8 * deg,
      // The tooth load pushes a meshed planet into its train (a swing gear holds itself in mesh under load) [M].
      selfHold: 0.35,
    },
    // Forward motor rotation (+) drives the scanning train; reverse (-) the recording train, whose idler turns the
    // platen forward [A]. sign: roller rotation per motor rotation once meshed.
    scan: { ratio: ratio(feedRadius), sign: 1, inertia: 2.5e-6, bearingCoulomb: 3e-4, viscous: 2e-6,
      meshStiffness: 60, meshDamping: 0.012, backlash: 0.3 * deg },
    record: { ratio: ratio(platenRadius), sign: -1, inertia: 1.8e-6, bearingCoulomb: 2e-4, viscous: 2e-6,
      meshStiffness: 50, meshDamping: 0.01, backlash: 0.3 * deg },
    // Firmware (drive-ctl.js): step rates, steps/s [A]; hold current after a move, then off.
    startRate: 200, maxRate: 600, ramp: 4000, runCurrent: 1, holdCurrent: 0.5, holdTime: 0.05,
  };
  // Lost motion at a change of direction: the planet's swing, which follows the pinion turn for turn, plus the
  // train's backlash seen at the motor; the controller adds these steps first [derived, A].
  drive.changeoverSteps = Math.ceil((2 * drive.planet.travel + drive.record.backlash * drive.record.ratio) / stepAngle) + 1;

  // ---- scanner frame: the document path (plan 2) --------------------------------------------------------------------
  // Positions along the path in m, from the separation nip (0), the way the sheet travels [A].
  const feeder = {
    capacity: 5,                                 // sheets [S: up to 5 of 20 lb paper]
    path: { docSensor: -0.012, separation: 0, regSensor: 0.012, feed: 0.024, readLine: 0.032 },
    sheet: { width: 0.2159, length: 0.2794, grammage: 0.075 },      // a US letter sheet of 20 lb (75 g/m2) paper [A, decision 5]
    separationRadius, feedRadius,
    // The separation roller's surface runs slower than the feed roller's, on its one-way clutch: the feed roller pulls
    // a sheet through it, and the next sheet follows with a gap [M: the usual ADF design; ratio A].
    separationSpeed: 0.7,
    separationForce: 1.5, rollerMu: 1.0,         // N, separation roller on the sheet [A]; rubber on paper [M]
    padForce: 1.5, padMu: 0.6, sheetMu: 0.4,     // the separation pad holds back all but the bottom sheet [M, A]
    feedForce: 2.0, glassMu: 0.2,                // the feed roller presses the sheet on the CIS glass [A]
    slipSpeed: 1e-3,                             // m/s, regularisation of kinetic friction
    // Firmware (scan-ctl.js): from the registration sensor to the first line under the CIS, the longest pre-feed
    // before a misfeed, and the run-out after the trailing edge [A].
    regToRead: 0, maxPrefeedSteps: Math.round(0.06 / advancePerStep),
    ejectSteps: Math.round((0.024 - 0.012 + 0.004) / advancePerStep), maxSheetSteps: Math.round(0.45 / advancePerStep),
    pollPeriod: 0.01, debounce: 0.03,
  };
  // From the registration sensor to 2 mm past the read line: slowly on the separation roller to the feed roller, then
  // at the feed roller's speed [derived].
  const FP = feeder.path;
  feeder.regToRead = Math.round(((FP.feed - FP.regSensor) / feeder.separationSpeed + FP.readLine - FP.feed + 0.002) / advancePerStep);

  // ---- head frame unit, platen and roll ----------------------------------------------------------------------------
  const printer = {
    dots: 1728, dotsPerMm: 8, printWidth: 0.216,  // [S: 1728 at 8/mm; print width 210 mm by one summary, A: 216 for letter]
    platenRadius,
    headForce: 4.5, platenMu: 0.9, headMu: 0.15,  // N head on platen [A]; rubber on paper [M]; glaze on coating [A]
    strobeBlocks: 4,                              // dots strobed in blocks [S: ROHM data sheet format; count A]
    // The default mark rule when no thermal model is attached (src/fax/thermal/ plugs in; architecture.md 4.1): a dot
    // marks when its strobe energy reaches this, on the coated side only [A].
    markEnergy: 0.25e-3,                          // J a dot [A]
    roll: {
      width: 0.216, thickness: 65e-6, grammage: 0.052, coreRadius: 0.00635, coreMass: 0.004,   // [M] 1/2 in core
      starterLength: 10, spareLength: 30,         // m [S: 10 m starter, FO-20PR 30 m]
      warmRemaining: 7.5,                         // m left on the starter roll at a warm start [A, decision 18]
      drag: 3e-3, slipSpeed: 2e-3,                // N m of the roll turning loose in its bay [A]
    },
    // Along the strip beyond the head line, m [A]: the cutter, and the exit slot.
    cutterAt: 0.014, exitAt: 0.03,
    // Firmware (print-ctl.js) [A].
    strobeTime: 1.2e-3, pollPeriod: 0.01, debounce: 0.03,
  };

  // ---- cutter (cutter model) ---------------------------------------------------------------------------------------
  // An automatic cutter after the head [S]; its type and drive are not read. ASSUMED: a guillotine blade on an
  // eccentric cam, one turn a cut, turned through a self-locking worm by its own small DC motor, with a home switch on
  // the cam. (If S-70 shows the cutter taken off the main stepper, cutter-mech.js changes and nothing else.)
  const cutter = {
    motor: { resistance: 10, kt: 0.012, ke: 0.012, inertia: 5e-7, viscous: 2e-7, coulomb: 6e-4 },   // [A]
    volts: 12, ratio: 60, efficiency: 0.45, camInertia: 2e-5,          // worm, cam [A]
    cutWindow: [0.48, 0.66],                    // blade travel (0 up, 1 down) over which it meets the paper [A]
    cutTorque: 0.12,                            // N m at the cam while the blade shears 216 mm of paper [A]
    camFriction: 0.03,                          // N m at the cam: follower and blade guide [A]
    homeWindow: [-8 * deg, 45 * deg],           // the cam's home switch is made over this arc [A]
    brakeTime: 0.03, timeout: 1.5,              // firmware: dynamic brake after home, and a jam after this long [A]
  };

  // ---- TEL/LIU board: relays and the hook switch -------------------------------------------------------------------
  // [S: the board exists; contents M/A]. CML seizes the line for the machine; TEL switches the handset out while the
  // machine has the line [A]. Each relay is a small clapper armature.
  const relay = { travel: 0.5 * MM, gap0: 0.2 * MM, force: 1.5e-7, mass: 5e-4, preload: 0.15, rate: 300,
    tauE: 2e-3, stopStiffness: 2e5, stopDamping: 8, make: 0.8 };
  const liu = {
    relays: { cml: { ...relay }, tel: { ...relay } },
    // The hook plunger in the cradle, pressed down by the handset's weight [A].
    hook: { travel: 6 * MM, mass: 0.004, preload: 0.6, rate: 100, damping: 0.4, make: 4 * MM,
      stopStiffness: 2e4, stopDamping: 120, handsetMass: 0.17 },
    pollPeriod: 0.005, debounce: 0.02,
  };

  // ---- operation panel ---------------------------------------------------------------------------------------------
  // Keys named in the manuals [S], the rest from the sibling panels [A] and the owner's photograph. Each a stem on a
  // rubber dome with a carbon contact [M].
  const panel = {
    keys: [
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#',
      'rapid1', 'rapid2', 'rapid3', 'rapid4', 'rapid5',               // [S: 5 rapid keys]
      'speedDial', 'redial', 'holdSearch', 'speaker', 'resolution',  // [S]
      'function', 'volumeUp', 'volumeDown', 'copyHelp', 'start', 'stop',   // [A]
    ],
    labels: {
      speedDial: 'SPEED DIAL', redial: 'REDIAL', holdSearch: 'HOLD/SEARCH', speaker: 'SPEAKER',
      resolution: 'RESOLUTION/RECEPTION MODE', function: 'FUNCTION', volumeUp: 'VOLUME ▲', volumeDown: 'VOLUME ▼',
      copyHelp: 'COPY/HELP', start: 'START', stop: 'STOP',
    },
    // The dome's force against stem travel, piecewise linear [M: a typical 1.5 N dome with a 50 % snap].
    dome: [[0, 0.25], [0.0010, 1.5], [0.0018, 0.75], [0.0022, 0.9], [0.0025, 1.4]],
    travel: 0.0025, make: 0.0021, mass: 0.0015, damping: 0.08, bottomStiffness: 5e4, bottomDamping: 4,
    scanPeriod: 0.005, debounceScans: 2,          // firmware (panel-ctl.js) [A]
  };

  // ---- the roll cover: the operation panel lifts on its rear hinge to load paper and clear jams [M], past upright, so
  // it rests open on its stop [A] ---------------------------------------------------------------------------------
  const cover = { open: 95 * deg, inertia: 2.5e-3, gravityTorque: 0.12, latchTorque: 0.25, latchAngle: 3 * deg,
    viscous: 4e-3, coulomb: 4e-3, stopStiffness: 30, stopDamping: 0.3, headLiftAngle: 1.5 * deg };   // [A]

  return { drive, feeder, printer, cutter, liu, panel, cover };
}
