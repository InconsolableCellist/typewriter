// The word processor keyboard's model (docs/displaywriter/models.md, Keyboard): the key layout measured from the
// photographs fits its openings without overlaps, the openings fit the documented case, the case builder's data is in
// step with the layout, and the GLB holds the named parts at the documented size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import machine from '../src/machine/wordproc1980.js';
import { KEYS, KEY_UNIT as U } from '../src/machine/wp-keys.js';
import { CASE, deckOrigin, keyRect, keyGroup, openings } from '../src/render/wp/keyboard-layout.js';

const { size, slope } = machine.units.keyboard;
const inside = (poly, [x, z]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};

test('each cap lies inside its group\'s opening, with no two caps overlapping', () => {
  const ops = openings();
  assert.deepEqual(Object.keys(ops).sort(), ['left', 'main', 'rightLower', 'rightUpper']);
  const rects = KEYS.map(keyRect);
  KEYS.forEach((k, i) => {
    const r = rects[i];
    for (const p of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1 - (k.tall ? U : 0)], [r.x1, r.z1]]) assert.ok(inside(ops[keyGroup(k)], p), `key ${k.pos} corner in its opening`);
  });
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const overlap = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
    const legClear = KEYS[i].tall && b.z0 > a.z0 + U * 0.9 && b.x1 <= a.x1 - KEYS[i].leg * U + 1e-6;   // under RETURN's arm, left of its leg
    assert.ok(!overlap || legClear, `keys ${KEYS[i].pos} and ${KEYS[j].pos} overlap`);
  }
});

test('the left and right groups rise a row above the number row; the key field sits within the case', () => {
  const ops = openings();
  const top = (p) => Math.min(...p.map((q) => q[1]));
  assert.ok(Math.abs(top(ops.left) - top(ops.rightUpper)) < 1e-9);
  assert.ok(Math.abs(top(ops.main) - top(ops.left) - U) < 1e-9);
  const xs = Object.values(ops).flat().map((p) => p[0]);
  const zs = Object.values(ops).flat().map((p) => p[1]);
  assert.ok(Math.max(...xs.map(Math.abs)) < size[0] / 2 - 0.04, 'side borders');
  const [, y0, z0] = deckOrigin(size, slope);
  for (const z of zs) {
    const zz = z0 + z * Math.cos(slope);
    assert.ok(Math.abs(zz) < size[2] / 2 - 0.03, 'front and rear borders');
  }
  // The deck meets the documented height at the rear edge; the caps stay below it.
  assert.ok(Math.abs(y0 + (size[2] / 2) * Math.tan(slope) - CASE.rearTop) < 1e-9);
  assert.equal(CASE.rearTop, size[1]);
});

test('the case builder\'s data matches the layout (run tools/gen/export_wp_keyboard.mjs after changing it)', () => {
  const d = JSON.parse(readFileSync(new URL('../tools/blender/wp_keyboard.json', import.meta.url)));
  assert.deepEqual(d.size, size);
  assert.equal(d.slope, slope);
  assert.deepEqual(d.openings, openings());
  assert.deepEqual(d.deck, deckOrigin(size, slope));
});

test('wp_keyboard.glb holds the case parts at the documented size and in budget', () => {
  const b = readFileSync(new URL('../public/assets/models/wp_keyboard.glb', import.meta.url));
  assert.ok(b.length < 220_000, `GLB ${b.length} bytes`);
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const names = j.nodes.map((n) => n.name);
  for (const n of ['wp_keyboard_cover', 'wp_keyboard_plate', 'wp_keyboard_base', 'wp_keyboard_feet', 'wp_keyboard_cable']) assert.ok(names.includes(n), n);
  assert.deepEqual([...new Set(j.materials.map((m) => m.name))].sort(), ['wp_dark', 'wp_gray', 'wp_pearl', 'wp_rubber']);
  assert.ok(!j.images?.length, 'no baked images');
  const lo = [1, 1, 1], hi = [-1, -1, -1];
  for (const n of j.nodes) {
    if (!['wp_keyboard_cover', 'wp_keyboard_base', 'wp_keyboard_feet'].includes(n.name)) continue;
    const a = j.accessors[j.meshes[n.mesh].primitives[0].attributes.POSITION];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], a.min[i]); hi[i] = Math.max(hi[i], a.max[i]); }
  }
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(hi[i] - lo[i] - size[i]) < 0.002, `extent ${i}: ${(hi[i] - lo[i]).toFixed(4)}`);
  assert.ok(Math.abs(lo[1]) < 1e-4, 'stands on the desk');
});
