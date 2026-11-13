// The documentation shelf beside the desk (src/render/wp/shelf.js, shelf-items.js): IBM's training materials as the
// Operator Reference Guide lists them (S544-2036-0, pp. 1-3 and 1-4), each known scan linked on bitsavers, and the
// bookcase clear of the desk, the units and everything on the desk.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHELF_BINDERS, SHELF_LOOSE, DESK_BINDER, BINDERS, BINDER, CASE, BAYS, binderPoses, binderOutline, loosePoses, looseOutline, caseBox, scanUrl, shelfLabel } from '../src/render/wp/shelf-items.js';
import { STATIONS, FOCUS, fallbackBoxes, viewSpec } from '../src/interact/wp-views.js';
import { MANUAL_URL } from '../src/render/wp/manual.js';
import { geometryFor } from '../src/machine/index.js';
import wordproc1980 from '../src/machine/wordproc1980.js';

// The list, from the guide's pages 1-3 and 1-4 (the scan's OCR reads S as 8): order number and item.
const LIST = {
  'S544-0750': 'Grey 1-1/2" 3-ring binder', 'S544-0861': 'Printer Guide', 'S544-0874': 'Office Systems Support Center Guide',
  'S544-0860': 'Problem Determination Guide', 'S544-2000': '5218 Printwheel Printer Problem Determination Guide',
  'S544-0880': 'Vinyl Diskette Holder', 'S544-0877': 'Memory Record Diskette', 'S544-2016': 'Program Diskette (Duplicate) Labels',
  'S544-0879': 'Divider Cards', 'S544-2075': 'Training Tent Card', 'S544-2071': 'Conversion Ruler',
  'S544-2101': 'Assembly Card', 'S544-0881': 'Grey 1" 3-ring easel binder', 'S544-0887': 'Grey 2" 3-ring binder', 'S544-2072': 'Grey 1" 3-ring binder',
  'S544-2034': 'Operator Training Book 1, Basic Topics', 'S544-2035': 'Operator Training Book 2, Selectable Topics',
  'S544-2036': 'Operator Reference Guide', 'S544-2122': 'Prompts and Messages Guide', 'S544-2037': 'Work Station Procedures Guide',
  'S544-2082': 'Training Diskette TRAIN', 'S544-2083': 'Training Diskette HASTER', 'S544-2131': 'Menu Bypass Abbreviation Card',
  'S544-2085': 'Textpack 4 Keyboard Template', 'S544-2098': 'Master Index', 'S544-2132': 'Divider Card for Index',
  'S544-2111': 'Reportpack Assembly Card', 'S544-2030': 'Operator Training Book', 'S544-2033': 'Work Station Procedures Guide',
  'S544-2031': 'Guide to Files Design and Use', 'S544-2084': 'Reportpack Keyboard Template', 'S544-2110': 'Training Diskette REPORT',
};
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const overlap = (a, b) => [0, 1, 2].every((i) => a.min[i] < b.max[i] && a.max[i] > b.min[i]);

