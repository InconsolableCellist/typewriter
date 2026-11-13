// What stands on the documentation shelf beside the desk, and where: IBM's training materials for the Displaywriter
// with Textpack 4 and Reportpack, from the list in the Operator Reference Guide (S544-2036-0, TNL SN44-2075, pp. 1-3
// and 1-4). Pure data and arithmetic, no three.js and no DOM, so the contents and the fit are tested in Node
// (tests/wp_shelf.test.js); src/render/wp/shelf.js builds it.

/** The scans on bitsavers: IBM's copyright, so the viewer loads them from there and nothing is copied to this site. */
export const SCAN_BASE = 'https://bitsavers.org/pdf/ibm/6580_Displaywriter/';

/** The grey 3-ring binders of the list: ring size -> IBM's order number for the empty binder, and its spine, m. */
export const BINDERS = {
  '1': { order: 'S544-2072', spine: 0.040 },
  '1 easel': { order: 'S544-0881', spine: 0.040 },
  '1-1/2': { order: 'S544-0750', spine: 0.052 },
  '2': { order: 'S544-0887', spine: 0.064 },
};
/** A letter-size 3-ring binder standing up: height and depth (board width), m. */
export const BINDER = { h: 0.292, d: 0.265 };

/**
 * The manuals, each in its own grey binder. `title` the spine's lines; `pack` 'Textpack 4', 'Reportpack' or both, or
 * null for the common materials; `ring` a key of BINDERS (the list's own binder where it says, else a plausible one);
 * `scan` the file in SCAN_BASE (or a full URL), or null where no scan is known.
 */
export const SHELF_BINDERS = [
  // Textpack 4
  { id: 'tb1', order: 'S544-2034', title: ['Operator Training Book 1', 'Basic Topics'], pack: 'Textpack 4', ring: '2', scan: 'Displaywriter_Operator_Training_Book_1.pdf' },
  { id: 'tb2', order: 'S544-2035', title: ['Operator Training Book 2', 'Selectable Topics'], pack: 'Textpack 4', ring: '1-1/2', scan: 'S544-2035-0_IBM_Displaywriter_Operator_Training_Book_2_Selectable_Topics_Textpack_4_Feb82.pdf' },
  { id: 'pmg', order: 'S544-2122', title: ['Prompts and Messages Guide'], pack: 'Textpack 4/Reportpack', ring: '1 easel', scan: null },
  { id: 'wsp', order: 'S544-2037', title: ['Work Station Procedures Guide'], pack: 'Textpack 4', ring: '1', scan: 'S544-2037-0_IBM_Displaywriter_Work_Station_Procedures_Guide_Textpack_4_Feb82.pdf' },
  { id: 'index', order: 'S544-2098', title: ['Master Index'], pack: 'Textpack 4/Reportpack', ring: '1', scan: null },
  // Reportpack
  { id: 'tbr', order: 'S544-2030', title: ['Operator Training Book'], pack: 'Reportpack', ring: '2', scan: null },
  { id: 'wspr', order: 'S544-2033', title: ['Work Station Procedures Guide'], pack: 'Reportpack', ring: '1', scan: null },
  { id: 'files', order: 'S544-2031', title: ['Guide to Files Design and Use'], pack: 'Reportpack', ring: '1', scan: null },
  // Common to every system
  // The Printer Guide's scan (S544-0861-4, May 1983) is in bitsavers' pdf/ibm/5215/, but its file name is not recorded
  // in docs/displaywriter, so it gets no link until someone checks it.
  { id: 'pg', order: 'S544-0861', title: ['Printer Guide'], pack: null, ring: '1-1/2', scan: null },
  { id: 'ossc', order: 'S544-0874', title: ['Office Systems Support', 'Center Guide'], pack: null, ring: '1', scan: null },
  { id: 'pdg', order: 'S544-0860', title: ['Problem Determination Guide'], pack: null, ring: '1', scan: null },
  { id: 'pdg5218', order: 'S544-2000', title: ['5218 Printwheel Printer', 'Problem Determination Guide'], pack: null, ring: '1', scan: null },
];

/** The binder on the diskette unit (src/render/wp/manual.js), part of the same set. */
export const DESK_BINDER = { id: 'org', order: 'S544-2036', title: ['Operator Reference Guide'], pack: 'Textpack 4/Reportpack', ring: '1-1/2', scan: 'S544-2036-0_IBM_Displaywriter_Operator_Reference_Guide_Textpack_4_Reportpack_Feb82.pdf' };

