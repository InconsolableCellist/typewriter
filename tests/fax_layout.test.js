// The fax's registry entry, sizes and desk layout (docs/fax/plan.md M0): registered and selectable but not listed, its
// kit and host in place, the documented 304 x 236 x 122 mm and 2.6 kg, the handset on its cradle inside the body's
// footprint, the block-out inside the body, and everything on the desk inside the board field and clear of the rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import faxfo70 from '../src/machine/faxfo70.js';
import { geometryFor, MACHINES, KITS, UNLISTED } from '../src/machine/index.js';
import { hasMechanism } from '../src/sim/host-factory.js';
import { faxBoxes, DESK_THINGS } from '../src/machine/fax-views.js';

const FIELD = { x0: -0.948, x1: 0.948, z0: -0.508, z1: 0.588 };    // desk.glb board field, docs/assets.md
const g = geometryFor(faxfo70);
const boxes = faxBoxes(g, faxfo70);
const overlap = (a, b) => a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[2] < b.max[2] && b.min[2] < a.max[2];
const inside = (a, b, tol = 1e-9) => [0, 1, 2].every((i) => a.min[i] >= b.min[i] - tol && a.max[i] <= b.max[i] + tol);

test('registry: the FO-70 is registered under its id and menu name, has a kit and a host, and is not yet listed', () => {
  assert.equal(MACHINES.faxfo70, faxfo70);
  assert.equal(faxfo70.id, 'faxfo70');
  assert.equal(faxfo70.name, 'Sharp FO-70 facsimile, c. 1999');
  assert.ok(UNLISTED.has('faxfo70'), 'selectable by ?machine=faxfo70 but kept out of the picker until M7');
  assert.equal(faxfo70.action.type, 'thermal-fax');
  assert.equal(typeof KITS['thermal-fax'], 'function');
  assert.ok(hasMechanism(faxfo70));
  for (const m of Object.values(MACHINES)) assert.equal(typeof KITS[m.action.type], 'function', m.id);
  // The other machines' geometry is unchanged by the table: the Displaywriter's is still the system kind's.
  assert.ok(geometryFor(MACHINES.wordproc1980).system);
  assert.ok(geometryFor(MACHINES.frontstrike1926).keys);
});

test('size: 304 x 236 x 122 mm and about 2.6 kg, with the handset on top of its cradle within the outline', () => {
  const b = g.units.body;
  assert.deepEqual(faxfo70.units.body.size, [0.304, 0.122, 0.236]);
  assert.equal(faxfo70.units.body.mass, 2.6);
  assert.ok(Math.abs(b.box.max[0] - b.box.min[0] - 0.304) < 1e-9 && Math.abs(b.box.max[2] - b.box.min[2] - 0.236) < 1e-9);
  const h = g.units.handset;
  assert.equal(h.on, 'body');
  assert.ok(inside(h.box, b.box), 'the handset lies within the body\'s outline');
  assert.ok(Math.abs(h.box.max[1] - 0.122) < 1e-9, 'its top is the machine\'s top');
  assert.ok(h.box.max[0] < b.origin[0], 'on the left, as in the owner\'s photograph');
  assert.ok(boxes.cradle.max[1] <= h.box.min[1] + 1e-9, 'it rests on the cradle');
  // Every block-out part lies inside the body's outline (the exit slots flush with the front face).
  for (const [n, p] of Object.entries(g.parts)) assert.ok(inside(p, { min: b.box.min, max: [b.box.max[0], b.box.max[1], b.box.max[2] + 0.005] }, 1e-6), n);
  assert.ok(!overlap(boxes.cradle, boxes.cabinet) || boxes.cradle.max[0] <= boxes.cabinet.min[0] + 1e-9, 'cradle and cabinet side by side');
});

test('the desk: the machine and its things lie inside the board field, none on another', () => {
  const things = { body: boxes.body, ...Object.fromEntries(Object.keys(DESK_THINGS).map((n) => [n, boxes[n]])) };
  for (const [n, b] of Object.entries(things)) {
    assert.ok(b, n);
    assert.ok(b.min[0] >= FIELD.x0 && b.max[0] <= FIELD.x1 && b.min[2] >= FIELD.z0 && b.max[2] <= FIELD.z1, `${n} on the desk`);
  }
  const list = Object.entries(things);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i][1], list[j][1]), `${list[i][0]} overlaps ${list[j][0]}`);
  // The cut pages land in front of the machine, where the strip leaves it.
  assert.ok(boxes.receivedPile.min[2] > boxes.body.max[2], 'the pile in front of the machine');
  assert.ok(boxes.receivedPile.min[0] < boxes.paperExit.max[0] && boxes.receivedPile.max[0] > boxes.paperExit.min[0], 'under the exit slot');
  // The lamp's base (src/render/environment.js) clear of everything.
  const L = faxfo70.deskLayout.lamp, r = 0.069 * 1.45;
  const lamp = { min: [L.x - r, 0, L.z - r], max: [L.x + r, 0.4, L.z + r] };
  for (const [n, b] of list) assert.ok(!overlap(lamp, b), `the lamp stands on ${n}`);
});

test('camera presets look at the desk', () => {
  for (const [name, c] of Object.entries(faxfo70.cameras)) {
    assert.ok(c.position[1] > c.target[1], `${name} looks down`);
    assert.ok(c.target[1] >= 0 && c.target[1] < 0.5, `${name} target height`);
  }
  assert.ok(faxfo70.cameras[faxfo70.defaultCamera]);
});

test('the definition marks its values and keeps the line pitches and drive consistent', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/machine/faxfo70.js', import.meta.url), 'utf8');
  for (const mark of ['[S p.', '[M', '[A']) assert.ok(src.includes(mark), mark);
  assert.ok(!/\[S\]|\[S:/.test(src), 'every documented value cites its page');
  // The service manual settles the motor count (one) and that the cutter has no motor of its own (p.3-7).
  assert.ok(/single-planetary/.test(src) && !('motor' in faxfo70.mech.cutter), 'one motor drives the cutter too');
  assert.deepEqual(Object.keys(faxfo70.mech.liu.relays), ['cml'], 'one relay on the TEL/LIU board');
  assert.ok(faxfo70.mech.panel.keys.includes('volume') && faxfo70.mech.panel.keys.length === 27, 'one VOLUME key, 27 keys');
  const D = faxfo70.mech.drive;
  for (const res of ['standard', 'fine', 'superfine']) {
    const pitch = D.stepsPerLine[res] * D.advancePerStep;
    assert.ok(Math.abs(pitch * D.linesPerMm[res] * 1000 - 1) < 1e-9, `${res}: whole steps a line`);
  }
  assert.deepEqual(D.linesPerMm, { standard: 3.85, fine: 7.7, superfine: 15.4 });
  assert.equal(faxfo70.mech.feeder.capacity, 5);
  assert.equal(faxfo70.mech.printer.dots, 1728);
});
