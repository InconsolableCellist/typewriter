// The Sharp FO-70 facsimile of about 1999: a small Group 3 machine with a contact-image-sensor scanner fed from a
// five-sheet document table, a thermal head printing on a paper roll, an automatic cutter, a handset on the left and a
// telephone line. docs/fax/plan.md, docs/fax/research.md 8 and docs/fax/architecture.md.
//
// SI units; world axes as the other machines (x right, y up, z toward the operator, origin at the desk reference
// point). The body's local axes are the same way round, with the origin on the desk under the body's centre.
//
// Every value carries a mark:
//   [S p.N]  documented: read in the owner's copy of the Sharp FO-50/FO-70 service manual, No. 00ZFO50RA/SME (c) 2000
//            (docs/fax/refs/sharp_fo70_service_manual.pdf, a ManualsLib print). N is the manual's own page, then the
//            PDF's page: p.3-7/pdf41. [S OM p.N]: the FO-10/FO-50/FO-70 operation manual's printed page. The fact
//            base is docs/fax/hardware.md;
//   [M] typical: memory of machines of this class, not in the manual;
//   [A] assumed: a design default of ours.
// Values derived from others say so and carry no mark of their own.
const deg = Math.PI / 180;
const MM = 0.001;

// ---- the body ------------------------------------------------------------------------------------------------------
// 304 W x 236 D x 122 H mm, approx. 2.6 kg [S p.1-1/pdf6, one figure for the FO-50 and FO-70]. The handset lies along
// the left side on its rest, cord to the left (the panel drawing p.1-2/pdf7 and the owner's photograph
// docs/fax/refs/owner/sharp_fo70_top.png); the overall height is the handset's top [A].
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
  // rear, the paper compartment under the operation panel, which lifts to load the roll [S p.1-6/pdf11].
  blockout: {
    colors: { body: LILAC, panel: CREAM, handset: LILAC, display: 0x6f7a62, slot: 0x2a2830 },
    cradle: [[-0.152, 0, -0.118], [-0.090, CRADLE_H, 0.118]],
    cabinet: [[-0.090, 0, -0.118], [0.152, 0.082, 0.118]],
    panel: [[-0.086, 0.082, -0.030], [0.150, 0.096, 0.116]],          // the panel overlay, lifting with the cover
    display: [[-0.070, 0.096, -0.020], [0.020, 0.098, 0.004]],         // the 16-digit LCD window [S p.1-1]
    documentTable: [[-0.070, 0.082, -0.118], [0.140, 0.110, -0.040]],  // the sloping table and its guides at the rear
    documentSlot: [[-0.060, 0.084, -0.042], [0.130, 0.092, -0.030]],
    paperExit: [[-0.060, 0.050, 0.116], [0.130, 0.058, 0.120]],        // the printed strip leaves at the front [A]
    documentExit: [[-0.060, 0.012, 0.116], [0.130, 0.020, 0.120]],     // the scanned sheet below it [A]
    rollBay: [[-0.070, 0.020, -0.030], [0.140, 0.080, 0.100]],         // the roll lies in the compartment, its shaft's ends in notches [S p.1-6]
    rear: [[-0.152, 0.010, -0.118], [0.152, 0.060, -0.114]],           // the TEL. LINE socket [S p.1-5]; the TEL/LIU PWB also has an external TEL jack and the handset jack [S p.4-2]
  },

  deskLayout: {
    extent: { halfX: 0.75, halfZ: 0.55 },        // shadow frustum and contact-shade bounds
    // The cut pages fall in front of the machine, which has no tray [A]; they collect here, curled.
    receivedPile: { x: 0.05, z: 0.235 },
    // The documents to send, in a folder right of the machine (plan 5).
    documents: { x: 0.43, z: 0.10, yaw: -0.08 },
    // The card index of the correspondents' numbers (plan 3.2), left of the handset.
    cardIndex: { x: -0.40, z: 0.12, yaw: 0.12 },
    // The boxed 30 m spare roll behind the documents [S p.1-1: FO-20PRw, 30 m].
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
    // 9600 bps with automatic fallback [S p.1-1]; the FM209 modem: V.29 at 9600 and 7200, V.27ter at 4800 and 2400,
    // V.21 channel 2 at 300 [S p.5-6/pdf57; soft switch SW-A2 p.2-5/pdf20 and signal send mode p.2-3/pdf18].
    rates: [9600, 7200, 4800, 2400],
    coding: ['MH', 'MR'],                        // [S p.1-1: MR, MH and Sharp's H2; H2 is Sharp-to-Sharp only, not built]
    resolutions: { standard: 3.85, fine: 7.7, superfine: 15.4 },   // lines/mm; halftone at fine [S p.1-1]
    halftoneLevels: 64,                          // [S p.1-1]
    // No ECM: none in the specification, the protocol chart (p.7-1/pdf79) has no PPS or RR, and the 256 kbit SRAM is
    // "line memory ... used as the transmission buffer" [S p.5-2/pdf53]. No page memory for the same reason.
    ecm: false, memory: false,
  },

  // The market (decision 24). This manual is for the FO-50RA / FO-70RA [S cover]; mains 220-240 V AC 50/60 Hz
  // [S p.1-1]. The firmware (ROM FZL0 for the FO-70, p.2-2/pdf17) sets its line parameters by a country select in the
  // diagnostic mode; the countries it offers are below, code as printed [S p.2-4/pdf19]. The manual gives no line
  // parameters per country, and no North American setting.
  market: {
    model: 'FO-70RA', rom: 'FZL0', mains: '220-240 V AC, 50/60 Hz',
    countrySelect: [
      ['HONG KONG', 'HK'], ['INDIA', 'IN'], ['MALAYSIA', 'MY'], ['RUSSIAN', 'RA'], ['SINGAPORE', 'SG'],
      ['SOUTH AFRICA', 'ZA'], ['TAIWAN', 'AU'], ['THAILAND', 'TH'], ['GENERAL AREA', 'GRU'], ['GENERAL AREA', 'GRH'],
      ['AUSTRALIA', 'A'], ['CHINA', 'CN'],
    ],
  },

  mech: mechanism(),
};