test('the shelf and the desk binder hold every item of the list, by title and order number', () => {
  const all = [...SHELF_BINDERS, DESK_BINDER, ...SHELF_LOOSE];
  const orders = new Map(all.map((it) => [it.order, it]));
  const binderOrders = new Set([...SHELF_BINDERS, DESK_BINDER].map((b) => BINDERS[b.ring].order));
  for (const [order, name] of Object.entries(LIST)) {
    if (/binder$/.test(name)) { assert.ok(binderOrders.has(order), `a manual stands in the ${name} (${order})`); continue; }
    const it = orders.get(order);
    assert.ok(it, `${name} (${order}) is there`);
    const text = norm(it.title ? it.title.join(' ') : it.name);
    assert.ok(text.includes(norm(name)), `${order}: "${text}" names "${name}"`);
  }
  for (const it of all) assert.ok(LIST[it.order], `${it.order} is on the list`);
  assert.equal(new Set(all.map((it) => it.id)).size, all.length, 'ids are unique');
  assert.equal(new Set(all.map((it) => it.order)).size, all.length, 'each order number once');
  // Ring sizes from the list where it says: the training books in 2", the Operator Reference Guide in 1-1/2".
  assert.equal(DESK_BINDER.ring, '1-1/2');
  for (const id of ['tb1', 'tbr']) assert.equal(SHELF_BINDERS.find((b) => b.id === id).ring, '2');
  assert.equal(SHELF_BINDERS.find((b) => b.id === 'pmg').ring, '1 easel');
  for (const b of SHELF_BINDERS) assert.ok(b.pack === null || /^(Textpack 4|Reportpack|Textpack 4\/Reportpack)$/.test(b.pack), b.id);
  assert.deepEqual([...BAYS.flat()].sort(), SHELF_BINDERS.map((b) => b.id).sort(), 'every binder stands in a bay, once');
});

test('scans: every link is to bitsavers.org; binders with none say so', () => {
  const linked = [...SHELF_BINDERS, DESK_BINDER].filter((b) => scanUrl(b));
  assert.deepEqual(linked.map((b) => b.order).sort(), ['S544-2034', 'S544-2035', 'S544-2036', 'S544-2037']);
  for (const b of linked) {
    const u = new URL(scanUrl(b));
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, 'bitsavers.org');
    assert.ok(u.pathname.startsWith('/pdf/ibm/') && u.pathname.endsWith('.pdf'), u.pathname);
    assert.match(shelfLabel(b), /read the scanned copy$/);
  }
  assert.equal(scanUrl(DESK_BINDER), MANUAL_URL, 'the desk binder opens the same scan as before');
  for (const b of SHELF_BINDERS.filter((x) => !scanUrl(x))) assert.match(shelfLabel(b), /no scan available$/, b.id);
  for (const it of SHELF_LOOSE) assert.ok(shelfLabel(it).includes(it.order), it.id);
  // No scan is copied into the site.
  const pdfs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? pdfs(`${dir}/${e.name}`) : e.name.endsWith('.pdf') ? [`${dir}/${e.name}`] : []));
  assert.deepEqual(pdfs(new URL('../public', import.meta.url).pathname), []);
});

test('the binders stand in their bays, spines out, clear of each other, the walls and the shelf above', () => {
  const poses = binderPoses();
  assert.equal(poses.length, SHELF_BINDERS.length);
  for (const p of poses) {
    const ceil = CASE.bays[p.bay] + CASE.bay;
    for (const [x, y] of binderOutline(p)) {
      assert.ok(Math.abs(x) <= CASE.inner / 2 + 1e-9, `${p.id} within the walls`);
      assert.ok(y >= CASE.bays[p.bay] - 1e-9 && y <= ceil - 0.02, `${p.id} on its floor, under the shelf above`);
    }
    assert.ok(p.z + BINDER.d / 2 <= CASE.d / 2 + 1e-9 && p.z - BINDER.d / 2 >= -CASE.d / 2 + CASE.back, `${p.id} within the depth`);
    assert.ok(Math.abs(p.w - BINDERS[SHELF_BINDERS.find((b) => b.id === p.id).ring].spine) < 1e-12);
  }
  // Neighbours do not overlap; the leaning one touches its neighbour's top corner and no more.
  for (let i = 1; i < poses.length; i++) {
    const a = poses[i - 1], b = poses[i];
    if (a.bay !== b.bay) continue;
    const ar = Math.max(...binderOutline(a).map((c) => c[0]));
    if (b.tilt > 0.05) assert.ok(binderOutline(b)[3][0] >= binderOutline(a)[2][0] - 1e-9, `${b.id} leans on ${a.id}, not into it`);
    else assert.ok(Math.min(...binderOutline(b).map((c) => c[0])) >= ar - 0.0006, `${a.id} | ${b.id}`);
  }
});

