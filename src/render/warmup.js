// Shader programs compiled behind the loading screen (src/ui/loader.js waits for the third frame), not while the
// visitor is already using the machine. Three keys a program on the material's maps and features, the lights and the
// environment's cube size; the kits make all of those final before the first frame (placeholder maps in
// src/render/materials.js, a 1k HDRI whose cube matches the studio environment's), so these programs are the ones
// that draw.
import * as THREE from 'three';

/**
 * Compiles every material in the scene, plus `pending` materials whose models are still loading (each on a stand-in
 * triangle for the duration), with the look's patch applied first, and resolves when the programs are linked (in
 * parallel where the browser has KHR_parallel_shader_compile).
 */
export async function compileBeforeFirstFrame(stage, pending = []) {
  const { renderer, scene, camera } = stage;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1e-4, 0, 0, 0, 1e-4, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const holder = new THREE.Group();
  for (const m of new Set(pending.filter(Boolean))) {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = mesh.receiveShadow = true;
    holder.add(mesh);
  }
  scene.add(holder);
  try {
    stage.patchMaterials?.();
    await renderer.compileAsync(scene, camera);
  } catch (e) {
    console.info('shader warm-up', e);
  } finally {
    scene.remove(holder);
    geo.dispose();
  }
}

/**
 * Counts gl.linkProgram calls, split at the first frame (window.__frameCount, set by the kits' loops), in
 * window.__programLinks = { beforeFirstFrame, afterFirstFrame, log: [{ ms, frame }] }. A warm start links nothing
 * after the first frame except programs for objects that appear later (the room backdrop, a model loaded on demand).
 */
export function trackProgramLinks(renderer) {
  if (typeof window === 'undefined') return;
  const gl = renderer.getContext();
  const link = gl.linkProgram.bind(gl);
  const stats = { beforeFirstFrame: 0, afterFirstFrame: 0, log: [] };
  window.__programLinks = stats;
  gl.linkProgram = (program) => {
    const frame = window.__frameCount ?? 0;
    if (frame > 0) stats.afterFirstFrame++; else stats.beforeFirstFrame++;
    stats.log.push({ ms: Math.round(performance.now()), frame });
    return link(program);
  };
}