/** The loose items of the list, on the shelves and the top. `name` for the hover label. */
export const SHELF_LOOSE = [
  { id: 'train', order: 'S544-2082', name: 'Training Diskette TRAIN, Textpack 4', kind: 'diskette', label: 'TRAIN' },
  { id: 'haster', order: 'S544-2083', name: 'Training Diskette HASTER, Textpack 4', kind: 'diskette', label: 'HASTER' },
  { id: 'report', order: 'S544-2110', name: 'Reportpack Training Diskette REPORT', kind: 'diskette', label: 'REPORT' },
  { id: 'memory', order: 'S544-0877', name: 'Memory Record Diskette', kind: 'diskette', label: 'MEMORY RECORD' },
  { id: 'holder', order: 'S544-0880', name: 'Vinyl Diskette Holder', kind: 'holder' },
  { id: 'tent', order: 'S544-2075', name: 'Training Tent Card', kind: 'tent' },
  { id: 'ruler', order: 'S544-2071', name: 'Conversion Ruler', kind: 'ruler' },
  { id: 'kt4', order: 'S544-2085', name: 'Textpack 4 Keyboard Template', kind: 'template', pack: 'Textpack 4' },
  { id: 'krp', order: 'S544-2084', name: 'Reportpack Keyboard Template', kind: 'template', pack: 'Reportpack' },
  { id: 'bypass', order: 'S544-2131', name: 'Menu Bypass Abbreviation Card', kind: 'bypass' },
  { id: 'asm4', order: 'S544-2101', name: 'Assembly Card, Textpack 4', kind: 'assembly', pack: 'Textpack 4' },
  { id: 'asmr', order: 'S544-2111', name: 'Reportpack Assembly Card', kind: 'assembly', pack: 'Reportpack' },
  { id: 'dividers', order: 'S544-0879', name: 'Divider Cards', kind: 'divider' },
  { id: 'indexdiv', order: 'S544-2132', name: 'Divider Card for Index', kind: 'divider', tab: 'Index' },
  { id: 'labels', order: 'S544-2016', name: 'Program Diskette (Duplicate) Labels', kind: 'labels' },
];

/** The scan's URL for an item, or null. */
export function scanUrl(item) {
  if (!item.scan) return null;
  return /^https:\/\//.test(item.scan) ? item.scan : SCAN_BASE + item.scan;
}

/** The hover label: what it is, and whether a click reads it. */
export function shelfLabel(item) {
  if (item.title) {
    const name = `${item.title.join(', ')}${item.pack ? ` (${item.pack})` : ''} · ${item.order}`;
    return scanUrl(item) ? `${name} · read the scanned copy` : `${name} · no scan available`;
  }
  return `${item.name} · ${item.order}`;
}

/** The viewer's title for a binder. */
export function viewerTitle(item) {
  return `IBM Displaywriter System ${item.title.join(', ')}${item.pack ? `, ${item.pack}` : ''} (${item.order})`;
}

// ---- the bookcase -------------------------------------------------------------------------------------------------

/**
 * A low two-shelf office bookcase in painted steel, its local origin on the floor under the middle of its footprint,
 * front toward +z. Sizes, m: outside width, depth and the sheet thicknesses; each bay holds a standing binder with a
 * hand's room above it.
 */
export const CASE = (() => {
  const c = { w: 0.80, d: 0.32, side: 0.018, board: 0.019, back: 0.008, plinth: 0.07, bay: 0.335 };
  c.inner = c.w - 2 * c.side;
  c.bays = [c.plinth + c.board, c.plinth + 2 * c.board + c.bay];   // the floors of the lower and upper bay
  c.h = c.plinth + 3 * c.board + 2 * c.bay;                         // the top
  return c;
})();

/** Which binders stand in which bay, left to right; the last of each row leans on its neighbour. */
export const BAYS = [
  ['pg', 'pdg', 'pdg5218', 'ossc'],                                    // lower: the common guides
  ['tb1', 'tb2', 'pmg', 'wsp', 'index', 'tbr', 'wspr', 'files'],        // upper: Textpack 4, then Reportpack
];
const LEAN = 0.14;                      // rad, the end binder against its neighbour

/**
 * The binders' poses in the case's frame: { id, bay, x, y, z, tilt, yaw, w } with (x, y, z) the middle of the
 * binder's foot (y the bay's floor, or a little above it for one that leans), tilt its turn about z (positive leans
 * left), w its spine width. Small deterministic variety: a hair of tilt, some pulled forward or pushed back.
 */
