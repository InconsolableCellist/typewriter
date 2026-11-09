// Node test helpers for soft-body tests: a hand-driven fake mechanism state.
import machine from '../machine/frontstrike1926.js';
import { deriveGeometry } from '../machine/geometry.js';
import { makeLayout } from '../sim/layout.js';
import { loadGlyphs } from '../machine/glyphs.js';
import { SoftWorld } from './index.js';
import { solveIndent } from './print.js';

export async function makeWorld(opts = {}) {
  const geometry = deriveGeometry(machine);
  const layout = makeLayout(geometry);
  const glyphs = await loadGlyphs();
  const world = new SoftWorld({ machine, geometry, glyphs, ...opts });
  const state = new Float32Array(layout.length);
  state[layout.carriageX] = 0;   // platen centred
  return { world, state, layout, machine, geometry, glyphs };
}

export const STEP = 1 / 60;

export function run(world, state, layout, seconds, fn) {
  const n = Math.round(seconds / STEP);
  for (let k = 0; k < n; k++) {
    if (fn) fn(k, k * STEP);
    world.step(STEP, state, layout);
  }
}

/** Build a strike event for a glyph bar, at the carriage/platen state in `state`. */
export function strikeEvent(geometry, layout, state, bar, opts = {}, world = null) {
  const L = layout;
  let maxIndent = opts.maxIndent;
  if (maxIndent === undefined && world) {
    const b = geometry.bars[bar], ch = opts.caseIndex ? b.upper : b.lower;
    maxIndent = solveIndent(machine, world.glyphs, world.glyphs.indexOf(ch), opts.peakForce ?? 42, opts.skewRad ?? 0);
  }
  return {
    type: 'strike', bar, caseIndex: opts.caseIndex ?? 0,
    tBegin: 0, duration: 0.002,
    carriageX: state[L.carriageX], platenPsi: state[L.platenPsi], shiftY: state[L.shiftY],
    lateral: opts.lateral ?? 0, vImpact: opts.vImpact ?? 1.3, peakForce: opts.peakForce ?? 42,
    maxIndent: maxIndent ?? 3e-6, restitution: 0.3, skewRad: opts.skewRad ?? 0,
    vibratorLift: state[L.vibratorLift], ribbonInGap: opts.ribbonInGap ?? 1,
    trace: { dt: 1e-4, force: new Float32Array(4), indent: new Float32Array(4) },
  };
}

/** Index of the bar that prints character c. */
export function barFor(geometry, c) {
  for (const b of geometry.bars) if (b && (b.lower === c || b.upper === c)) return b.index;
  throw new Error(`no bar for ${c}`);
}
