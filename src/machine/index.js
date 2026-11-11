// Machine registry. The URL parameter ?machine=<id> selects one; frontstrike1926 is the default.
import frontstrike1926 from './frontstrike1926.js';
import element1971 from './element1971.js';
import wordproc1980 from './wordproc1980.js';
import { deriveGeometry } from './geometry.js';
import { deriveWordprocGeometry } from './wp-geometry.js';

export const MACHINES = { frontstrike1926, element1971, wordproc1980 };
export const DEFAULT_MACHINE = 'frontstrike1926';

// Machines still being built: selectable by ?machine=<id>, and listed in the picker only with ?wp.
export const UNLISTED = new Set(['wordproc1980']);

// The code that puts a machine family on the desk, by action.type. Loaded on demand, so a visit downloads one family.
export const KITS = {
  'typebar-frontstrike': () => import('../kits/typewriter.js'),
  'single-element': () => import('../kits/typewriter.js'),
  'printwheel-system': () => import('../kits/wordproc.js'),
};

export function geometryFor(machine) {
  return machine.kind === 'system' ? deriveWordprocGeometry(machine) : deriveGeometry(machine);
}
