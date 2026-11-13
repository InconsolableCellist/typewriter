// Merges a unit's static meshes by material at load (perf review rec 18): fewer draw calls in every pass (the key
// light's shadow map, the AO prepass and the scene). Nothing that is picked, animated or named in a view's contract is
// merged away. Each part the view returns is a frame: a mesh is merged only with meshes that share its nearest frame
// (the part it rides on, or the unit's root), its material and its draw state, and the merged mesh is added to that
// frame, so it moves, picks and hides with it exactly as its sources did. The parts themselves are never removed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Every Object3D reachable from a view's parts (objects, arrays of them, one level of plain objects). */
export function partObjects(parts) {
  const out = new Set();
  const visit = (v, depth) => {
    if (!v || typeof v !== 'object') return;
    if (v.isObject3D) { out.add(v); return; }
    if (depth > 2) return;
    for (const x of Array.isArray(v) ? v : Object.values(v)) visit(x, depth + 1);
  };
  visit(parts, 0);
  return out;
}

/**
 * Merges in place under `root`. `keep` are the frames (the view's part objects): never merged away, and the merged
 * meshes of whatever rides on them are added to them. Returns { before, after } mesh counts.
 */
export function mergeStaticMeshes(root, keep) {
  const frames = new Set(keep); frames.add(root);
  root.updateWorldMatrix(true, true);
  const groups = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    before++;
    if (!mergeable(o, frames)) return;
    let f = o.parent, hidden = false;
    while (!frames.has(f)) { if (!f.visible) hidden = true; f = f.parent; }
    if (hidden) return;
    const g = o.geometry;
    const attrs = Object.keys(g.attributes).sort().map((n) => `${n}${g.attributes[n].itemSize}`).join(',');
    const key = [f.uuid, o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask, o.frustumCulled, attrs].join('|');
    if (!groups.has(key)) groups.set(key, { frame: f, list: [] });
    groups.get(key).list.push(o);
  });
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
  for (const { frame, list } of groups.values()) {
    if (list.length < 2) continue;
    inv.copy(frame.matrixWorld).invert();
    const geos = list.map((o) => baked(o.geometry, rel.multiplyMatrices(inv, o.matrixWorld)));
    const geo = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!geo) continue;
    const a = list[0];
    const mesh = new THREE.Mesh(geo, a.material);
    mesh.name = `${frame.name || 'unit'}_static_${a.material.name || a.material.type}`;
    mesh.castShadow = a.castShadow; mesh.receiveShadow = a.receiveShadow;
    mesh.renderOrder = a.renderOrder; mesh.layers.mask = a.layers.mask; mesh.frustumCulled = a.frustumCulled;
    mesh.userData.merged = list.map((o) => o.name);
    frame.add(mesh);
    for (const o of list) o.removeFromParent();
  }
  let after = 0;
  root.traverse((o) => { if (o.isMesh) after++; });
  return { before, after };
}

/**
 * Draws `meshes` (siblings, each moved only by its position) as one BatchedMesh with `material`: one draw a pass.
 * The meshes stay where they are, hidden, so the picker still raycasts them (Raycaster ignores `visible`) and whoever
 * animates them still moves them; whenever the scene's matrices are brought up to date, the batch copies the pose of
 * each one that moved. `geometryOf(mesh, i)` may give the geometry to draw (an atlas remap of the uv, say). Add the
 * batch to the meshes' parent.
 */
export function batchMeshes(meshes, material, geometryOf = (m) => m.geometry) {
  const geos = meshes.map(geometryOf);
  let nV = 0, nI = 0;
  for (const g of geos) { nV += g.getAttribute('position').count; nI += g.index ? g.index.count : g.getAttribute('position').count; }
  const batch = new THREE.BatchedMesh(meshes.length, nV, nI, material);
  batch.castShadow = meshes[0].castShadow; batch.receiveShadow = meshes[0].receiveShadow;
  // Every one is always drawn (they all go in one multi-draw), so no per-instance culling or sorting each pass.
  batch.perObjectFrustumCulled = false;
  batch.sortObjects = false;
  const last = new Float64Array(meshes.length * 3).fill(NaN);
  const sync = () => {
    for (let i = 0; i < meshes.length; i++) {
      const o = meshes[i], p = o.position, j = i * 3;
      if (p.x === last[j] && p.y === last[j + 1] && p.z === last[j + 2]) continue;
      last[j] = p.x; last[j + 1] = p.y; last[j + 2] = p.z;
      o.updateMatrix();
      batch.setMatrixAt(i, o.matrix);
    }
  };
  geos.forEach((g) => batch.addInstance(batch.addGeometry(g)));
  for (const o of meshes) o.visible = false;
  sync();
  // The bounds are computed once, at rest: the sphere (frustum culling) gets a centimetre for the travel; the box stays
  // exact, since the word processor's views frame the units by their boxes (wordproc.js boxOf).
  batch.computeBoundingSphere(); batch.boundingSphere.radius += 0.01;
  batch.computeBoundingBox();
  batch.updateMatrixWorld = function updateMatrixWorld(force) { sync(); THREE.BatchedMesh.prototype.updateMatrixWorld.call(this, force); };
  return batch;
}

/** A plain, opaque, childless, single-material mesh that no one refers to: safe to fold into a merged mesh. */
function mergeable(o, frames) {
  if (frames.has(o) || o.children.length || !o.visible) return false;
  if (o.isInstancedMesh || o.isBatchedMesh || o.isSkinnedMesh || o.morphTargetInfluences) return false;
  const m = o.material, g = o.geometry;
  if (!m || Array.isArray(m) || m.visible === false || m.transparent) return false;
  if (!g?.attributes.position || g.groups.length || Object.keys(g.morphAttributes).length) return false;
  if (o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return false;
  return true;
}

/** The geometry as plain float32 attributes, indexed, with `m` applied (and its winding kept when m mirrors). */
function baked(g, m) {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const n = a.count, k = a.itemSize, arr = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) arr[i * k + c] = a.getComponent(i, c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, k));
  }
  const n = out.attributes.position.count;
  const idx = g.index ? Array.from({ length: g.index.count }, (_, i) => g.index.getX(i)) : Array.from({ length: n }, (_, i) => i);
  if (m.determinant() < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  out.setIndex(idx);
  out.applyMatrix4(m);
  return out;
}
