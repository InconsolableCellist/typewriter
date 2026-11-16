// Where the fax's camera may stand (docs/fax/architecture.md 6; plan 7.1 "Views"): the view graph as data for the
// shared navigation code (src/interact/wp-views.js: ViewNav, viewSpec, poseOf with this graph), and the named boxes
// the views frame, from the definition alone, which the kit replaces with the boxes of the model's parts once they
// exist. Pure data and arithmetic, no DOM and no three.js, so it is tested in Node (tests/fax_views.test.js).
const deg = Math.PI / 180;

/**
 * Stations, left to right along the desk: the card index of numbers, the machine, the received pages in front of it,
 * the documents to send; the desk is the overview above them, which Back goes up to.
 */
export const FAX_STATIONS = {
  desk: { label: 'Desk', boxes: ['body', 'handset', 'cardIndex', 'documents', 'receivedPile'], view: { azim: 0, elev: 34 * deg, margin: 1.1 }, left: 'numbers', right: 'documents', items: ['spareRoll'] },
  numbers: { label: 'Numbers', boxes: ['cardIndex'], view: { azim: 10 * deg, elev: 40 * deg, margin: 1.3, minDistance: 0.4 }, left: null, right: 'fax', items: ['cards'] },
  fax: { label: 'Fax', boxes: ['body', 'handset'], view: { azim: 0, elev: 32 * deg, margin: 1.12, minDistance: 0.45 }, left: 'numbers', right: 'received', items: ['panel', 'display', 'feeder', 'paper', 'handset', 'rear'] },
  received: { label: 'Received', boxes: ['receivedPile'], view: { azim: 0, elev: 60 * deg, margin: 1.2, minDistance: 0.4 }, left: 'fax', right: 'documents', items: ['pile'] },
  documents: { label: 'Documents', boxes: ['documents'], view: { azim: -10 * deg, elev: 55 * deg, margin: 1.2, minDistance: 0.4 }, left: 'received', right: null, items: ['folder'] },
};

/** Focus items: a closer look at part of a station. `note(ctx)` may add a word. */
export const FAX_FOCUS = {
  panel: { label: 'Panel', boxes: ['panel'], view: { azim: 0, elev: 52 * deg, margin: 1.15, minDistance: 0.26 } },
  display: { label: 'Display', boxes: ['display'], view: { azim: 0, elev: 48 * deg, margin: 1.6, minDistance: 0.18 } },
  feeder: { label: 'Feeder', boxes: ['documentTable', 'documentSlot'], view: { azim: 0, elev: 62 * deg, margin: 1.2, minDistance: 0.26 } },
  paper: { label: 'Paper', boxes: ['rollBay', 'paperExit'], view: { azim: 0, elev: 40 * deg, margin: 1.2, minDistance: 0.26 }, note: (c) => (c?.coverOpen?.() === false ? 'lift the panel to reach the roll' : '') },
  handset: { label: 'Handset', boxes: ['handset'], view: { azim: -35 * deg, elev: 36 * deg, margin: 1.2, minDistance: 0.3 } },
  rear: { label: 'Rear', boxes: ['body'], view: { azim: 180 * deg, elev: 22 * deg, margin: 1.15 } },
  spareRoll: { label: 'Spare roll', boxes: ['spareRoll'], view: { azim: 0, elev: 40 * deg, margin: 1.5, minDistance: 0.3 } },
  cards: { label: 'Cards', boxes: ['cardIndex'], view: { azim: 0, elev: 62 * deg, margin: 1.2, minDistance: 0.26 } },
  pile: { label: 'Pages', boxes: ['receivedPile'], view: { azim: 0, elev: 80 * deg, margin: 1.15, minDistance: 0.3 } },
  folder: { label: 'Folder', boxes: ['documents'], view: { azim: 0, elev: 80 * deg, margin: 1.15, minDistance: 0.3 } },
};

export const FAX_GRAPH = Object.freeze({ stations: FAX_STATIONS, focus: FAX_FOCUS, order: ['desk', 'numbers', 'fax', 'received', 'documents'], home: 'desk' });

/** The old camera presets (?cam=) as views. */
export const FAX_CAMERAS = { overview: 'desk', operator: 'fax' };

// Sizes of the things on the desk (m) [A]: a rotary card index, a document folder, a pile of cut pages, the boxed roll.
export const DESK_THINGS = {
  cardIndex: { w: 0.17, d: 0.12, h: 0.13 },
  documents: { w: 0.24, d: 0.31, h: 0.02 },
  receivedPile: { w: 0.22, d: 0.20, h: 0.03 },
  spareRoll: { w: 0.24, d: 0.065, h: 0.065 },
};

const box = (min, max) => ({ min: [...min], max: [...max] });

/** Named boxes from the definition and its geometry (src/machine/fax-geometry.js): units, block-out parts, desk things. */
export function faxBoxes(geometry, machine) {
  const out = {};
  for (const [n, u] of Object.entries(geometry.units)) out[n] = box(u.box.min, u.box.max);
  for (const [n, b] of Object.entries(geometry.parts)) out[n] = box(b.min, b.max);
  const L = machine.deskLayout ?? {};
  for (const [n, s] of Object.entries(DESK_THINGS)) {
    const p = L[n];
    if (!p) continue;
    out[n] = box([p.x - s.w / 2, 0, p.z - s.d / 2], [p.x + s.w / 2, s.h, p.z + s.d / 2]);
  }
  return out;
}