// ---- the mechanism (docs/fax/architecture.md 3; docs/fax/hardware.md 4) ----------------------------------------------
// One block per block of the service manual: the drive unit (cutter model) with its one pulse motor, the scanner frame
// (document feed), the head frame unit with the platen and the roll, the cutter, the TEL/LIU board's line relay and hook
// switch, and the operation panel, which is also the cover over the paper compartment.
function mechanism() {
  // Line pitches [S p.1-1: 3.85, 7.7 and 15.4 lines/mm]. The manual gives no step count: "fed a specified number of
  // pulses" [p.3-1]. One motor step moves the document, or the paper, half a super-fine line, so every resolution is a
  // whole number of steps [A]: 8, 4 and 2 steps a line.
  const LINES_PER_MM = { standard: 3.85, fine: 7.7, superfine: 15.4 };
  const STEPS_PER_LINE = { standard: 8, fine: 4, superfine: 2 };
  const advancePerStep = MM / (LINES_PER_MM.superfine * STEPS_PER_LINE.superfine);   // m of paper per motor step

  // The drive motor, RMOTZ2148XHZZ: a flat can-stack pulse motor on the motor plate [S p.3-7/pdf41 fig. 5, parts list
  // p.6/pdf94], unipolar, its four windings switched to ground by a ULN2003A from the phases TPA and TPB and their
  // complements, common VMT = +24 V through IC protector FU100 [S p.6-5/pdf68, p.4-3/pdf51, p.2-1/pdf16]: two phases on,
  // full steps. Its step angle is not given: 7.5 degrees [M]. Torques and inertias [A].
  const motor = {
    stepsPerRev: 48, holdingTorque: 0.04, detentTorque: 0.002, tauE: 0.8e-3,
    rotorInertia: 4e-7, viscous: 1.2e-4, coulomb: 5e-4,          // viscous: eddy and winding losses, ~0.15 of critical
  };
  const stepAngle = (2 * Math.PI) / motor.stepsPerRev;

  // Rollers. The document path has ONE driven feed roller, against a separation rubber, and the white back roller over
  // the CIS, driven through its own gear [S p.3-1/pdf35 fig. 1, scanner unit parts p.3/pdf90]; the recording path the
  // platen roller under the head [S p.3-2/pdf36]. Radii [A]. Here `separationRadius` is the feed roller and
  // `feedRadius` the back roller (the names of the first draft; the parts are the manual's).
  const platenRadius = 0.006, feedRadius = 0.008, separationRadius = 0.009;
  // Train ratios, motor turns per roller turn, derived so that one motor step is `advancePerStep` at the roller. The
  // tooth counts are documented [S fig. 5 and fig. 2: reduction gears 17/30Z (two), 17/36Z, 17/43Z, idlers 25Z (three)
  // and 30Z in the drive unit; 17/28Z and 17/23Z in the scanner frame; the platen, back roller and PO gears], but not
  // the pinion's or the rollers' gears, nor the path, so the ratios stay derived from the radii.
  const ratio = (R) => (R * stepAngle) / advancePerStep;
  // The cutter: one turn of its crank (the cutter plate) per cut; motor steps a turn [A].
  const CUT_STEPS = 240;

  const drive = {
    // 'single-planetary': ONE motor, the "TX/RX MOTOR" [S p.4-1/pdf49, p.4-2/pdf50; one motor in each drive unit
    // parts list p.5, p.6/pdf93-94]. Its planet levers A and B (and C, cutter model only) carry planet gears on friction
    // springs [S fig. 5 detail], a mode lever with its own planet and a cam gear with a cam switch [S fig. 5]. Our
    // reading (drive-mech.js): forward rotation swings a planet into the scanning train, reverse into the recording
    // side, where the mode cam lets in the platen or the cutter [A]. The cam's drive is not described.
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
    // The mode lever and cam [S p.3-7: the parts; A: the rule]: a swing that gets past kickAt of the way toward the scanning
    // side, and back without reaching it, steps the cam. The controller's jog: jogSteps forward, then back with
    // returnSteps to spare.
    mode: { kickAt: 0.4, jogSteps: 2, returnSteps: 3 },
    // Forward motor rotation (+) drives the scanning train; reverse (-) the recording side, whose idler turns the
    // platen (or the cutter crank) forward [A]. sign: roller rotation per motor rotation once meshed.
    scan: { ratio: ratio(feedRadius), sign: 1, inertia: 2.5e-6, bearingCoulomb: 3e-4, viscous: 2e-6,
      meshStiffness: 60, meshDamping: 0.012, backlash: 0.3 * deg },
    record: { ratio: ratio(platenRadius), sign: -1, inertia: 1.8e-6, bearingCoulomb: 2e-4, viscous: 2e-6,
      meshStiffness: 50, meshDamping: 0.01, backlash: 0.3 * deg },
    cut: { ratio: CUT_STEPS / motor.stepsPerRev, sign: -1, inertia: 6e-6, bearingCoulomb: 2e-4, viscous: 4e-6,
      meshStiffness: 60, meshDamping: 0.012, backlash: 0.5 * deg },
    // Firmware (drive-ctl.js): step rates, steps/s [A]; hold current after a move, then off. The FC200 runs a 5 ms
    // scan line and a 10 ms recording line at best [S p.5-2/pdf53, p.3-2/pdf36]: 20 mm/s of document at fine, 13 mm/s
    // of paper; 600 steps/s is 19.5 mm/s.
    startRate: 200, maxRate: 600, ramp: 4000, runCurrent: 1, holdCurrent: 0.5, holdTime: 0.05,
  };
  // Lost motion at a change of direction: the planet's swing, which follows the pinion turn for turn, plus the
  // train's backlash seen at the motor; the controller adds these steps first [derived, A].
  drive.changeoverSteps = Math.ceil((2 * drive.planet.travel + drive.record.backlash * drive.record.ratio) / stepAngle) + 1;

  // ---- scanner frame: the document path ------------------------------------------------------------------------------
  // [S p.3-1/pdf35]: the document laid in the hopper trips the FRONT sensor (FRSNS, scanner frame), which starts the
  // motor; the feed roller, against the separation rubber plate pressed by its spring, takes the bottom sheet, and the
  // feed stops when the DOCUMENT sensor (ORGSNS, a switch on the operation panel PWB, p.6-15/pdf78) sees the leading
  // edge; reading begins a set number of pulses later, and ends a set number after the trailing edge clears it. Here
  // `docSensor` is the front sensor and `regSensor` the document sensor. Positions along the path in m, from the
  // separation rubber's nip (0), the way the sheet travels [A].
  const feeder = {
    capacity: 5,                                 // sheets [S p.1-1, p.1-3: 5 of 20 lb; the paper table says 10, p.3-1]
    path: { docSensor: -0.012, separation: 0, regSensor: 0.012, feed: 0.024, readLine: 0.032 },
    // Documents 148-216 mm wide, 140-297 mm long by the feeder (600 mm by hand), 52-80 g/m2 [S p.1-1, p.1-3]. The
    // default sheet is US letter [A, decision 5]; this market's would be A4 (210 x 297) [S p.1-3 lists both].
    sheet: { width: 0.2159, length: 0.2794, grammage: 0.075 },
    separationRadius, feedRadius,
    // The back roller's surface runs faster than the feed roller's [A: the scanner frame's two reduction gears, 17/28Z
    // and 17/23Z, p.3-4/pdf38, allow it], so a sheet is drawn away from the next, which the separation rubber holds.
    separationSpeed: 0.7,
    separationForce: 1.5, rollerMu: 1.0,         // N, feed roller on the sheet [A]; rubber on paper [M]
    padForce: 1.5, padMu: 0.6, sheetMu: 0.4,     // the separation rubber holds back all but the bottom sheet [S part; A values]
    feedForce: 2.0, glassMu: 0.2,                // the back roller presses the sheet on the CIS (CIS springs, p.3-4) [A values]
    slipSpeed: 1e-3,                             // m/s, regularisation of kinetic friction
    // Firmware (scan-ctl.js): from the document sensor to the first line under the contact image sensor, the longest
    // pre-feed before a misfeed, and the run-out after the trailing edge [A].
    regToRead: 0, maxPrefeedSteps: Math.round(0.06 / advancePerStep),
    ejectSteps: Math.round((0.024 - 0.012 + 0.004) / advancePerStep), maxSheetSteps: Math.round(0.45 / advancePerStep),
    pollPeriod: 0.01, debounce: 0.03,
  };
  // From the document sensor to 2 mm past the read line: slowly on the feed roller to the back roller, then at the back
  // roller's speed [derived].
  const FP = feeder.path;
  feeder.regToRead = Math.round(((FP.feed - FP.regSensor) / feeder.separationSpeed + FP.readLine - FP.feed + 0.002) / advancePerStep);

  // ---- head frame unit, platen and roll ----------------------------------------------------------------------------
  const printer = {
    // 1728 heat elements in one row, 8 dots/mm, max. 10 ms a line [S p.3-2/pdf36]; effective printing width 210 mm max.
    // [S p.1-1]. The head's supply VTH is +24 V, switched by relay RY1 on the control PWB (VTHON) [S p.6-5/pdf68].
    dots: 1728, dotsPerMm: 8, printWidth: 0.210,
    platenRadius,
    headForce: 4.5, platenMu: 0.9, headMu: 0.15,  // N head on platen, by head springs 1 (three) and 2 (two) [S p.3-11; values A]
    // Four strobes: the FC200 drives a "4 STROBE TPH" and the head cable carries STRB1-STRB4 [S p.5-2/pdf53,
    // p.4-3/pdf51]. (The mechanism chapter says the head is "divided into nine segments" for low power, p.3-2.)
    strobeBlocks: 4,
    // The default mark rule when no thermal model is attached (src/fax/thermal/ plugs in; architecture.md 4.1): a dot
    // marks when its strobe energy reaches this, on the coated side only [A].
    markEnergy: 0.25e-3,                          // J a dot [A]
    roll: {
      // Sharp's paper, the starter roll included, is 216 mm wide; 210 mm paper takes the roll shims [S p.1-6/pdf11].
      // FO-20PRw: 30 m on a 12.7 mm core [S OM p.1]; thickness, grammage and core mass [M].
      width: 0.216, thickness: 65e-6, grammage: 0.052, coreRadius: 0.00635, coreMass: 0.004,
      starterLength: 10, spareLength: 30,         // m [S p.1-1: 10 m starter, FO-20PRw 30 m]
      warmRemaining: 7.5,                         // m left on the starter roll at a warm start [A, decision 18]
      drag: 3e-3, slipSpeed: 2e-3,                // N m of the roll turning loose in its compartment [A]
    },
    // Along the strip beyond the head line, m [A]: the cutter, and the exit (on the FO-70 a driven PO roller with two
    // pinch rollers follows the cutter, p.3-9, p.3-10/pdf43-44).
    cutterAt: 0.014, exitAt: 0.03,
    // Firmware (print-ctl.js) [A].
    strobeTime: 1.2e-3, pollPeriod: 0.01, debounce: 0.03,
  };

  // ---- cutter (cutter model) ---------------------------------------------------------------------------------------
  // [S p.3-7/pdf41, p.3-9/pdf43]: no motor of its own. The drive's planet lever C turns the cutter gear (with its
  // spring) and the cutter plate, a crank whose pin works the cutter arm (with its spring) on the cutter unit; the
  // cutter switch (CNCUT, CUTI) reads the crank's home. The cutter unit is a precision part not to be taken apart. The
  // numbers are ours [A]: one crank turn a cut, the blade closing on the first half turn.
  const cutter = {
    cutWindow: [0.48, 0.66],                    // blade travel (0 open, 1 closed) over which it meets the paper [A]
    cutTorque: 0.02,                            // N m at the crank while the blade shears 216 mm of paper [A]
    camFriction: 0.004,                         // N m at the crank: arm, spring and blade guide [A]
    homeWindow: [-8 * deg, 45 * deg],           // the cutter switch is made over this arc of the crank [A]
    maxSteps: Math.round(1.5 * CUT_STEPS),      // firmware: no home within a turn and a half is a jam [A]
  };

  // ---- TEL/LIU board: the line relay and the hook switch -----------------------------------------------------------
  // ONE relay, CML: "line connecting relay and DP generating relay", H line made [S p.5-9, p.5-10/pdf60-61; part
  // RRLYZ3427SCZZ, TEL/LIU parts p.11/pdf98]. The handset is switched by TELMUTE and the other analogue gates, not by a
  // relay. (The control PWB's relay RY1 switches the head's supply, p.6-5.) Its armature [A].
  const relay = { travel: 0.5 * MM, gap0: 0.2 * MM, force: 1.5e-7, mass: 5e-4, preload: 0.15, rate: 300,
    tauE: 2e-3, stopStiffness: 2e5, stopDamping: 8, make: 0.8 };
  const liu = {
    relays: { cml: { ...relay } },
    // The hook switch is on the TEL/LIU PWB (QSW-Z2263XHZZ), worked from the handset rest by the hook switch lever and
    // the hook switch joint lever [S p.3-3/pdf37, p.3-12/pdf46]; travel and forces [A].
    hook: { travel: 6 * MM, mass: 0.004, preload: 0.6, rate: 100, damping: 0.4, make: 4 * MM,
      stopStiffness: 2e4, stopDamping: 120, handsetMass: 0.17 },
    pollPeriod: 0.005, debounce: 0.02,
  };

  // ---- operation panel ---------------------------------------------------------------------------------------------
  // 27 keys, every one on the panel drawing p.1-2/pdf7 and in the key matrix of the operation panel PWB, p.6-15/pdf78:
  // eight scan lines SEN0-SEN7 by four returns KEN1A-KEN4A (SEN7, the answering machine's REC REPEAT PLAY DELETE, is
  // not fitted). ONE VOLUME key. The rapid keys are A-E, the last marked E/POLL. Each a stem on a rubber dome [M].
  const panel = {
    keys: [
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#',
      'rapid1', 'rapid2', 'rapid3', 'rapid4', 'rapid5',
      'speedDial', 'redial', 'holdSearch', 'speaker', 'resolution',
      'function', 'volume', 'copyHelp', 'start', 'stop',
    ],
    labels: {
      speedDial: 'SPEED DIAL', redial: 'REDIAL', holdSearch: 'HOLD/SEARCH', speaker: 'SPEAKER',
      resolution: 'RESOLUTION/RECEPTION MODE', function: 'FUNCTION', volume: 'VOLUME',
      copyHelp: 'COPY/HELP', start: 'START', stop: 'STOP', rapid5: 'E/POLL',
    },
    // The key matrix [S p.6-15]: row (scan line) and column, as drawn.
    matrix: {
      SEN0: [null, '1', '2', '3'], SEN1: ['volume', '4', '5', '6'], SEN2: ['function', '7', '8', '9'],
      SEN3: ['resolution', '*', '0', '#'], SEN4: ['rapid1', 'rapid2', 'rapid3', 'rapid4'],
      SEN5: ['rapid5', 'start', 'stop', 'copyHelp'], SEN6: ['redial', 'speedDial', 'holdSearch', 'speaker'],
    },
    // The dome's force against stem travel, piecewise linear [M: a typical 1.5 N dome with a 50 % snap].
    dome: [[0, 0.25], [0.0010, 1.5], [0.0018, 0.75], [0.0022, 0.9], [0.0025, 1.4]],
    travel: 0.0025, make: 0.0021, mass: 0.0015, damping: 0.08, bottomStiffness: 5e4, bottomDamping: 4,
    scanPeriod: 0.005, debounceScans: 2,          // firmware (panel-ctl.js) [A]
  };

  // ---- the operation panel as the cover: it is grasped by its finger hold and lifted to load paper and clear jams; the
  // door sensor (DRSNS) reads it shut; two panel lock levers hold it [S p.1-5 to 1-8/pdf10-13, p.4-3, p.3-10]. The head
  // stays on the platen: paper is pushed through the slot by hand [S p.1-6], so lifting the panel does not lift it.
  // Angles and torques [A].
  const cover = { open: 95 * deg, inertia: 2.5e-3, gravityTorque: 0.12, latchTorque: 0.25, latchAngle: 3 * deg,
    viscous: 4e-3, coulomb: 4e-3, stopStiffness: 30, stopDamping: 0.3, liftsHead: false, headLiftAngle: 1.5 * deg };

  return { drive, feeder, printer, cutter, liu, panel, cover };
}
