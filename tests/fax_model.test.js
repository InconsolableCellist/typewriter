// The Sharp FO-70's model contract (docs/fax/models.md): fax_fo70.glb, as the build ships it (meshopt), holds every
// named part the kit and the controls drive, at the documented size, with the materials by name; each key's press axis
// goes into the panel; the builder's data and the GLB agree; and the view assembles the parts from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { compressGlb } from '../tools/gen/compress_glb.mjs';
import { buildFo70View, createFaxMaterials, FO70_KEYS } from '../src/render/fax/fo70-view.js';
import faxfo70 from '../src/machine/faxfo70.js';

const GLB = new URL('../public/assets/models/fax_fo70.glb', import.meta.url);
const SPEC = JSON.parse(fs.readFileSync(new URL('../tools/blender/fax_fo70.json', import.meta.url), 'utf8'));

async function load() {
  const bytes = await compressGlb(new Uint8Array(fs.readFileSync(GLB)));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf, '');
  gltf.scene.updateMatrixWorld(true);
  return gltf;
}
const gltfP = load();
const byName = (scene) => { const m = {}; scene.traverse((o) => { if (o.name) m[o.name] = o; }); return m; };
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

const PARTS = [
  'fax_body', 'fax_panel', 'fax_lcd', 'fax_handset', 'fax_hook', 'fax_cord', 'fax_cord_handset', 'fax_cord_jack',
  'fax_roll_latch', 'fax_guide_l', 'fax_guide_r', 'fax_doc_slot', 'fax_doc_exit', 'fax_doc_path',
  'fax_print_slot', 'fax_print_path', 'fax_cutter', 'fax_platen', 'fax_paper_roll', 'fax_speaker', 'fax_mech',
  'fax_feet', 'fax_jacks', ...FO70_KEYS.map((k) => `fax_key_${k}`),
];
const MATERIALS = ['fax_body', 'fax_dark', 'fax_key', 'fax_key_start', 'fax_lcd', 'fax_panel', 'fax_paper', 'fax_rubber'];

test('every part of the contract is a node, and the materials are the named set', async () => {
  const { scene } = await gltfP;
  const n = byName(scene);
  for (const p of PARTS) assert.ok(n[p], p);
  const mats = new Set();
  scene.traverse((o) => { if (o.isMesh) mats.add(o.material.name); });
  assert.deepEqual([...mats].sort(), MATERIALS);
  assert.equal(SPEC.keys.list.length, FO70_KEYS.length);
  for (const k of SPEC.keys.list) assert.ok(FO70_KEYS.includes(k.name), k.name);
});

test('the machine is the documented 304 x 236 x 122 mm within 2 mm, standing on the desk', async () => {
  const { scene } = await gltfP;
  const n = byName(scene);
  const box = new THREE.Box3();
  for (const p of PARTS.filter((p) => p !== 'fax_cord')) box.union(new THREE.Box3().setFromObject(n[p]));   // the cord lies on the desk round it
  const size = box.getSize(new THREE.Vector3());
  const [w, h, d] = SPEC.size;
  assert.ok(Math.abs(size.x - w) < 0.002, `width ${size.x}`);
  assert.ok(Math.abs(size.y - h) < 0.002, `height ${size.y}`);
  assert.ok(Math.abs(size.z - d) < 0.002, `depth ${size.z}`);
  assert.ok(Math.abs(box.min.y) < 1e-4, 'on the desk');
  assert.ok(Math.abs(box.min.x + box.max.x) < 0.002 && Math.abs(box.min.z + box.max.z) < 0.002, 'centred');
});

test('keys: each sits on the panel at its measured place, with a unit press axis into the panel and a travel', async () => {
  const { scene } = await gltfP;
  const n = byName(scene);
  const s = SPEC.panel.slope_deg * Math.PI / 180, [zr, yr] = SPEC.panel.rear;
  const normal = new THREE.Vector3(0, Math.cos(s), Math.sin(s));
  for (const k of SPEC.keys.list) {
    const node = n[`fax_key_${k.name}`];
    assert.equal(node.parent.name, 'fax_panel', `${k.name} rides on the panel`);
    const press = new THREE.Vector3(...parse(node.userData.press));
    assert.ok(Math.abs(press.length() - 1) < 1e-3 && press.dot(normal) < -0.999, `${k.name} presses into the panel`);
    const travel = parse(node.userData.travel);
    assert.ok(travel > 0.0008 && travel < 0.003, `${k.name} travel`);
    if (k.kind === 'pad') continue;
    // The key's pivot (its top centre) lies over its measured (u, w) on the panel.
    const p = node.getWorldPosition(new THREE.Vector3());
    const [u, w] = k.at;
    const base = new THREE.Vector3(u, yr - w * Math.sin(s), zr + w * Math.cos(s));
    const off = p.clone().sub(base);
    assert.ok(Math.abs(off.x) < 1e-4 && off.clone().sub(normal.clone().multiplyScalar(off.dot(normal))).length() < 2e-4, `${k.name} at its place`);
  }
  // No two keys overlap on the panel.
  const ks = SPEC.keys.list.filter((k) => k.kind !== 'pad');
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
    const a = ks[i], b = ks[j];
    const d = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]);
    assert.ok(d > SPEC.keys[a.kind].r + SPEC.keys[b.kind].r + 0.002, `${a.name} and ${b.name} overlap`);
  }
});

