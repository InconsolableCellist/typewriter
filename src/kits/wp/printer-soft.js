// The printer as SoftWorld sees it: a machine-shaped definition in printer-unit coordinates (architecture.md 3.4).
// The printer block holds what is documented; the soft bodies' own constants that the 5218 sources say nothing about
// (the ribbon's run between its guides, the sheet's resting surfaces) come from the electric typewriter, moved to
// this platen. The film ribbon runs in a cartridge on the carrier, so it moves with the print point like that one.
import element1971 from '../../machine/element1971.js';

export function printerSoftMachine(wp) {
  const P = wp.printer, E = element1971;
  const d = [0, P.platen.center[1] - E.platen.center[1], P.platen.center[2] - E.platen.center[2]];
  const [w, h, depth] = wp.units.printer.size;
  const top = h, deck = h * 0.62 + 0.02;      // the cover's top and the front deck, as src/render/wp/units.js builds them
  const pz = P.platen.center[2], pr = P.platen.radius;
  const slot = P.platen.center[1] - pr - 0.03;   // the open well round the platen: the paper path runs below its axle
  return {
    ...E,
    id: 'wordproc1980-printer',
    name: wp.name,
    action: { ...P.action, type: 'printwheel-system' },
    platen: { ...E.platen, ...P.platen },
    printPoint: { ...E.printPoint, ...P.printPoint },
    slug: { ...E.slug, ...P.slug },
    paper: { ...E.paper, ...P.paper },
    ribbon: {
      ...E.ribbon, ...P.ribbon,
      ink: 1, colourBands: ['black'],
      spoolY: E.ribbon.spoolY + d[1], spoolZ: E.ribbon.spoolZ + d[2],
      depletionPerStrike: P.ribbon.depletionPerStrike ?? 1,   // film: each strike uses fresh film
    },
    carriage: { ...E.carriage, ...P.carriage },
    escapement: { ...E.escapement, ...P.escapement },
    // Where a loose sheet can rest: the cover top behind, the slot over the platen, the front deck.
    bodyProxy: {
      halfWidth: w / 2, zMin: -depth / 2, zMax: depth / 2, topMax: top,
      profile: [[-depth / 2, top - 0.01], [pz - pr - 0.05, top - 0.01], [pz - pr - 0.045, slot], [pz + pr + 0.02, slot], [pz + pr + 0.025, top - 0.01], [depth / 2 - 0.12, top - 0.01], [depth / 2 - 0.11, deck], [depth / 2, deck]],
    },
  };
}
