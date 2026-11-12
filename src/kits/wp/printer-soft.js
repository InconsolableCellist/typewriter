// The printer as SoftWorld sees it: a machine-shaped definition in printer-unit coordinates (architecture.md 3.4).
// The printer block holds what is documented; the soft bodies' own constants that the 5218 sources say nothing about
// (the ribbon's run between its guides) come from the electric typewriter, moved to this platen. The film ribbon runs
// in a cartridge on the carrier, so it moves with the print point like that one. The sheet's resting surfaces follow
// the cabinet and the sheet feeder (`printer.cabinet`, the same numbers tools/blender/build_wp_printer.py builds).
import element1971 from '../../machine/element1971.js';

export function printerSoftMachine(wp) {
  const P = wp.printer, E = element1971, C = P.cabinet, F = C.feeder;
  const d = [0, P.platen.center[1] - E.platen.center[1], P.platen.center[2] - E.platen.center[2]];
  const [w, , depth] = wp.units.printer.size;
  const pc = P.platen.center, pr = P.platen.radius;
  // The paper table is the sheet feeder's stacker plate, which runs up from behind the platen to the top of the
  // feeder's front opening: the sheet the feeder lays on it, and a printed sheet leaning back, both rest on it.
  // The table's foot and slope as PaperSim places it (tipBeta = beta0 + panArc[0], just outside the platen).
  const beta = (P.printPoint.beta ?? 0) + E.paper.panArc[0], rt = pr + 0.001;
  const tipY = pc[1] + rt * Math.sin(beta), tipZ = pc[2] + rt * Math.cos(beta), slope = Math.sin(beta) / -Math.cos(beta);
  const plateZ = (y) => tipZ + (y - tipY) * slope;   // z of the plate at height y
  const tableLength = (F.opening[1] - 0.008 - tipY) / -Math.cos(beta);
  const slotFloor = pc[1] - pr - 0.03;   // the well round the platen: the paper path runs below its axle
  const top = F.opening[1] - 0.005, back = 0.003;   // the plate's top, and how far behind it the height field stays
  return {
    ...E,
    id: 'wordproc1980-printer',
    name: wp.name,
    action: { ...P.action, type: 'printwheel-system' },
    platen: { ...E.platen, ...P.platen },
    printPoint: { ...E.printPoint, ...P.printPoint },
    slug: { ...E.slug, ...P.slug },
    paper: { ...E.paper, ...P.paper, tableLength, tableWidth: 2 * F.openingHalfWidth - 0.01 },
    ribbon: {
      ...E.ribbon, ...P.ribbon,
      ink: 1, colourBands: ['black'],
      spoolX: P.ribbon.spoolX ?? E.ribbon.spoolX, spoolY: P.ribbon.spoolY ?? E.ribbon.spoolY + d[1], spoolZ: P.ribbon.spoolZ ?? E.ribbon.spoolZ + d[2],
      depletionPerStrike: P.ribbon.depletionPerStrike ?? 1,   // film: each strike uses fresh film
    },
    table: { tipY, tipZ, slope },                     // the plate, for the model builder (tools/wp/export_printer.mjs)
    carriage: { ...E.carriage, ...P.carriage },
    escapement: { ...E.escapement, ...P.escapement },
    // Where a loose sheet can rest: the access cover in front, the well over the platen down to the paper path, and
    // behind it the sheet feeder (its top as a height field; the stacker plate in front of it is the table above).
    bodyProxy: {
      halfWidth: w / 2, zMin: -depth / 2, zMax: depth / 2, topMax: F.top,
      profile: [
        [-depth / 2, F.rearTop], [F.rearTopFront, F.rearTop], [F.topBack, F.top], [plateZ(top) - back - 0.008, F.top],
        [plateZ(top) - back, top], [plateZ(C.coverTop) - back, C.coverTop], [C.filterFoot[1] - 0.002, slotFloor],
        [C.hinge[1] + 0.002, slotFloor], [C.hinge[1] + 0.006, C.coverTop], [depth / 2, C.coverTop],
      ],
    },
  };
}
