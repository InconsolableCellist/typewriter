#!/usr/bin/env node
// Dumps the element1971 definition and its derived geometry to tools/blender/element1971.json, the dimension source
// for tools/blender/build_element_enclosure.py. Run after any change to the definition.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import machine from '../../src/machine/element1971.js';
import { deriveGeometry } from '../../src/machine/geometry.js';

const here = dirname(fileURLToPath(import.meta.url));
const geo = deriveGeometry(machine);
const out = resolve(here, '../blender/element1971.json');
writeFileSync(out, JSON.stringify({ machine, geometry: geo }, null, 1));
console.log(`wrote ${out}: ${geo.nPrint} printing keys, ${geo.nKeys} keys`);
