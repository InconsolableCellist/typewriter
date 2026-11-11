// A dedicated word-processing system of 1980: display station on its electronics module, a separate keyboard, a
// dual 8-inch diskette unit and a printwheel printer. Five bodies on the desk instead of one machine. SI units; world
// axes as the typewriters (x right, y up, z toward the typist, origin at the desk reference point). Each unit has
// local axes the same way round with its origin on the surface it stands on, under its centre.
// Sources: docs/displaywriter/hardware.md (HW) and printer.md (PR); design in docs/displaywriter/architecture.md.
// Milestone M0: units, placements and the desk layout only. The mechanisms arrive in later milestones.

const deg = Math.PI / 180;

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
};
