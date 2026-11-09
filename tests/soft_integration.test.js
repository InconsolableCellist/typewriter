// Paper and ribbon against the real MechanicalSim: typed strikes from integrated mechanism physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { loadGlyphs } from '../src/machine/glyphs.js';
import { makeLayout } from '../src/sim/layout.js';
import { SoftWorld } from '../src/soft/index.js';

const geometry = deriveGeometry(machine);
const glyphs = await loadGlyphs();
const FRAME = 1 / 60;

function rig() {
  const sim = new MechanicalSim({ machine, geometry, glyphs });
  const layout = makeLayout(geometry);
  const world = new SoftWorld({ machine, geometry, glyphs });
  const state = new Float32Array(layout.length);
  const strikes = [];
  sim.writeSnapshot(state);
  world.step(0, state, layout);
  const frame = (n = 1) => {
    for (let f = 0; f < n; f++) {
      const steps = Math.round(SUBSTEP_HZ * FRAME);
      for (let i = 0; i < steps; i++) sim.step();
      sim.writeSnapshot(state);
      world.step(FRAME, state, layout);
      sim.setEnv(world.env());
      const ev = [];
      sim.drainEvents(ev);
      for (const e of ev) if (e.type === 'strike') { strikes.push({ e, r: world.applyStrike(e) }); }
    }
  };
  return { sim, world, state, layout, frame, strikes };
}

const keyOf = (c) => geometry.keys.findIndex((k) => k.kind === 'print' && (k.lower === c || k.upper === c));

function feedTo(rigs, psiTarget, seconds = 1.2) {
  const { sim, frame } = rigs;
  const g = sim.grab('platen', 0, { target: sim.psi, k: 12, c: 0.06, maxF: 1.5 });
  const n = Math.round(seconds * 60), p0 = sim.psi;
  for (let i = 1; i <= n; i++) { sim.moveGrab?.(g, p0 + ((psiTarget - p0) * i) / n); frame(); }
  sim.release(g);
  frame(12);
}

function type(rigs, text, force = 22) {
  const { sim, frame } = rigs;
  for (const c of text) { sim.pressKey(keyOf(c), force, 0.11); frame(16); }
  frame(8);
}

function loaded() {
  const r = rig();
  r.world.spawnSheet({ onTable: { offset: 0.005 } });
  r.frame(40);
  feedTo(r, r.sim.psi + 3.4);
  return r;
}

test('real strikes print a left-to-right line, ribbon advances, no perforation at normal force', () => {
  const r = loaded();
  const { world, sim, strikes } = r;
  assert.ok(world.paperSim.nE > 0, 'the sheet is gripped by the nip');
  const ribbonS0 = world.readouts().ribbonS;
  type(r, 'nnnnnn', 22);
  assert.ok(strikes.length >= 5, `strikes: ${strikes.length}`);
  for (const { e, r: res } of strikes) {
    assert.ok(res && res.inked > 0, `strike printed (peak ${e.peakForce.toFixed(0)} N, ribbonInGap ${e.ribbonInGap})`);
    assert.equal(res.perforations, 0, `no perforation, peak pressure ${(res.maxPressure / 1e6).toFixed(0)} MPa`);
  }
  const us = strikes.map((s) => s.r.u);
  for (let i = 1; i < us.length; i++) {
    const d = us[i] - us[i - 1];
    assert.ok(Math.abs(d - machine.escapement.pitch) < 0.0006, `pitch ${(d * 1000).toFixed(3)} mm`);
  }
  assert.ok(Math.abs(strikes.at(-1).r.v - strikes[0].r.v) < 0.0006, 'stays on one line');
  const ds = Math.abs(world.readouts().ribbonS - ribbonS0);
  assert.ok(ds > 0.001, `ribbon advanced ${(ds * 1000).toFixed(2)} mm`);
  void sim;
});

test('ink follows the real force range: default strokes are solid, light ones lighter, only hard periods cut', () => {
  const r = loaded();
  const results = {};
  const ink = () => r.world.inkTexture.data;
  // Measured finger forces: 22 N is a light stroke, 34 N the default, 50 N a hammering.
  for (const [c, F] of [['n', 22], ['n', 28], ['n', 34], ['n', 50], ['.', 34], ['.', 50]]) {
    const before = r.strikes.length;
    const snap = ink().slice();
    type(r, c, F);
    const got = r.strikes.slice(before);
    assert.ok(got.length >= 1, `${c} at ${F} N struck`);
    const d = ink(), vals = [];
    for (let k = 0; k < d.length; k += 2) if (d[k] > snap[k] + 2) vals.push(d[k] - snap[k]);
    vals.sort((a, b) => a - b);
    results[`${c}@${F}`] = {
      peakN: got[0].e.peakForce, mpa: got[0].r.maxPressure / 1e6, median: vals[vals.length >> 1], ink: got[0].r.meanInk,
      perf: got.reduce((a, s) => a + s.r.perforations, 0), covered: got[0].r.covered, pressed: got[0].r.pressed,
    };
  }
  console.log('  strike calibration', JSON.stringify(results));
  for (const k of Object.keys(results)) assert.ok(results[k].covered > 0.95 * results[k].pressed, `${k} fully covered by the ribbon`);
  assert.ok(results['n@34'].median >= 200, `default stroke prints solid, median deposit ${results['n@34'].median}/255`);
  assert.ok(results['n@22'].median <= results['n@34'].median - 40, `light stroke visibly lighter, ${results['n@22'].median} vs ${results['n@34'].median}`);
  assert.ok(results['n@22'].ink < results['n@28'].ink && results['n@28'].ink < results['n@34'].ink && results['n@34'].ink < results['n@50'].ink, 'ink rises monotonically with force');
  assert.equal(results['n@34'].perf, 0, 'a default letter does not perforate');
  assert.equal(results['.@34'].perf, 0, 'a default period does not perforate');
  assert.ok(results['.@50'].perf > 0, 'a hard period perforates');
});
