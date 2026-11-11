// The desk the machine stands on: top surface at y = 0. An analytic contact-occlusion term under the machine's footprint
// keeps the room's reflections out of the gap, which is what stops the machine looking afloat. A system machine of
// several units sets one footprint per unit (up to MAX_FOOTPRINTS).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MAX_FOOTPRINTS = 4;

export class Desk {
  constructor({ scene, mats }) {
    this.scene = scene;
    // Each footprint is (centre x, centre z, half x, half z); an unused one has a negative half size and is skipped.
    const feet = Array.from({ length: MAX_FOOTPRINTS }, () => new THREE.Vector4(0, 0, -1, -1));
    feet[0].set(0, 0.03, 0.17, 0.14);
    this.footprint = { uFoot: { value: feet } };
    const mat = mats.desk, foot = this.footprint;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, foot);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDeskPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vDeskPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec4 uFoot[${MAX_FOOTPRINTS}]; varying vec3 vDeskPos;`)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float d = 1e3;
          for (int i = 0; i < ${MAX_FOOTPRINTS}; i++) {
            if (uFoot[i].z < 0.0) continue;
            vec2 q = abs(vDeskPos.xz - uFoot[i].xy) - uFoot[i].zw;
            d = min(d, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
          }
          float ao = mix(0.12, 1.0, smoothstep(-0.015, 0.11, d));
          if (vDeskPos.y > -0.002) {
            reflectedLight.indirectDiffuse *= ao;
            reflectedLight.indirectSpecular *= ao * ao;
          #ifdef USE_CLEARCOAT
            clearcoatSpecularIndirect *= ao * ao;
          #endif
          }
        }`);
    };
    this.mat = mat;
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = this.mat;
      o.receiveShadow = true;
      o.castShadow = false;
    });
    this.scene.add(gltf.scene);
    return true;
  }

  /** Fits the occlusion to the real machine outline, from a world box. */
  setFootprint(box) { this.setFootprints([box]); }

  /** One occlusion rectangle per world box (THREE.Box3 or { min: [x,y,z], max: [x,y,z] }), up to MAX_FOOTPRINTS. */
  setFootprints(boxes) {
    const feet = this.footprint.uFoot.value;
    for (let i = 0; i < MAX_FOOTPRINTS; i++) {
      const b = boxes[i];
      if (!b) { feet[i].set(0, 0, -1, -1); continue; }
      const [x0, z0, x1, z1] = Array.isArray(b.min) ? [b.min[0], b.min[2], b.max[0], b.max[2]] : [b.min.x, b.min.z, b.max.x, b.max.z];
      feet[i].set((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2);
    }
  }
}
