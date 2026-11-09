// Abuse: extreme hand input on every grabbable part must never produce NaN, runaway speed or runaway energy.
import test from 'node:test';
import assert from 'node:assert/strict';
import machine from '../src/machine/frontstrike1926.js';
import { deriveGeometry } from '../src/machine/geometry.js';
import { MechanicalSim, SUBSTEP_HZ } from '../src/sim/mechanics.js';
import { loadGlyphsNode } from '../src/sim/harness.js';

const glyphs = await loadGlyphsNode();
const geo = deriveGeometry(machine);
const fresh = () => new MechanicalSim({ machine, geometry: geo, glyphs });

function assertFinite(s, tag) {
  for (const obj of [s, s.action]) {
    for (const [name, v] of Object.entries(obj)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${tag}: ${name} = ${v}`);
      else if (v instanceof Float64Array) for (let i = 0; i < v.length; i++) assert.ok(Number.isFinite(v[i]), `${tag}: ${name}[${i}] = ${v[i]}`);
    }
  }
}
function assertBounded(s, tag) {
  assert.ok(Math.abs(s.psiV) <= 170, `${tag}: platen ${s.psiV} rad/s`);
  assert.ok(Math.abs(s.qV) <= 9, `${tag}: carriage ${s.qV} m/s`);
  for (let i = 0; i < s.action.n; i++) assert.ok(Math.abs(s.action.omega[i]) <= 270, `${tag}: bar ${i} ${s.action.omega[i]} rad/s`);
  for (let i = 0; i < s.kv.length; i++) assert.ok(Math.abs(s.kv[i]) <= 9, `${tag}: key ${i} ${s.kv[i]} m/s`);
}

const key = geo.keys.findIndex((k) => k.kind === 'print' && k.lower === 'e');
const DOFS = [
  ['key', key], ['bar', 12], ['carriage', 0], ['platen', 0], ['lsLever', 0], ['paperRelease', 0],
  ['carriageRelease', 0], ['bail', 0], ['marginL', 0], ['marginR', 0], ['ribbonSelector', 0],
];
const BAD = [NaN, Infinity, -Infinity, 1e12, -1e12];

for (const [dof, idx] of DOFS) {
  test(`extreme grabs on ${dof} stay finite and bounded`, () => {
    const s = fresh();
    // Absurd coupling, absurd and non-finite targets, reversing every 0.4 ms for a while.
    const g = s.grab(dof, idx, { target: 1e9, k: 1e15, c: 1e12, maxF: 1e15 });
    const N = Math.round(SUBSTEP_HZ * 0.4);
    for (let i = 0; i < N; i++) {
      if (i % 150 === 0) {
        const j = (i / 150) | 0;
        s.moveGrab(g, j % 7 === 6 ? BAD[j % BAD.length] : (j % 2 ? 1e6 : -1e6));
      }
      s.step();
      if (i % 2048 === 0) assertBounded(s, dof);
    }
    assertFinite(s, dof);
    assertBounded(s, dof);
    s.release(g);
    // Grabs with non-finite parameters are accepted and sanitised, not propagated.
    for (const bad of BAD) {
      const h = s.grab(dof, idx, { target: bad, k: bad, c: bad, maxF: bad });
      for (let i = 0; i < 4000; i++) s.step();
      s.release(h);
      assertFinite(s, `${dof} bad=${bad}`);
    }
    for (let i = 0; i < SUBSTEP_HZ * 0.5; i++) s.step();
    assertFinite(s, `${dof} released`);
    assertBounded(s, `${dof} released`);
    assert.ok(s.energy() < 40, `${dof}: energy ${s.energy()}`);
  });
}

test('spinning the platen by hand at any rate and reversing: bounded, indexes, and comes to rest on a detent', () => {
  const s = fresh();
  const g = s.grab('platen', 0, { target: 0, k: 1e6, c: 1e3, maxF: 1e6 });
  let t = 0, peak = 0;
  for (let i = 0; i < SUBSTEP_HZ * 1.2; i++) {
    t += 1 / SUBSTEP_HZ;
    // A hand whipping the knob back and forth, target tens of radians away and reversing 12 times a second.
    s.moveGrab(g, s.psi + (Math.sin(t * 2 * Math.PI * 6) > 0 ? 30 : -30));
    s.step();
    peak = Math.max(peak, Math.abs(s.psiV));
  }
  console.log(`  peak platen speed ${peak.toFixed(1)} rad/s, final psi ${s.psi.toFixed(3)}`);
  assert.ok(peak < 60, `platen reached ${peak} rad/s`);
  s.release(g);
  for (let i = 0; i < SUBSTEP_HZ * 1.5; i++) s.step();
  assertFinite(s, 'platen');
  const notch = (2 * Math.PI) / machine.platen.detentNotches;
  assert.ok(Math.abs(s.psi / notch - Math.round(s.psi / notch)) < 0.06, `psi not on a detent: ${s.psi / notch}`);
});

test('line-space lever slammed repeatedly with the platen spinning: bounded', () => {
  const s = fresh();
  const p = s.grab('platen', 0, { target: 0, k: 1e6, c: 1e3, maxF: 1e6 });
  const l = s.grab('lsLever', 0, { target: 0, k: 1e6, c: 1e3, maxF: 1e6 });
  for (let i = 0; i < SUBSTEP_HZ * 0.8; i++) {
    if (i % 1000 === 0) { s.moveGrab(p, s.psi + (i % 4000 ? 40 : -40)); s.moveGrab(l, i % 2000 ? 10 : -10); }
    s.step();
    if (i % 2048 === 0) assertBounded(s, 'platen+lever');
  }
  assertFinite(s, 'platen+lever');
});

test('mashing many keys while throwing the carriage: finite and bounded', () => {
  const s = fresh();
  const printing = geo.keys.flatMap((k, i) => (k.kind === 'print' ? [i] : []));
  const g = s.grab('carriage', 0, { target: 0, k: 1e8, c: 1e6, maxF: 1e6 });
  for (let i = 0; i < SUBSTEP_HZ * 0.6; i++) {
    if (i % 2000 === 0) { s.moveGrab(g, i % 4000 ? 1 : -1); for (let j = 0; j < 6; j++) s.pressKey(printing[(i / 2000 + j * 7) % printing.length | 0], 1e9, 0.04); }
    s.step();
    if (i % 2048 === 0) assertBounded(s, 'mash');
  }
  assertFinite(s, 'mash');
});