test('the loose items lie on the top or in a bay, inside the case and clear of the binders', () => {
  const placed = new Set(loosePoses().map((p) => p.id.replace(/2$/, '')));
  for (const it of SHELF_LOOSE) assert.ok(placed.has(it.id), `${it.name} is placed`);
  const lastBinderX = (bay) => Math.max(...binderPoses().filter((p) => p.bay === bay).flatMap((p) => binderOutline(p).map((c) => c[0])));
  for (const p of loosePoses()) {
    const onTop = Math.abs(p.at[1] - CASE.h) < 0.01, bay = CASE.bays.findIndex((y) => Math.abs(p.at[1] - y) < 0.01);
    assert.ok(onTop || bay >= 0, `${p.id} on a surface`);
    for (const [x, z] of looseOutline(p)) {
      if (onTop) assert.ok(Math.abs(x) <= CASE.w / 2 && Math.abs(z) <= CASE.d / 2, `${p.id} on the top`);
      else {
        assert.ok(Math.abs(x) <= CASE.inner / 2 && z <= CASE.d / 2 && z >= -CASE.d / 2 + CASE.back, `${p.id} inside the bay`);
        assert.ok(x > lastBinderX(bay) + 0.005, `${p.id} clear of the binders`);
      }
    }
  }
});

test('the bookcase stands on the floor beside the desk, clear of the desk, the units and every prop', () => {
  const L = wordproc1980.deskLayout, g = geometryFor(wordproc1980), cb = caseBox(L.shelf);
  // The desk's box is the model's own.
  const glb = fs.readFileSync(new URL('../public/assets/models/desk.glb', import.meta.url));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  const acc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(acc.min[i] - L.desk.min[i]) < 1e-6, `desk min ${i}`);
    assert.ok(Math.abs(acc.max[i] - L.desk.max[i]) < 1e-6, `desk max ${i}`);
  }
  assert.ok(Math.abs(L.shelf.floor - L.desk.min[1]) < 1e-9, 'on the floor the desk stands on');
  assert.ok(!overlap(cb, L.desk), 'clear of the desk');
  assert.ok(cb.min[0] - L.desk.max[0] >= 0.02 && cb.min[0] - L.desk.max[0] < 0.15, 'beside it, a hand\'s width off');
  assert.ok(Math.abs(cb.min[2] - L.desk.min[2]) < 0.02, 'back to the same wall');
  const top = L.shelf.floor + CASE.h;
  assert.ok(top > -0.05 && top < 0.12, 'a low case, its top about level with the desk');
  for (const [n, u] of Object.entries(g.units)) assert.ok(!overlap(cb, u.box), `clear of ${n}`);
  const fb = fallbackBoxes(g, wordproc1980);
  for (const n of ['file', 'manual', 'packet', 'paper', 'notes', 'slots', 'levers']) assert.ok(!overlap(cb, fb[n]), `clear of the ${n}`);
  // Out of the main Computer view's way: well right of everything it frames.
  const comp = STATIONS.computer.boxes.map((n) => fb[n]);
  assert.ok(cb.min[0] > Math.max(...comp.map((b) => b.max[0])) + 0.5);
});

test('views: a Shelf station right of the diskettes, with the binders and the top as focus items', () => {
  assert.equal(STATIONS.diskettes.right, 'shelf');
  assert.equal(STATIONS.shelf.left, 'diskettes');
  assert.equal(STATIONS.shelf.label, 'Shelf');
  assert.equal(FOCUS.binders.label, 'Binders');
  assert.ok(viewSpec('shelf/binders') && viewSpec('shelf/shelfTop'));
  const fb = fallbackBoxes(geometryFor(wordproc1980), wordproc1980);
  for (const n of ['shelf', 'shelfBinders', 'shelfTop']) assert.ok(fb[n] && fb[n].max[1] > fb[n].min[1], n);
});
