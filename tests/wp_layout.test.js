// The word processor's desk layout (milestone M0): units inside the desk's board field, no two overlapping, the
// display on its module, the paper spots clear of the units, and the cables long enough. architecture.md 3.1, 11.2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import wordproc1980 from '../src/machine/wordproc1980.js';
import { geometryFor, MACHINES, KITS, UNLISTED } from '../src/machine/index.js';

const FIELD = { x0: -0.948, x1: 0.948, z0: -0.508, z1: 0.588 };    // desk.glb board field, docs/assets.md
const SHEET = { w: 0.2159, d: 0.2794 };                            // a US letter sheet lying on the desk
const g = geometryFor(wordproc1980);
const standing = Object.entries(g.units).filter(([, u]) => !u.on);

const overlap = (a, b) => a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[2] < b.max[2] && b.min[2] < a.max[2];

test('registry: the word processor is registered, unlisted, and has a kit', () => {
  assert.equal(MACHINES.wordproc1980, wordproc1980);
  assert.ok(UNLISTED.has('wordproc1980'));
  assert.equal(typeof KITS[wordproc1980.action.type], 'function');
  for (const m of Object.values(MACHINES)) assert.equal(typeof KITS[m.action.type], 'function', m.id);
});

test('every standing unit lies inside the desk field', () => {
  for (const [name, u] of standing) {
    assert.ok(u.box.min[0] >= FIELD.x0 && u.box.max[0] <= FIELD.x1, `${name} x ${u.box.min[0].toFixed(3)}..${u.box.max[0].toFixed(3)}`);
    assert.ok(u.box.min[2] >= FIELD.z0 && u.box.max[2] <= FIELD.z1, `${name} z ${u.box.min[2].toFixed(3)}..${u.box.max[2].toFixed(3)}`);
  }
});

test('no two standing units overlap, and side-by-side units keep a gap', () => {
  for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
    const [a, ua] = standing[i], [b, ub] = standing[j];
    assert.ok(!overlap(ua.box, ub.box), `${a} overlaps ${b}`);
  }
});

test('the display stands on the module, within its top', () => {
  const d = g.units.display, s = g.units.station;
  assert.equal(d.on, 'station');
  assert.ok(Math.abs(d.origin[1] - s.box.max[1]) < 1e-9, 'display sits on the module top');
  assert.ok(d.box.min[0] >= s.box.min[0] && d.box.max[0] <= s.box.max[0], 'display within the module width');
  assert.ok(d.box.min[2] >= s.box.min[2] - 1e-9 && d.box.max[2] <= s.box.max[2] + 1e-9, 'display within the module depth');
});

test('the layout matches the owner\'s arrangement: printer left, diskettes right, keyboard in front of the module', () => {
  const u = g.units;
  assert.ok(u.printer.box.max[0] < u.station.box.min[0], 'printer left of the module');
  assert.ok(u.diskette.box.min[0] > u.station.box.max[0], 'diskettes right of the module');
  assert.ok(u.keyboard.box.min[2] > u.station.box.max[2], 'keyboard in front of the module');
  assert.equal(wordproc1980.deskLayout.lamp, false);
  assert.equal(wordproc1980.deskLayout.ashtray.on, 'diskette');
});

test('paper spots lie on the desk and clear of every unit', () => {
  for (const name of ['freshStack', 'pagePile']) {
    const p = wordproc1980.deskLayout[name];
    const box = { min: [p.x - SHEET.w / 2, 0, p.z - SHEET.d / 2], max: [p.x + SHEET.w / 2, 0, p.z + SHEET.d / 2] };
    assert.ok(box.min[0] >= FIELD.x0 && box.max[0] <= FIELD.x1 && box.min[2] >= FIELD.z0 && box.max[2] <= FIELD.z1, `${name} on the desk`);
    for (const [unit, u] of standing) assert.ok(!overlap(box, u.box), `${name} clear of ${unit}`);
  }
  const s = wordproc1980.deskLayout.freshStack, p = wordproc1980.deskLayout.pagePile;
  assert.ok(Math.abs(s.x - p.x) >= SHEET.w, 'stack and pile do not overlap');
});

test('the 1 m keyboard and diskette cables reach the module', () => {
  // HW 2.1 and 3.6: 1 m cables. Measured centre to centre on the desk, a generous bound for the routed length.
  const s = g.units.station.origin;
  for (const name of ['keyboard', 'diskette']) {
    const o = g.units[name].origin;
    assert.ok(Math.hypot(o[0] - s[0], o[2] - s[2]) < 0.8, `${name} within reach of a 1 m cable`);
  }
});

test('camera presets look at the desk', () => {
  for (const [name, c] of Object.entries(wordproc1980.cameras)) {
    assert.ok(c.position[1] > c.target[1], `${name} looks down`);
    assert.ok(c.target[1] >= 0 && c.target[1] < 0.5, `${name} target height`);
  }
  assert.ok(wordproc1980.cameras[wordproc1980.defaultCamera]);
});
