// Machine registry. The URL parameter ?machine=<id> selects one; frontstrike1926 is the default.
import frontstrike1926 from './frontstrike1926.js';
import element1971 from './element1971.js';
import wordproc1980 from './wordproc1980.js';
import faxfo70 from './faxfo70.js';
import { deriveGeometry } from './geometry.js';
import { deriveWordprocGeometry } from './wp-geometry.js';
import { deriveFaxGeometry } from './fax-geometry.js';

export const MACHINES = { frontstrike1926, element1971, wordproc1980, faxfo70 };
export const DEFAULT_MACHINE = 'frontstrike1926';

// Machines still being built: selectable by ?machine=<id>, and listed in the picker only with ?wp. The fax stays here
// until it is on the desk in full (docs/fax/plan.md, M7).
export const UNLISTED = new Set(['faxfo70']);

// The code that puts a machine family on the desk, by action.type. Loaded on demand, so a visit downloads one family.
export const KITS = {
  'typebar-frontstrike': () => import('../kits/typewriter.js'),
  'single-element': () => import('../kits/typewriter.js'),
  'printwheel-system': () => import('../kits/wordproc.js'),
  'thermal-fax': () => import('../kits/fax.js'),
};

// A machine's geometry by family (machine.kind); the typewriters' is the default.
const GEOMETRY = { system: deriveWordprocGeometry, fax: deriveFaxGeometry };

export function geometryFor(machine) {
  return (GEOMETRY[machine.kind] ?? deriveGeometry)(machine);
}