test('moving parts carry their axes: hinges, slides, the hook, the paths and the LCD face', async () => {
  const { scene } = await gltfP;
  const n = byName(scene);
  // The operation panel is the roll cover (architecture.md 3.3): its node on the rear hinge, opening 95 degrees.
  assert.deepEqual(parse(n.fax_panel.userData.hinge), [1, 0, 0]);
  assert.ok(Math.abs(parse(n.fax_panel.userData.open) + 95 * Math.PI / 180) < 1e-4);
  // The roll lies in the bay under the panel, inside the body.
  const roll = new THREE.Box3().setFromObject(n.fax_paper_roll), pan = new THREE.Box3().setFromObject(n.fax_panel);
  assert.ok(roll.max.z < pan.max.z && roll.min.z > pan.min.z - 0.01 && roll.min.y > 0.004, 'the roll under the panel');
  assert.deepEqual(parse(n.fax_guide_l.userData.slide), [1, 0, 0]);
  assert.deepEqual(parse(n.fax_guide_r.userData.slide), [-1, 0, 0]);
  assert.ok(parse(n.fax_hook.userData.travel) > 0);
  assert.deepEqual(parse(n.fax_cutter.userData.press), [0, -1, 0]);
  for (const p of ['fax_doc_path', 'fax_print_path']) {
    const pts = parse(n[p].userData.path);
    assert.ok(pts.length >= 4, p);
    assert.deepEqual(pts[0], [0, 0, 0], `${p} starts at its node`);
    const last = n[p].position.z + pts.at(-1)[2];
    assert.ok(last > SPEC.size[2] / 2, `${p} leaves at the front`);
  }
  const [lw, lh] = parse(n.fax_lcd.userData.size);
  assert.ok(lw > 0.055 && lw < 0.07 && lh > 0.012 && lh < 0.02, 'a 16-character LCD');
  assert.equal(n.fax_lcd.parent.name, 'fax_panel');
  const lay = parse(n.fax_panel.userData.layout);
  assert.ok(lay.labels.some((l) => l.text === 'SPEAKER') && lay.labels.some((l) => l.text.startsWith('RESOLUTION')));
});

test('the view builds the parts from the GLB with the named materials', async () => {
  const gltf = await gltfP;
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 100 }) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  const makeCanvas = () => ({ getContext: () => ctx, width: 0, height: 0 });
  const v = await buildFo70View(faxfo70, { gltf, mats: createFaxMaterials({ textured: false }), makeCanvas });
  assert.deepEqual(Object.keys(v.parts.keyNodes).sort(), [...FO70_KEYS].sort());
  // The kit's names (architecture.md 6.2): keys as meshes in the mechanism's order, every one an Object3D.
  const order = faxfo70.mech.panel.keys;
  assert.equal(v.parts.keys.length, order.length);
  for (const k of v.parts.keys) assert.ok(k?.isObject3D);
  assert.equal(v.parts.keys[order.indexOf('5')].parent, v.parts.keyNodes['5']);
  assert.equal(v.parts.keys[order.indexOf('start')].parent, v.parts.keyNodes.start);
  assert.equal(v.parts.cover, v.parts.panel);
  assert.equal(v.parts.display, v.parts.lcd);
  assert.equal(v.parts.rollBay, v.parts.paperRoll);
  for (const k of ['handset', 'hook', 'rollLatch', 'docSlot', 'printSlot', 'cutter', 'platen', 'paperRoll', 'lcd', 'speaker', 'cord']) assert.ok(v.parts[k], k);
  assert.ok(v.parts.guides.l && v.parts.guides.r);
  assert.ok(v.parts.docPath.points.length >= 4 && v.parts.printPath.points.length >= 4);
  const key = v.parts.keyNodes['5'], rest = key.position.clone();
  v.setKey('5', 1);
  assert.ok(Math.abs(key.position.distanceTo(rest) - parse(key.userData.travel)) < 1e-6);
  v.setKey('5', 0);
  assert.ok(key.position.distanceTo(rest) < 1e-12);
  v.setPanel(1);
  assert.ok(Math.abs(v.parts.panel.quaternion.angleTo(new THREE.Quaternion()) - 95 * Math.PI / 180) < 1e-4);
  v.setPanel(0);
  // update() from a snapshot: a key down, the handset lifted, the roll half used.
  const { makeFaxLayout } = await import('../src/sim/fax/layout.js');
  const L = makeFaxLayout(faxfo70), s = new Float32Array(L.length);
  s[L.onCradle] = 1; s[L.rollRadius] = 0.0255;
  v.update(s, L);
  const hs = v.parts.handset.position.clone();
  s[L.keyX + order.indexOf('5')] = 0.0025; s[L.onCradle] = 0; s[L.rollRadius] = 0.019;
  v.update(s, L);
  assert.ok(Math.abs(key.position.distanceTo(rest) - parse(key.userData.travel)) < 1e-6, 'the key bottoms');
  assert.ok(v.parts.handset.position.y > hs.y + 0.1, 'the handset lifts');
  assert.ok(v.parts.paperRoll.scale.y < 0.8, 'the roll shrinks');
});
