// Every GLB in public/assets/models/, as the build ships it (meshopt-compressed by tools/gen/compress_glb.mjs, then
// gzipped), decodes through three's GLTFLoader with the MeshoptDecoder the app registers (src/render/gltf.js), and
// still has the node names, node transforms, materials and shape the views rely on: the summary in
// tests/fixtures/models.json was taken from the float exports before quantization. Regenerate it only after a
// deliberate change to a model: UPDATE_MODELS=1 node --test tests/models.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { compressGlb } from '../tools/gen/compress_glb.mjs';

const DIR = new URL('../public/assets/models/', import.meta.url);
const FIXTURE = new URL('./fixtures/models.json', import.meta.url);
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort();

async function parse(bytes) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return loader.parseAsync(buf, '');
}

const r = (x) => Math.round(x * 1e4) / 1e4;   // 0.1 mm

/** Named nodes with their local transforms and world bounds, the materials by name, and the triangle count. */
async function summarize(bytes) {
  const gltf = await parse(bytes);
  gltf.scene.updateMatrixWorld(true);
  const nodes = {};
  let tris = 0;
  const materials = new Set();
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m.name);
    }
    if (!o.name || o === gltf.scene || o.name.endsWith('_mesh')) return;   // _mesh: the quantizer's child holding the dequantizing scale
    const box = new THREE.Box3().setFromObject(o);
    nodes[o.name] = {
      position: o.position.toArray().map(r), quaternion: o.quaternion.toArray().map(r), scale: o.scale.toArray().map(r),
      box: box.isEmpty() ? null : [...box.min.toArray(), ...box.max.toArray()].map(r),
      extras: Object.keys(o.userData).sort(),
    };
  });
  return { nodes, materials: [...materials].sort(), tris };
}

/** One line per node, so a change to a model reads as a small diff. */
const format = (all) => `{\n${Object.entries(all).map(([f, { nodes, ...rest }]) => `${JSON.stringify(f)}: {${JSON.stringify(rest).slice(1, -1)}, "nodes": {\n${Object.entries(nodes).map(([n, v]) => `  ${JSON.stringify(n)}: ${JSON.stringify(v)}`).join(',\n')}\n}}`).join(',\n')}\n}\n`;

const jsonOf = (b) => JSON.parse(Buffer.from(b.subarray(20, 20 + new DataView(b.buffer, b.byteOffset).getUint32(12, true))).toString());

test('the typewriter models are quantized in the repository, every model meshopt-compressed in the build', async () => {
  for (const f of FILES) {
    const src = new Uint8Array(fs.readFileSync(new URL(f, DIR)));
    if (!['desk.glb', 'wp_diskette.glb'].includes(f)) assert.ok(jsonOf(src).extensionsRequired?.includes('KHR_mesh_quantization'), `${f}: quantized`);
    const out = await compressGlb(src);
    assert.ok(jsonOf(out).extensionsRequired?.includes('EXT_meshopt_compression'), `${f}: meshopt`);
    assert.ok(out.length < src.length * 0.8, `${f}: ${src.length} -> ${out.length}`);
  }
});

test('every model, as built, decodes to the same nodes, transforms, materials and bounds', async () => {
  const want = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : {};
  const got = {};
  for (const f of FILES) got[f] = await summarize(await compressGlb(new Uint8Array(fs.readFileSync(new URL(f, DIR)))));
  if (process.env.UPDATE_MODELS) { fs.writeFileSync(FIXTURE, format(got)); return; }
  assert.deepEqual(Object.keys(got), Object.keys(want), 'the same files');
  for (const f of FILES) {
    const a = got[f], b = want[f];
    assert.deepEqual(a.materials, b.materials, `${f}: materials`);
    assert.equal(a.tris, b.tris, `${f}: triangles`);
    assert.deepEqual(Object.keys(a.nodes).sort(), Object.keys(b.nodes).sort(), `${f}: node names`);
    for (const [name, n] of Object.entries(b.nodes)) {
      const m = a.nodes[name];
      for (const k of ['position', 'quaternion', 'scale']) assert.deepEqual(m[k], n[k], `${f} ${name}: ${k}`);
      assert.deepEqual(m.extras, n.extras, `${f} ${name}: extras`);
      assert.equal(m.box === null, n.box === null, `${f} ${name}: has geometry`);
      // Quantized at 0.05 mm (tools/blender/quantize_glb.py): bounds within 0.1 mm of the float export.
      if (n.box) for (let i = 0; i < 6; i++) assert.ok(Math.abs(m.box[i] - n.box[i]) <= 1.01e-4, `${f} ${name}: bounds ${m.box} vs ${n.box}`);
    }
  }
});
