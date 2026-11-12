#!/usr/bin/env node
// Dumps the printer's definition, its derived geometry and the soft bodies' view of it to tools/blender/wp_printer.json,
// the dimension source for tools/blender/build_wp_printer.py. Run after any change to the printer block.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import wp from '../../src/machine/wordproc1980.js';
import { geometryFor } from '../../src/machine/index.js';
import { printerSoftMachine } from '../../src/kits/wp/printer-soft.js';

const here = dirname(fileURLToPath(import.meta.url));
const geo = geometryFor(wp);
const P = wp.printer, soft = printerSoftMachine(wp);
const out = resolve(here, '../blender/wp_printer.json');
writeFileSync(out, JSON.stringify({
  size: wp.units.printer.size,
  platen: { center: P.platen.center, radius: P.platen.radius, length: P.platen.length },
  printPoint: geo.printer.printPoint,
  wheel: { ...geo.printer.wheel, petals: P.wheel.petals },
  carrier: { stops: P.carrier.stops, home: P.carrier.home, lead: P.carrier.lead },
  hammer: { freeTravel: P.hammer.freeTravel, petalTravel: P.hammer.petalTravel },
  ribbon: { spoolX: soft.ribbon.spoolX, spoolY: soft.ribbon.spoolY, spoolZ: soft.ribbon.spoolZ, width: soft.ribbon.width, guidePostX: soft.ribbon.guidePostX },
  paper: { width: soft.paper.width, bailAngle: soft.paper.bailAngle, feedRollAngle: soft.paper.feedRollAngle, panArc: soft.paper.panArc, bailRollerRadius: soft.paper.bailRollerRadius },
  table: soft.table, cabinet: P.cabinet, cover: { open: P.cover.open }, power: { travel: P.power.travel },
  bail: { travel: P.cam.bail.table[4] }, panel: { keys: P.panel.keys, travel: P.panel.travel },
}, null, 1));
console.log(`wrote ${out}`);