export function binderPoses() {
  const byId = Object.fromEntries(SHELF_BINDERS.map((b) => [b.id, b]));
  const out = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  BAYS.forEach((ids, bay) => {
    let x = -CASE.inner / 2 + 0.004;
    const y = CASE.bays[bay];
    ids.forEach((id, i) => {
      const w = BINDERS[byId[id].ring].spine;
      const zFront = CASE.d / 2 - 0.014 - rnd() * 0.012;
      const z = zFront - BINDER.d / 2, yaw = (rnd() - 0.5) * 0.03;
      if (i === ids.length - 1) {
        // Rests on its bottom left edge, its top left corner against the neighbour's right face.
        const xp = x + 0.001 + BINDER.h * Math.sin(LEAN);
        out.push({ id, bay, w, x: xp + (w / 2) * Math.cos(LEAN), y: y + (w / 2) * Math.sin(LEAN), z, tilt: LEAN, yaw });
        x = xp + w * Math.cos(LEAN);
      } else {
        const tilt = (rnd() - 0.5) * 0.008;
        out.push({ id, bay, w, x: x + w / 2, y: y + Math.abs(Math.sin(tilt)) * w / 2, z, tilt, yaw });   // on its lower corner
        x += w + 0.0015;
      }
    });
  });
  return out;
}

/** The corners (x, y) of a binder pose's front outline in the case frame, for the fit tests. */
export function binderOutline(p) {
  const c = Math.cos(p.tilt), s = Math.sin(p.tilt);
  return [[-p.w / 2, 0], [p.w / 2, 0], [p.w / 2, BINDER.h], [-p.w / 2, BINDER.h]].map(([u, v]) => [p.x + u * c - v * s, p.y + u * s + v * c]);
}

/**
 * The loose items' places in the case frame: { id, at: [x, y, z], yaw, size: [w, t, d] } lying flat (w across, t
 * thick, d front to back), except the tent card, which stands. The diskettes and the tent card are on the top, the
 * keyboard templates and assembly cards in the upper bay right of the binders, the divider cards, the labels and the
 * empty vinyl holder in the lower bay.
 */
export function loosePoses() {
  const top = CASE.h, up = CASE.bays[1], low = CASE.bays[0];
  const T = 0.0008, DISK = 0.203, J = 0.0018;
  const stack = (y0, list) => { let y = y0; return list.map(([id, x, z, yaw, w, d, t = T]) => { const p = { id, at: [x, y, z], yaw, size: [w, t, d] }; y += t + 0.0002; return p; }); };
  return [
    ...stack(top, [['holder', 0.17, -0.005, 0.03, 0.235, 0.235, 0.0012], ['memory', 0.17, -0.002, 0.02, DISK, DISK, J]]),
    ...stack(top + 0.0034, [['report', 0.13, 0.01, -0.12, DISK, DISK, J], ['haster', 0.22, 0.02, 0.18, DISK, DISK, J], ['train', 0.15, 0.04, 0.06, DISK, DISK, J]]),
    ...stack(top, [['ruler', -0.12, 0.122, 0.04, 0.305, 0.038, 0.0016], ['bypass', -0.31, -0.01, -0.22, 0.102, 0.152]]),
    { id: 'tent', at: [-0.09, top, -0.05], yaw: 0.3, size: [0.152, 0.089, 0.06] },
    ...stack(up, [['asm4', 0.235, 0.0, 0.05, 0.216, 0.279], ['asmr', 0.24, 0.008, -0.04, 0.216, 0.279], ['kt4', 0.215, 0.05, 0.05, 0.279, 0.140, 0.0006], ['krp', 0.215, 0.07, -0.06, 0.279, 0.140, 0.0006]]),
    ...stack(low, [['holder2', 0.17, -0.01, 0.02, 0.235, 0.235, 0.0012], ['labels', 0.17, 0.0, -0.04, 0.216, 0.279], ['dividers', 0.165, 0.005, 0.03, 0.229, 0.279, 0.004], ['indexdiv', 0.175, 0.012, -0.05, 0.229, 0.279, 0.0008]]),
  ];
}

/** The footprint corners (x, z) of a loose pose in the case frame. */
export function looseOutline(p) {
  const [w, , d] = p.size, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [p.at[0] + u * c + v * s, p.at[2] - u * s + v * c]);
}

/** The case's world box { min, max } for a layout spot { x, z, floor, yaw = 0 } (yaw is a turn about the vertical). */
export function caseBox(spot) {
  const c = Math.cos(spot.yaw ?? 0), s = Math.abs(Math.sin(spot.yaw ?? 0));
  const hx = (CASE.w / 2) * c + (CASE.d / 2) * s, hz = (CASE.w / 2) * s + (CASE.d / 2) * c;
  return { min: [spot.x - hx, spot.floor, spot.z - hz], max: [spot.x + hx, spot.floor + CASE.h + 0.06, spot.z + hz] };
}
