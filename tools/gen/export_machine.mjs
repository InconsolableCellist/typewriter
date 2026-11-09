#!/usr/bin/env node
// Dumps the machine definition plus derived geometry to tools/blender/machine.json, the only
// dimensions source for tools/blender/*.py. Run: node tools/gen/export_machine.mjs
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import machine from '../../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../../src/machine/geometry.js';
import { deriveRig } from '../../src/render/rig.js';

const here = dirname(fileURLToPath(import.meta.url));
const geo = deriveGeometry(machine);
const rig = deriveRig(machine, geo);   // renderer-owned layout: rails, rack, universal bar, bell
const out = resolve(here, '../blender/machine.json');
writeFileSync(out, JSON.stringify({ machine, geometry: geo, rig }, null, 1));
console.log(`wrote ${out}: ${geo.nPrint} bars, ${geo.nKeys} keys`);
